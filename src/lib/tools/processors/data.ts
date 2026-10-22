/** Data processors — xlsx, jszip, qrcode, base64/json utilities */
import type { OutputFile, ToolOptions, ProgressFn } from "../types";
import { readArrayBuffer, readText, stripExt, safeName, bufferToBase64, base64ToUint8, canvasToBlob } from "../helpers";
import { err, pLabel } from "../messages";

/** Case-insensitive unique name helper (appends -2, -3, ... on collision) */
function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  const name = `${base}-${n}`;
  used.add(name);
  return name;
}

/** Excel-safe sheet name: no []:*?/\ chars, max 31 chars */
function sheetNameFor(fileName: string, used: Set<string>): string {
  const base = stripExt(fileName).replace(/[\[\]:*?/\\]+/g, " ").trim().slice(0, 31);
  return uniqueName(base || "Sheet", used);
}

/* ─── 1. XLSX → CSV ────────────────────────────────────────────────────── */

export async function xlsxToCsv(
  files: File[],
  _opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const file = files[0];
  if (!file) throw err("giveExcel");
  const XLSX = await import("xlsx");
  let wb: ReturnType<typeof XLSX.read>;
  try {
    wb = XLSX.read(await readArrayBuffer(file), { type: "array" });
  } catch {
    throw err("excelCorrupt");
  }
  const names = wb.SheetNames;
  if (!names.length) throw err("noSheets");
  const base = stripExt(file.name);

  if (names.length === 1) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[names[0]]);
    onProgress(100, pLabel("pDone"));
    return [{ name: `${base}.csv`, blob: new Blob([csv], { type: "text/csv;charset=utf-8" }) }];
  }

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const used = new Set<string>();
  for (let i = 0; i < names.length; i++) {
    onProgress(Math.round((i / names.length) * 88), pLabel("pSheet", i + 1, names.length));
    const entry = uniqueName(
      names[i].replace(/[\[\]:*?/\\]+/g, " ").trim().slice(0, 60) || `sheet-${i + 1}`,
      used
    );
    zip.file(`${entry}.csv`, XLSX.utils.sheet_to_csv(wb.Sheets[names[i]]));
  }
  onProgress(92, pLabel("pZipMaking"));
  const zipBlob: Blob = await zip.generateAsync<"blob">({ compression: "STORE" });
  onProgress(100, pLabel("pDone"));
  return [{ name: `${base}-csv.zip`, blob: zipBlob }];
}

/* ─── 2. CSV → XLSX ────────────────────────────────────────────────────── */

export async function csvToXlsx(
  files: File[],
  _opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  if (!files.length) throw err("needCsv");
  const XLSX = await import("xlsx");
  const newWb = XLSX.utils.book_new();
  const used = new Set<string>();

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress(Math.round((i / files.length) * 85), pLabel("pFile", i + 1, files.length));
    let wb: ReturnType<typeof XLSX.read>;
    try {
      wb = XLSX.read(await readText(f), { type: "string", raw: false });
    } catch {
      throw err("csvOpenFail", f.name);
    }
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw err("csvNoData", f.name);
    XLSX.utils.book_append_sheet(newWb, ws, sheetNameFor(f.name, used));
  }

  onProgress(92, pLabel("pExcelMaking"));
  const out: Uint8Array = XLSX.write(newWb, { bookType: "xlsx", type: "array" });
  onProgress(100, pLabel("pDone"));
  const outName = files.length === 1 ? `${stripExt(files[0].name)}.xlsx` : "combined.xlsx";
  return [
    {
      name: outName,
      blob: new Blob([out as unknown as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    },
  ];
}

/* ─── 3. XLSX → JSON ───────────────────────────────────────────────────── */

export async function xlsxToJson(
  files: File[],
  _opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const file = files[0];
  if (!file) throw err("giveExcel");
  const XLSX = await import("xlsx");
  let wb: ReturnType<typeof XLSX.read>;
  try {
    wb = XLSX.read(await readArrayBuffer(file), { type: "array" });
  } catch {
    throw err("excelCorrupt");
  }
  const names = wb.SheetNames;
  if (!names.length) throw err("noSheets");

  let json: string;
  if (names.length === 1) {
    json = JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets[names[0]], { defval: null }), null, 2);
  } else {
    const obj: Record<string, unknown[]> = {};
    for (let i = 0; i < names.length; i++) {
      onProgress(Math.round((i / names.length) * 85) + 5, pLabel("pSheet", i + 1, names.length));
      obj[names[i]] = XLSX.utils.sheet_to_json(wb.Sheets[names[i]], { defval: null });
    }
    json = JSON.stringify(obj, null, 2);
  }
  onProgress(100, pLabel("pDone"));
  return [
    { name: `${stripExt(file.name)}.json`, blob: new Blob([json], { type: "application/json;charset=utf-8" }) },
  ];
}

/* ─── 4. Create ZIP ────────────────────────────────────────────────────── */

