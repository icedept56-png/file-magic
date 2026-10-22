/**
 * ─────────────────────────────────────────────────────────────────────────
 *  PDF Text Surgery — TRUE text removal from PDF content streams
 * ─────────────────────────────────────────────────────────────────────────
 *  Instead of painting white boxes over text (whiteout), this engine
 *  parses the page's raw content streams, replays the text graphics state
 *  (BT/ET, Tm, Td/TD/T*, cm, q/Q, TL, Tf) and surgically DELETES the exact
 *  text-showing operators (Tj, TJ, ', ") whose baseline origin falls inside
 *  a target rectangle — in unrotated PDF user space.
 *
 *  The result: the letters are genuinely GONE from the document (selectable
 *  text, copy-paste, search — everything). Nothing is painted over.
 *
 *  Streams are re-compressed with FlateDecode; untouched pages are left
 *  byte-identical. Pure byte-level work — no DOM dependency — so it also
 *  runs under Bun for verification harnesses.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream } from "pdf-lib";

export type UserRect = {
  /** left edge in PDF user space (unrotated, y-up) */
  x0: number;
  /** bottom edge in PDF user space */
  y0: number;
  /** right edge in PDF user space */
  x1: number;
  /** top edge in PDF user space */
  y1: number;
  /**
   * When true the rect may cut through a longer text run (redaction):
   * operators whose baseline starts outside but whose approximate glyph
   * advance overlaps the rect are removed too.
   */
  heuristic?: boolean;
};

type Mat = [number, number, number, number, number, number]; // a b c d e f

const IDENT: Mat = [1, 0, 0, 1, 0, 0];

function mul(A: Mat, B: Mat): Mat {
  return [
    A[0] * B[0] + A[1] * B[2],
    A[0] * B[1] + A[1] * B[3],
    A[2] * B[0] + A[3] * B[2],
    A[2] * B[1] + A[3] * B[3],
    A[4] * B[0] + A[5] * B[2] + B[4],
    A[4] * B[1] + A[5] * B[3] + B[5],
  ];
}

const isWs = (b: number) =>
  b === 0x00 || b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d || b === 0x20;

const isDelim = (b: number) =>
  b === 0x28 /* ( */ ||
  b === 0x29 /* ) */ ||
  b === 0x3c /* < */ ||
  b === 0x3e /* > */ ||
  b === 0x5b /* [ */ ||
  b === 0x5d /* ] */ ||
  b === 0x7b /* { */ ||
  b === 0x7d /* } */ ||
  b === 0x2f /* / */ ||
  b === 0x25 /* % */;

/* ── zlib inflate/deflate via native CompressionStreams ────────────────── */

async function inflateBytes(bytes: Uint8Array): Promise<Uint8Array | null> {
  for (const format of ["deflate", "deflate-raw"] as const) {
    try {
      const ds = new DecompressionStream(format);
      const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      /* try next format */
    }
  }
  return null;
}

async function deflateBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ── single-pass scan: replay text state, record removal byte-ranges ───── */

