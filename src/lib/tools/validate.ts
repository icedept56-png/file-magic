/**
 * File validation (Day 11 — output QA, 100% client-side).
 *
 * Two jobs:
 *  1. preflightInputs() — before a tool runs, reject files that are empty or
 *     whose bytes contradict their extension (disguised/corrupt files) with a
 *     friendly, localized error that names the file.
 *  2. checkOutput() — after a tool runs, verify each output blob still
 *     matches what its name promises (magic bytes + non-empty) so the UI can
 *     show a trust badge (or a warning) per row.
 *
 * Only extensions with well-known, unambiguous signatures are checked.
 * Text formats (txt/csv/json/html/md/svg…) and unknown extensions pass with
 * a non-empty check only — too many legitimate edge cases to sniff safely.
 */

type SigCheck = (head: Uint8Array) => boolean;

const at = (b: Uint8Array, i: number, s: string): boolean => {
  for (let k = 0; k < s.length; k++) {
    if (b[i + k] !== s.charCodeAt(k)) return false;
  }
  return true;
};

/** ZIP family: docx/xlsx/pptx/odt/zip all start with PK\x03\x04 */
const PK: SigCheck = (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const RIFF: SigCheck = (b) => at(b, 0, "RIFF");
const FTYP: SigCheck = (b) => at(b, 4, "ftyp");

const HEIC_BRANDS = new Set([
  "heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1", "mif2",
]);

const SIGS: Record<string, SigCheck> = {
  // documents
  pdf: (b) => at(b, 0, "%PDF-"),
  docx: PK,
  xlsx: PK,
  pptx: PK,
  odt: PK,
  doc: (b) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0,
  xls: (b) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0,
  rtf: (b) => at(b, 0, "{\\rtf"),
  zip: PK,
  // images
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  webp: (b) => RIFF(b) && at(b, 8, "WEBP"),
  gif: (b) => at(b, 0, "GIF8"),
  bmp: (b) => b[0] === 0x42 && b[1] === 0x4d,
  heic: (b) => FTYP(b) && HEIC_BRANDS.has(String.fromCharCode(b[8], b[9], b[10], b[11])),
  heif: (b) => FTYP(b) && HEIC_BRANDS.has(String.fromCharCode(b[8], b[9], b[10], b[11])),
  // audio
  mp3: (b) =>
    at(b, 0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  wav: (b) => RIFF(b) && at(b, 8, "WAVE"),
  ogg: (b) => at(b, 0, "OggS"),
  oga: (b) => at(b, 0, "OggS"),
  flac: (b) => at(b, 0, "fLaC"),
  m4a: FTYP,
  mp4: FTYP,
};

/** lowercase extension of a filename ("" when none) */
export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Read just the first bytes of a file — cheap even for huge inputs */
async function headOf(blob: Blob, n = 12): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(0, n).arrayBuffer());
}

export type CheckResult = "ok" | "empty" | "signature";

/**
 * Validate one output blob against the promise its filename makes.
 * Never throws — the caller decides how to surface a failure.
 */
export async function checkOutput(name: string, blob: Blob): Promise<CheckResult> {
  if (!blob || blob.size === 0) return "empty";
  const sig = SIGS[extOf(name)];
  if (!sig) return "ok"; // text/unknown: size check is enough
  try {
    const head = await headOf(blob, 12);
    return sig(head) ? "ok" : "signature";
  } catch {
    return "ok"; // can't read → don't block the user on our own failure
  }
}

/**
 * Pre-flight the user's input files BEFORE any tool runs.
 * Throws a localized Error (messages.ts) naming the offending file:
 *  - empty files (0 bytes)
 *  - binary formats whose magic bytes contradict their extension
 *    (a .jpg that is actually text, a truncated/corrupt .png, …)
 *
 * Read failures themselves are tolerated here — the tool's own loader will
 * report them with its specific, friendlier message.
 */
export async function preflightInputs(files: File[]): Promise<void> {
  const { err } = await import("./messages");
  for (const f of files) {
    if (f.size === 0) throw err("fileEmpty", f.name);
    const sig = SIGS[extOf(f.name)];
    if (!sig || f.size < 4) continue;
    let head: Uint8Array;
    try {
      head = await headOf(f, 12);
    } catch {
      continue; // unreadable here → let the processor's own error handle it
    }
    if (!sig(head)) throw err("fileNotReal", f.name);
  }
}
