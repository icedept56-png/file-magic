/**
 * Localized, user-facing strings for tool processors (errors + progress labels).
 * Non-React module — reads the current language straight from the zustand store.
 */
import { useAppStore, type Lang } from "@/store/app-store";

type MsgFn = (...a: never[]) => string;

type Entry = {
  bn: string | MsgFn;
  en: string | MsgFn;
};

const M = {
  // ── generic / helpers ─────────────────────────────────────────────
  unexpected: {
    bn: "কিছু একটা সমস্যা হয়েছে — আবার চেষ্টা করুন",
    en: "Something went wrong — please try again",
  },
  // ── formats.ts (Day 10) ──────────────────────────────────────────────
  heicFail: {
    bn: (name: string) => `"${name}" HEIC ছবিটি রূপান্তর করা যায়নি — ফাইলটি ক্ষতিগ্রস্ত হতে পারে`,
    en: (name: string) => `Couldn't convert the HEIC image "${name}" — the file may be corrupt`,
  },
  heicNone: {
    bn: "কোনো HEIC/HEIF ছবি পাওয়া যায়নি — iPhone-এর ছবি (.heic) দিন",
    en: "No HEIC/HEIF images found — add iPhone photos (.heic)",
  },
  givePptx: {
    bn: "একটি PPTX ফাইল দিন",
    en: "Add a PPTX file",
  },
  pptxCorrupt: {
    bn: (name: string) => `"${name}" পড়া যায়নি — ফাইলটি ক্ষতিগ্রস্ত বা PPTX নয়`,
    en: (name: string) => `Couldn't read "${name}" — the file may be corrupt or not a PPTX`,
  },
  noSlides: {
    bn: "PPTX-এ কোনো স্লাইড নেই",
    en: "The PPTX has no slides",
  },
  pptxNoText: {
    bn: "স্লাইডে কোনো লেখা পাওয়া যায়নি",
    en: "No text found in the slides",
  },
  giveLegacy: {
    bn: "একটি ODT বা RTF ফাইল দিন",
    en: "Add an ODT or RTF file",
  },
  legacyFail: {
    bn: (name: string) => `"${name}" পড়া যায়নি — ফাইলটি ক্ষতিগ্রস্ত বা সমর্থিত নয়`,
    en: (name: string) => `Couldn't read "${name}" — the file may be corrupt or unsupported`,
  },
  legacyNoText: {
    bn: "ডকুমেন্টে কোনো লেখা পাওয়া যায়নি",
    en: "No text found in the document",
  },
  pdfLoadFail: {
    bn: "পিডিএফটি পড়া যায়নি — ফাইলটি ক্ষতিগ্রস্ত বা পাসওয়ার্ড-সুরক্ষিত হতে পারে",
    en: "Couldn't read the PDF — the file may be corrupt or password-protected",
  },
  pdfOneCorrupt: {
    bn: (name: string) => `"${name}" পিডিএফটি পড়া যায়নি — ফাইলটি ক্ষতিগ্রস্ত বা পাসওয়ার্ড-সুরক্ষিত হতে পারে`,
    en: (name: string) => `Couldn't read "${name}" — the file may be corrupt or password-protected`,
  },
  imageCorrupt: {
    bn: (name: string) => `"${name}" ছবিটি পড়া যায়নি — ফাইলটি ক্ষতিগ্রস্ত হতে পারে`,
    en: (name: string) => `Couldn't read the image "${name}" — the file may be corrupt`,
  },
  imageCreateFail: {
    bn: "ছবি তৈরি করা যায়নি",
    en: "Couldn't create the image",
  },
  canvasFail: {
    bn: "ক্যানভাস তৈরি করা যায়নি",
    en: "Couldn't create a canvas",
  },
  rangeBad: {
    bn: (part: string) => `"${part}" — পেজ রেঞ্জ বুঝতে পারা যায়নি। যেমন: 1-3,5`,
    en: (part: string) => `"${part}" — invalid page range. Try: 1-3,5`,
  },
  noValidPages: {
    bn: "কোনো বৈধ পেজ পাওয়া যায়নি",
    en: "No valid pages found",
  },

  // ── validate.ts (Day 11 — output QA) ─────────────────────────────────
  fileEmpty: {
    bn: (name: string) => `"${name}" ফাইলটি খালি (০ বাইট) — সঠিক ফাইল দিন`,
    en: (name: string) => `The file "${name}" is empty (0 bytes) — add a valid file`,
  },
  fileNotReal: {
    bn: (name: string) =>
      `"${name}"-এর ভেতরের ডেটা তার এক্সটেনশনের সাথে মেলে না — ফাইলটি ক্ষতিগ্রস্ত বা ভুল নামের হতে পারে`,
    en: (name: string) =>
      `The data inside "${name}" doesn't match its extension — the file may be corrupt or misnamed`,
  },

  // ── pdf.ts ────────────────────────────────────────────────────────────
  mergeNeed2: {
    bn: "মার্জ করতে কমপক্ষে ২টি পিডিএফ দিন",
    en: "Add at least 2 PDFs to merge",
  },
  givePdf: {
    bn: "একটি পিডিএফ দিন",
    en: "Add a PDF file",
  },
  tooManyPages: {
    bn: "পেজ সংখ্যা অনেক বেশি — ২০০-এর কম পেজের পিডিএফ দিন",
    en: "Too many pages — use a PDF with fewer than 200 pages",
  },
  pageRenderFail: {
    bn: (n: number) => `পেজ ${n} রেন্ডার করা যায়নি — পিডিএফটি ক্ষতিগ্রস্ত হতে পারে`,
    en: (n: number) => `Page ${n} couldn't be rendered — the PDF may be corrupt`,
  },
  needPagesInput: {
    bn: "কোন কোন পেজ মুছবেন লিখুন (যেমন: 2,4-6)",
    en: "Enter which pages to delete (e.g. 2,4-6)",
  },
  cantDeleteAll: {
    bn: "সব পেজ মুছে ফেলা যাবে না — অন্তত একটি পেজ থাকতে হবে",
    en: "Can't delete every page — at least one must remain",
  },
  pdfNoText: {
    bn: "এই পিডিএফে কোনো টেক্সট পাওয়া যায়নি — সম্ভবত এটি স্ক্যান করা ছবি",
    en: "No text found in this PDF — it's probably a scanned image",
  },
  pdfNoTextWord: {
    bn: "এই পিডিএফে কোনো লেখা পাওয়া যায়নি — স্ক্যান করা পিডিএফ থেকে সরাসরি Word বানানো যায় না",
    en: "No text found in this PDF — a scanned PDF can't be turned into Word directly",
  },

  // ── image.ts ──────────────────────────────────────────────────────────
  needImage: {
    bn: "অন্তত একটি ছবি দিন",
    en: "Add at least one image",
  },
  needWidthOrHeight: {
    bn: "প্রস্থ বা উচ্চতা — যেকোনো একটি দিন",
    en: "Enter a width or a height — at least one",
  },

  // ── docs.ts ───────────────────────────────────────────────────────────
  pdfRenderFail: {
    bn: "পিডিএফ রেন্ডার করা যায়নি — ডকুমেন্টটি খুব বড় বা অস্বাভাবিক হতে পারে",
    en: "Couldn't render the PDF — the document may be too large or unusual",
  },
  docTooBig: {
    bn: "ডকুমেন্টটি অনেক বড় — ৮০ পেজের বেশি বানানো যাচ্ছে না",
    en: "The document is too large — max 80 pages",
  },
  docxOpenFail: {
    bn: (name: string) => `"${name}" খোলা যায়নি — এটি কি সঠিক .docx ফাইল?`,
    en: (name: string) => `Couldn't open "${name}" — is it a valid .docx file?`,
  },
  needDocx: {
    bn: "অন্তত একটি Word (.docx) ফাইল দিন",
    en: "Add at least one Word (.docx) file",
  },
  needText: {
    bn: "আগে কিছু লিখুন অথবা .txt ফাইল দিন",
    en: "Write something first or add a .txt file",
  },
  needMarkdown: {
    bn: "মার্কডাউন লিখুন বা .md ফাইল দিন",
    en: "Write Markdown or add a .md file",
  },
  needHtml: {
    bn: "HTML কোড লিখুন অথবা .html ফাইল দিন",
    en: "Write HTML code or add an .html file",
  },

  // ── data.ts ───────────────────────────────────────────────────────────
  excelCorrupt: {
    bn: "এক্সেল ফাইলটি পড়া যায়নি — ফাইলটি ক্ষতিগ্রস্ত হতে পারে",
    en: "Couldn't read the Excel file — it may be corrupt",
  },
  noSheets: {
    bn: "ফাইলের ভেতরে কোনো শিট নেই",
    en: "There are no sheets inside the file",
  },
  giveExcel: {
    bn: "একটি এক্সেল ফাইল দিন",
    en: "Add an Excel file",
  },
  giveZip: {
    bn: "একটি ZIP ফাইল দিন",
    en: "Add a ZIP file",
  },
  csvOpenFail: {
    bn: (name: string) => `"${name}" পড়া যায়নি — এটি কি সঠিক CSV ফাইল?`,
    en: (name: string) => `Couldn't read "${name}" — is it a valid CSV file?`,
  },
  csvNoData: {
    bn: (name: string) => `"${name}"-এ কোনো ডেটা পাওয়া যায়নি`,
    en: (name: string) => `No data found in "${name}"`,
  },
  needCsv: {
    bn: "অন্তত একটি CSV ফাইল দিন",
    en: "Add at least one CSV file",
  },
  zipNeed1: {
    bn: "ZIP করতে অন্তত একটি ফাইল দিন",
    en: "Add at least one file to create a ZIP",
  },
  zipOpenFail: {
    bn: "ZIP ফাইলটি খোলা যায়নি — ফাইলটি ক্ষতিগ্রস্ত হতে পারে",
    en: "Couldn't open the ZIP — it may be corrupt",
  },
  zipEmpty: {
    bn: "ZIP ফাইলটি খালি বা পড়া যায়নি",
    en: "The ZIP is empty or unreadable",
  },
  zipTooMany: {
    bn: "ZIP-এ ৩০০+ ফাইল আছে — এতগুলো একসাথে বের করা যাবে না",
    en: "The ZIP has 300+ files — can't extract that many at once",
  },
  jsonEmpty: {
    bn: "JSON লিখুন অথবা ফাইল দিন",
    en: "Write JSON or add a file",
  },
  jsonInvalid: {
    bn: (m: string) => "অবৈধ JSON — " + m,
    en: (m: string) => "Invalid JSON — " + m,
  },
  b64DecodeEmpty: {
    bn: "ডিকোড করার জন্য Base64 টেক্সট দিন বা ফাইল দিন",
    en: "Provide Base64 text or a file to decode",
  },
  b64Invalid: {
    bn: "এটি বৈধ Base64 নয়",
    en: "This isn't valid Base64",
  },
  b64EncodeEmpty: {
    bn: "এনকোড করার জন্য একটি ফাইল দিন",
    en: "Add a file to encode",
  },
  qrEmpty: {
    bn: "QR-এ যা রাখতে চান তা লিখুন",
    en: "Write what you want to put in the QR",
  },
  qrTooLong: {
    bn: "লেখাটি খুব বড় — QR-এর জন্য ছোট করুন",
    en: "The text is too long — shorten it for the QR",
  },
  qrFail: {
    bn: "QR কোড তৈরি করা যায়নি — লেখাটি বদলে আবার চেষ্টা করুন",
    en: "Couldn't generate the QR — try different text",
  },

  // ── progress labels ───────────────────────────────────────────────────
  pFile: { bn: (a: number, b: number) => `ফাইল ${a}/${b}`, en: (a: number, b: number) => `File ${a}/${b}` },
  pPage: { bn: (a: number, b: number) => `পেজ ${a}/${b}`, en: (a: number, b: number) => `Page ${a}/${b}` },
  pImage: { bn: (a: number, b: number) => `ছবি ${a}/${b}`, en: (a: number, b: number) => `Image ${a}/${b}` },
  pSheet: { bn: (a: number, b: number) => `শিট ${a}/${b}`, en: (a: number, b: number) => `Sheet ${a}/${b}` },
  pOpening: { bn: "খোলা হচ্ছে...", en: "Opening..." },
  pSaving: { bn: "সেভ হচ্ছে...", en: "Saving..." },
  pCompressing: { bn: "কম্প্রেস হচ্ছে...", en: "Compressing..." },
  pRendering: { bn: "রেন্ডার হচ্ছে...", en: "Rendering..." },
  pRotating: { bn: "ঘোরানো হচ্ছে...", en: "Rotating..." },
  pDrawingWatermark: { bn: "ওয়াটারমার্ক আঁকা হচ্ছে...", en: "Drawing watermark..." },
  pDeletingPages: { bn: "পেজ মুছে ফেলা হচ্ছে...", en: "Deleting pages..." },
  pAssemblingPdf: { bn: "পিডিএফ সাজানো হচ্ছে...", en: "Assembling PDF..." },
  pDone: { bn: "সম্পন্ন", en: "Done" },
  pZipMaking: { bn: "ZIP বানানো হচ্ছে...", en: "Creating ZIP..." },
  pZipMaking2: { bn: "ZIP তৈরি হচ্ছে...", en: "Creating ZIP..." },
  pWordMaking: { bn: "Word ডকুমেন্ট তৈরি হচ্ছে...", en: "Creating Word document..." },
  pDocxMaking: { bn: "ডকুমেন্ট তৈরি হচ্ছে...", en: "Creating document..." },
  pMdProcessing: { bn: "মার্কডাউন প্রসেস হচ্ছে...", en: "Processing Markdown..." },
  pExcelMaking: { bn: "এক্সেল ফাইল তৈরি হচ্ছে...", en: "Creating Excel file..." },
  pDecoding: { bn: "ডিকোড হচ্ছে...", en: "Decoding..." },
  pEncoding: { bn: "এনকোড হচ্ছে...", en: "Encoding..." },
  pQrMaking: { bn: "QR তৈরি হচ্ছে...", en: "Generating QR..." },
  pImageMaking: { bn: "ছবি তৈরি হচ্ছে...", en: "Creating image..." },
} satisfies Record<string, Entry>;

export type MsgKey = keyof typeof M;

function text(key: MsgKey, args: (string | number)[], lang: Lang): string {
  const entry = M[key];
  const val = entry[lang];
  if (typeof val === "function") {
    return (val as unknown as (...a: (string | number)[]) => string)(...args);
  }
  return val;
}

/** localized error — throw msg("key", ...) */
export function err(key: MsgKey, ...args: (string | number)[]): Error {
  return new Error(text(key, args, useAppStore.getState().lang));
}

/** localized progress label — onProgress(50, pLabel("pPage", 1, 3)) */
export function pLabel(key: MsgKey, ...args: (string | number)[]): string {
  return text(key, args, useAppStore.getState().lang);
}