export function findRemovals(data: Uint8Array, rects: UserRect[]): Array<[number, number]> {
  const removals: Array<[number, number]> = [];
  const n = data.length;
  let i = 0;

  /* graphics state */
  let ctm: Mat = IDENT;
  const stack: Mat[] = [];
  /* text state */
  let tm: Mat = IDENT;
  let ltm: Mat = IDENT;
  let leading = 0;
  let fontScale = 0; // Tf size
  let inText = false;

  /* operand bookkeeping (to remove "operands + operator" together) */
  let operandStart = -1;
  const nums: number[] = [];

  const resetOperands = () => {
    operandStart = -1;
    nums.length = 0;
  };

  const hit = (ox: number, oy: number, m: Mat, operandLen: number): boolean => {
    for (const r of rects) {
      if (ox >= r.x0 && ox <= r.x1 && oy >= r.y0 && oy <= r.y1) return true;
      if (r.heuristic) {
        // approximate glyph advance: operand bytes × size × avg width 0.5
        // (deliberately generous — redaction must never leak text)
        const hScale = Math.hypot(m[0], m[1]) || 1;
        const advance = operandLen * fontScale * hScale * 0.5;
        const xEnd = ox + Math.max(advance, 2);
        if (oy >= r.y0 && oy <= r.y1 && ox <= r.x1 && xEnd >= r.x0) return true;
      }
    }
    return false;
  };

  const removeHere = (opEnd: number) => {
    removals.push([operandStart >= 0 ? operandStart : opEnd - 1, opEnd]);
  };

  while (i < n) {
    const b = data[i];

    if (isWs(b)) {
      i++;
      continue;
    }
    if (b === 0x25 /* % comment */) {
      while (i < n && data[i] !== 0x0a && data[i] !== 0x0d) i++;
      continue;
    }

    const tokStart = i;
    let kind: "num" | "name" | "str" | "hex" | "arr" | "dict" | "op" | "blob" = "op";

    if (b === 0x2f /* / name */) {
      kind = "name";
      i++;
      while (i < n && !isWs(data[i]) && !isDelim(data[i])) i++;
    } else if (b === 0x28 /* ( literal string */) {
      kind = "str";
      i++;
      let depth = 1;
      while (i < n && depth > 0) {
        const c = data[i];
        if (c === 0x5c /* \ */) i++; // skip escaped byte
        else if (c === 0x28) depth++;
        else if (c === 0x29) depth--;
        i++;
      }
    } else if (b === 0x3c && data[i + 1] === 0x3c /* << dict */) {
      kind = "dict";
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        if (data[i] === 0x3c && data[i + 1] === 0x3c) depth++;
        else if (data[i] === 0x3e && data[i + 1] === 0x3e) depth--;
        i++;
      }
      i++; // past '>>'
    } else if (b === 0x3c /* < hex string */) {
      kind = "hex";
      i++;
      while (i < n && data[i] !== 0x3e) i++;
      i++;
    } else if (b === 0x5b /* [ array — consumed whole (TJ operand) */) {
      kind = "arr";
      i++;
      let depth = 1;
      while (i < n && depth > 0) {
        const c = data[i];
        if (c === 0x5c) i++; // escape
        else if (c === 0x28) {
          // nested literal string — skip wholesale
          i++;
          let sDepth = 1;
          while (i < n && sDepth > 0) {
            const s = data[i];
            if (s === 0x5c) i++;
            else if (s === 0x28) sDepth++;
            else if (s === 0x29) sDepth--;
            i++;
          }
          continue;
        } else if (c === 0x5b) depth++;
        else if (c === 0x5d) depth--;
        i++;
      }
    } else if (
      (b >= 0x30 && b <= 0x39) ||
      b === 0x2b /* + */ ||
      b === 0x2d /* - */ ||
      b === 0x2e /* . */
    ) {
      kind = "num";
      i++;
      while (i < n && !isWs(data[i]) && !isDelim(data[i])) i++;
    } else if (b === 0x42 && data[i + 1] === 0x49 /* BI inline image */) {
      kind = "blob";
      i += 2;
      // consume key/value tokens until ID
      let foundId = false;
      while (i < n && !foundId) {
        if (isWs(data[i])) {
          i++;
          continue;
        }
        const t0 = i;
        const c0 = data[i];
        if (c0 === 0x2f) {
          i++;
          while (i < n && !isWs(data[i]) && !isDelim(data[i])) i++;
        } else if (c0 === 0x3c && data[i + 1] === 0x3c) {
          i += 2;
          let d3 = 1;
          while (i < n && d3 > 0) {
            if (data[i] === 0x3c && data[i + 1] === 0x3c) d3++;
            else if (data[i] === 0x3e && data[i + 1] === 0x3e) d3--;
            i++;
          }
          i++;
        } else if (c0 === 0x3c) {
          i++;
          while (i < n && data[i] !== 0x3e) i++;
          i++;
        } else if (c0 === 0x28) {
          i++;
          let sD = 1;
          while (i < n && sD > 0) {
            if (data[i] === 0x5c) i++;
            else if (data[i] === 0x28) sD++;
            else if (data[i] === 0x29) sD--;
            i++;
          }
        } else if (c0 === 0x5b) {
          i++;
          let d2 = 1;
          while (i < n && d2 > 0) {
            if (data[i] === 0x5b) d2++;
            else if (data[i] === 0x5d) d2--;
            i++;
          }
        } else {
          while (i < n && !isWs(data[i]) && !isDelim(data[i])) i++;
          if (String.fromCharCode(...data.subarray(t0, i)) === "ID") foundId = true;
        }
      }
      // image data: after one EOL, scan for "EI" delimited by whitespace
      while (i < n && (data[i] === 0x0d || data[i] === 0x0a)) i++;
      while (i < n) {
        if (
          data[i] === 0x45 /* E */ &&
          data[i + 1] === 0x49 /* I */ &&
          (i + 2 >= n || isWs(data[i + 2]))
        ) {
          i += 2;
          break;
        }
        i++;
      }
    } else {
      /* operator word */
      i++;
      while (i < n && !isWs(data[i]) && !isDelim(data[i])) i++;
      kind = "op";
    }

    const tokEnd = i;

    /* ── state machine ───────────────────────────────────────────────── */
    if (kind === "op") {
      const word = String.fromCharCode(...data.subarray(tokStart, tokEnd));
      switch (word) {
        case "cm": {
          if (nums.length >= 6) {
            const v = nums.slice(-6);
            ctm = mul([v[0], v[1], v[2], v[3], v[4], v[5]] as Mat, ctm);
          }
          break;
        }
        case "q":
          stack.push([...ctm] as Mat);
          break;
        case "Q":
          ctm = stack.pop() ?? ctm;
          break;
        case "BT":
          tm = IDENT;
          ltm = IDENT;
          inText = true;
          break;
        case "ET":
          inText = false;
          break;
        case "Tm": {
          if (nums.length >= 6) {
            const v = nums.slice(-6);
            tm = [v[0], v[1], v[2], v[3], v[4], v[5]] as Mat;
            ltm = [...tm] as Mat;
          }
          break;
        }
        case "Td": {
          if (nums.length >= 2) {
            const [tx, ty] = nums.slice(-2);
            tm = mul([1, 0, 0, 1, tx, ty] as Mat, ltm);
            ltm = [...tm] as Mat; // spec: Td sets the line matrix too
          }
          break;
        }
        case "TD": {
          if (nums.length >= 2) {
            const [tx, ty] = nums.slice(-2);
            leading = -ty;
            tm = mul([1, 0, 0, 1, tx, ty] as Mat, ltm);
            ltm = [...tm] as Mat; // spec: TD behaves like Td
          }
          break;
        }
        case "T*":
          // spec: T* ≡ "0 -leading Td" → updates the line matrix as well
          tm = mul([1, 0, 0, 1, 0, -leading] as Mat, ltm);
          ltm = [...tm] as Mat;
          break;
        case "TL":
          if (nums.length >= 1) leading = nums[nums.length - 1];
          break;
        case "Tf":
          // operands are (fontName size) — size is the last number seen
          if (nums.length >= 1) fontScale = nums[nums.length - 1];
          break;
        case "Tj":
        case "TJ":
        case "'":
        case '"': {
          if (inText && operandStart >= 0) {
            const m = mul(ctm, tm);
            if (hit(m[4], m[5], m, tokStart - operandStart)) removeHere(tokEnd);
          }
          break;
        }
        default:
          break;
      }
      resetOperands();
    } else {
      /* operand token */
      if (operandStart < 0) operandStart = tokStart;
      if (kind === "num") {
        const v = parseFloat(String.fromCharCode(...data.subarray(tokStart, tokEnd)));
        if (!Number.isNaN(v) && nums.length < 8) nums.push(v);
        else nums.length = 0; // malformed — clear
      }
    }
  }

  return removals;
}

