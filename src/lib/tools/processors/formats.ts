/** Format-coverage processors (Day 10) — HEIC, PPTX text, ODT/RTF readers. All client-side. */
import type { OutputFile, ToolOptions, ProgressFn } from "../types";
import { readText, safeName, stripExt } from "../helpers";
import { err } from "../messages";

const HEIC_EXT = /\.(heic|heif)$/i;
const isHeic = (f: File) => /^image\/hei[cf]$/.test((f.type || "").toLowerCase()) || HEIC_EXT.test(f.name);

/* ─── HEIC / HEIF → JPEG or PNG (libheif via heic2any) ─────────────────── */

/**
 * Decode HEIC/HEIF to a normal raster File; pass anything else through.
 * Wired into the shared image decoders so batch/convert/compress/resize
 * all accept iPhone photos transparently.
 */
export async function ensureDecoded(file: File): Promise<File> {
  if (!isHeic(file)) return file;
  try {
    const heic2any = (await import("heic2any")).default;
    const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    const blob = Array.isArray(out) ? out[0] : out;
    return new File([blob], `${stripExt(file.name)}.jpg`, { type: "image/jpeg" });
  } catch (e) {
    const marked = e as { fmKey?: string };
    if (marked?.fmKey) throw e;
    const failure = err("heicFail", file.name);
    (failure as { fmKey?: string }).fmKey = "heicFail";
    throw failure;
  }
}

export async function heicConvert(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const targets = files.filter(isHeic);
  if (targets.length === 0) throw err("heicNone");
  const format = opts.format === "png" ? "png" : "jpeg";
  const quality = Math.min(100, Math.max(30, Number(opts.quality) || 90)) / 100;

  const heic2any = (await import("heic2any")).default;
  const out: OutputFile[] = [];
  for (let i = 0; i < targets.length; i++) {
    const f = targets[i];
    onProgress(Math.round((i / targets.length) * 92), `${i + 1}/${targets.length}`);
    try {
      const res = await heic2any({
        blob: f,
        toType: format === "png" ? "image/png" : "image/jpeg",
        quality,
      });
      const blob = Array.isArray(res) ? res[0] : res;
      const ext = format === "png" ? "png" : "jpg";
      out.push({
        name: `${stripExt(safeName(f.name))}.${ext}`,
        blob: new Blob([blob as BlobPart], { type: blob.type || `image/${format}` }),
      });
    } catch {
      throw err("heicFail", f.name);
    }
  }
  onProgress(100);
  return out;
}

/* ─── PPTX → text (slides in order) ────────────────────────────────────── */

export async function pptxText(
  files: File[],
  _opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const file = files[0];
  if (!file) throw err("givePptx");
  const JSZip = (await import("jszip")).default;
  let zip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw err("pptxCorrupt", file.name);
  }
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)![1]);
      const nb = Number(b.match(/slide(\d+)\.xml$/)![1]);
      return na - nb;
    });
  if (slideNames.length === 0) throw err("noSlides");

  const parser = new DOMParser();
  const parts: string[] = [];
  for (let i = 0; i < slideNames.length; i++) {
    onProgress(Math.round(((i + 1) / slideNames.length) * 95), `${i + 1}/${slideNames.length}`);
    const xml = await zip.files[slideNames[i]].async("string");
    const dom = parser.parseFromString(xml, "application/xml");
    if (dom.querySelector("parsererror")) throw err("pptxCorrupt", file.name);
    // <a:p> = paragraph; a:t = text run. Collect paragraph-wise.
    const paras = Array.from(dom.getElementsByTagNameNS("*", "p")).filter((p) =>
      p.namespaceURI?.includes("drawingml")
    );
    const lines = paras
      .map((p) =>
        Array.from(p.getElementsByTagNameNS("*", "t"))
          .map((t) => t.textContent ?? "")
          .join("")
          .trim()
      )
      .filter(Boolean);
    parts.push(`── Slide ${i + 1} ──\n${lines.join("\n")}`);
  }
  const text = parts.join("\n\n").trim();
  if (!text) throw err("pptxNoText");
  onProgress(100);
  return [
    { name: `${stripExt(safeName(file.name))}.txt`, blob: new Blob([text], { type: "text/plain;charset=utf-8" }) },
  ];
}

/* ─── ODT / RTF → text ─────────────────────────────────────────────────── */