export async function createZip(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  if (!files.length) throw err("zipNeed1");
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  // JSZip silently OVERWRITES entries with the same name — dedupe to avoid data loss
  const used = new Set<string>();
  for (const f of files) {
    const base = safeName(f.name) || "file";
    const name = uniqueName(base, used);
    zip.file(name, f);
  }
  const level = Math.min(9, Math.max(0, Number(opts.level ?? 6)));
  const blob: Blob = await zip.generateAsync<"blob">(
    level === 0
      ? { compression: "STORE" }
      : { compression: "DEFLATE", compressionOptions: { level } },
    (meta) => onProgress(Math.round(meta.percent), pLabel("pZipMaking2"))
  );
  onProgress(100, pLabel("pDone"));
  return [{ name: "archive.zip", blob }];
}

/* ─── 5. Extract ZIP ───────────────────────────────────────────────────── */

export async function extractZip(
  files: File[],
  _opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const file = files[0];
  if (!file) throw err("giveZip");
  const JSZip = (await import("jszip")).default;
  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>;
  try {
    zip = await JSZip.loadAsync(await readArrayBuffer(file));
  } catch {
    throw err("zipOpenFail");
  }
  const entries = Object.values(zip.files).filter((e) => !e.dir);
  if (entries.length === 0) throw err("zipEmpty");
  if (entries.length > 300) throw err("zipTooMany");

  const out: OutputFile[] = [];
  const used = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    onProgress(Math.round((i / entries.length) * 92) + 4, pLabel("pFile", i + 1, entries.length));
    const blob = await entry.async("blob");
    const base = safeName(entry.name.split("/").pop() || `file-${i + 1}`);
    // nested paths are flattened; duplicates get an index prefix
    const name = used.has(base) ? `${String(i + 1).padStart(3, "0")}-${base}` : base;
    used.add(name);
    out.push({ name, blob: new Blob([blob], { type: "application/octet-stream" }) });
  }
  onProgress(100, pLabel("pDone"));
  return out;
}

/* ─── 6. Format JSON ───────────────────────────────────────────────────── */

export async function formatJson(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const text = files.length ? await readText(files[0]) : String(opts.text ?? "");
  if (!text.trim()) throw err("jsonEmpty");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw err("jsonInvalid", (e as Error).message);
  }
  const mode = String(opts.mode || "pretty2");
  let out: string;
  if (mode === "minify") out = JSON.stringify(parsed);
  else if (mode === "tab") out = JSON.stringify(parsed, null, "\t");
  else if (mode === "pretty4") out = JSON.stringify(parsed, null, 4);
  else out = JSON.stringify(parsed, null, 2);
  onProgress(100, pLabel("pDone"));
  return [
    { name: "formatted.json", blob: new Blob([out], { type: "application/json;charset=utf-8" }) },
  ];
}

/* ─── 7. Base64 ────────────────────────────────────────────────────────── */

export async function convertBase64(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const mode = String(opts.mode || "encode");

  if (mode === "decode") {
    const text = files.length ? await readText(files[0]) : String(opts.text ?? "");
    if (!text.trim()) throw err("b64DecodeEmpty");
    onProgress(40, pLabel("pDecoding"));
    let bytes: Uint8Array;
    try {
      bytes = base64ToUint8(text);
    } catch {
      throw err("b64Invalid");
    }
    const name = safeName(String(opts.filename || "").trim() || "decoded.bin");
    onProgress(100, pLabel("pDone"));
    return [{ name, blob: new Blob([bytes as unknown as BlobPart], { type: "application/octet-stream" }) }];
  }

  if (!files.length) throw err("b64EncodeEmpty");
  onProgress(40, pLabel("pEncoding"));
  const b64 = bufferToBase64(await readArrayBuffer(files[0]));
  onProgress(100, pLabel("pDone"));
  return [
    {
      name: `${stripExt(files[0].name)}.base64.txt`,
      blob: new Blob([b64], { type: "text/plain;charset=utf-8" }),
    },
  ];
}

/* ─── 8. QR Code ───────────────────────────────────────────────────────── */

export async function generateQr(
  _files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const text = String(opts.text ?? "").trim();
  if (!text) throw err("qrEmpty");
  if (text.length > 2000) throw err("qrTooLong");
  const size = Math.min(2048, Math.max(128, Number(opts.size) || 512));

  onProgress(30, pLabel("pQrMaking"));
  const QRCode = (await import("qrcode")).default;
  const canvas = document.createElement("canvas");
  try {
    await QRCode.toCanvas(canvas, text, {
      width: size,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#065f46", light: "#ffffff" },
    });
  } catch {
    throw err("qrFail");
  }
  onProgress(80, pLabel("pImageMaking"));
  const blob = await canvasToBlob(canvas, "image/png");
  onProgress(100, pLabel("pDone"));
  return [{ name: "qr-code.png", blob }];
}