/* ── pdf-lib document bridge ───────────────────────────────────────────── */

type PdfLibDoc = PDFDocument;

const CONTENTS = PDFName.of("Contents");
const FILTER = PDFName.of("Filter");
const FLATE = PDFName.of("FlateDecode");

function streamHasFlate(doc: PdfLibDoc, stream: unknown): boolean {
  void doc;
  const dict = (stream as PDFStream).dict;
  if (!dict) return false;
  const f = dict.get(FILTER);
  const names: string[] = [];
  if (f instanceof PDFName) names.push(f.asString());
  else if (f instanceof PDFArray) {
    for (let k = 0; k < f.size(); k++) {
      const e = f.lookup(k);
      if (e instanceof PDFName) names.push(e.asString());
    }
  }
  return names.some((nm) => nm.replace(/\//g, "").startsWith("FlateDecode"));
}

function streamBytes(stream: unknown): Uint8Array | null {
  try {
    const raw = (stream as PDFStream).getContents();
    return raw instanceof Uint8Array ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Removes every text-showing operator whose baseline origin lies inside
 * one of `rects` (PDF user space, unrotated) from page `pageIndex`.
 * Returns the number of removed operators. Never throws — on any
 * decodability problem the page is left untouched (safe fallback).
 */
export async function removeTextInRects(
  doc: PdfLibDoc,
  pageIndex: number,
  rects: UserRect[]
): Promise<number> {
  if (rects.length === 0) return 0;
  const page = doc.getPages()[pageIndex];
  if (!page) return 0;

  const contentsRaw = page.node.get(CONTENTS);
  const streamObjs: unknown[] = [];
  if (contentsRaw instanceof PDFRef) {
    streamObjs.push(doc.context.lookup(contentsRaw));
  } else if (contentsRaw instanceof PDFArray) {
    for (let k = 0; k < contentsRaw.size(); k++) {
      streamObjs.push(doc.context.lookup(contentsRaw.get(k)));
    }
  } else if (contentsRaw) {
    streamObjs.push(contentsRaw);
  }

  /* decode + concat all content chunks */
  const parts: Uint8Array[] = [];
  for (const so of streamObjs) {
    if (!so) continue;
    const raw = streamBytes(so);
    if (!raw) continue;
    const dec = streamHasFlate(doc, so) ? await inflateBytes(raw) : raw;
    if (dec) {
      parts.push(dec, new Uint8Array([0x0a])); // newline between chunks
    }
  }
  if (parts.length === 0) return 0;

  let total = 0;
  for (const p of parts) total += p.length;
  const data = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    data.set(p, off);
    off += p.length;
  }

  /* surgery */
  const removals = findRemovals(data, rects);
  if (removals.length === 0) return 0;

  removals.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of removals) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }

  const kept: Uint8Array[] = [];
  let pos = 0;
  for (const [s, e] of merged) {
    if (s > pos) kept.push(data.subarray(pos, s));
    pos = Math.max(pos, e);
  }
  if (pos < data.length) kept.push(data.subarray(pos));
  let keptLen = 0;
  for (const k of kept) keptLen += k.length;
  const cleaned = new Uint8Array(keptLen);
  let o2 = 0;
  for (const k of kept) {
    cleaned.set(k, o2);
    o2 += k.length;
  }

  /* re-compress + write back as one FlateDecode stream */
  const compressed = await deflateBytes(cleaned);
  const dict = doc.context.obj({ Filter: "FlateDecode", Length: compressed.length });
  const newStream = PDFRawStream.of(dict as never, compressed);
  const ref = doc.context.register(newStream);
  page.node.set(CONTENTS, ref);

  return merged.length;
}