async function odtToText(file: File, onProgress: ProgressFn): Promise<string> {
  const JSZip = (await import("jszip")).default;
  let zip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw err("legacyFail", file.name);
  }
  const entry = zip.file("content.xml");
  if (!entry) throw err("legacyFail", file.name);
  onProgress(40);
  const xml = await entry.async("string");
  const dom = new DOMParser().parseFromString(xml, "application/xml");
  if (dom.querySelector("parsererror")) throw err("legacyFail", file.name);
  const body = dom.getElementsByTagNameNS("*", "body")[0];
  if (!body) throw err("legacyFail", file.name);
  const lines: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent) lines.push(node.textContent);
      return;
    }
    const el = node as Element;
    const local = el.localName;
    if (local === "h" || local === "p") {
      const buf: string[] = [];
      const inner = (n: Node) => {
        if (n.nodeType === Node.TEXT_NODE) {
          buf.push(n.textContent ?? "");
          return;
        }
        if (n.nodeType !== Node.ELEMENT_NODE) return;
        const e = n as Element;
        if (e.localName === "tab") buf.push("\t");
        else if (e.localName === "line-break") buf.push("\n");
        else if (e.localName === "s") buf.push(" ".repeat(Math.max(1, Number(e.getAttribute("text:c") || 1))));
        else e.childNodes.forEach(inner);
      };
      el.childNodes.forEach(inner);
      const line = buf.join("").trimEnd();
      lines.push(local === "h" ? `\n## ${line}` : line);
      return;
    }
    el.childNodes.forEach(walk);
  };
  body.childNodes.forEach(walk);
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw err("legacyNoText");
  onProgress(95);
  return text;
}

/** cp1252 high-byte map (0x80–0x9F differ from Latin-1) */
const CP1252_HIGH: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡",
  0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘",
  0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜",
  0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};
const cp1252 = (byte: number): string =>
  CP1252_HIGH[byte] ?? String.fromCharCode(byte);

async function rtfToText(file: File, onProgress: ProgressFn): Promise<string> {
  const raw = await readText(file);
  onProgress(40);
  if (!/\{\\rtf/i.test(raw)) throw err("legacyFail", file.name);
  const decoded = raw.replace(
    /\\u(-?\d+)\s?\??/g,
    (_m, n) => String.fromCharCode(((Number(n) % 65536) + 65536) % 65536)
  );
  let out = "";
  let skipGroup = 0;
  for (let i = 0; i < decoded.length; i++) {
    const ch = decoded[i];
    if (ch === "{") {
      // skip destination groups (fonttbl, colortbl, stylesheet, info...)
      const rest = decoded.slice(i, i + 24);
      if (/^\{\\\*?\\(fonttbl|colortbl|stylesheet|info|generator|pict|object|themedata|datastore|listtable|listoverridetable|rsidtbl)/i.test(rest)) {
        skipGroup++;
        continue;
      }
      continue;
    }
    if (ch === "}") {
      if (skipGroup > 0) skipGroup--;
      continue;
    }
    if (skipGroup > 0) continue;
    if (ch === "\\") {
      const m = /^\\([a-z]+)(-?\d+)? ?/i.exec(decoded.slice(i));
      if (m) {
        const word = m[1].toLowerCase();
        if (word === "par" || word === "sect") out += "\n";
        else if (word === "line") out += "\n";
        else if (word === "tab") out += "\t";
        else if (word === "emdash") out += "—";
        else if (word === "endash") out += "–";
        else if (word === "bullet") out += "•";
        else if (word === "lquote") out += "‘";
        else if (word === "rquote") out += "’";
        else if (word === "ldblquote") out += "“";
        else if (word === "rdblquote") out += "”";
        i += m[0].length - 1;
        continue;
      }
      const esc = /^\\'([0-9a-f]{2})/i.exec(decoded.slice(i));
      if (esc) {
        out += cp1252(parseInt(esc[1], 16));
        i += 3;
        continue;
      }
      if (decoded[i + 1] === "*" || decoded[i + 1] === "{" || decoded[i + 1] === "}" || decoded[i + 1] === "\\") {
        i++; // escaped literal
        continue;
      }
      continue;
    }
    if (ch === "\n" || ch === "\r") continue; // RTF newlines are formatting noise
    out += ch;
  }
  const text = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw err("legacyNoText");
  onProgress(95);
  return text;
}

export async function odtRtfToText(
  files: File[],
  _opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const file = files[0];
  if (!file) throw err("giveLegacy");
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = head[0] === 0x50 && head[1] === 0x4b; // PK → ODT
  const text = isZip ? await odtToText(file, onProgress) : await rtfToText(file, onProgress);
  onProgress(100);
  return [
    { name: `${stripExt(safeName(file.name))}.txt`, blob: new Blob([text], { type: "text/plain;charset=utf-8" }) },
  ];
}
