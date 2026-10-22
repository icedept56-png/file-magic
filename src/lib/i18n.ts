"use client";

import { useAppStore, type Lang } from "@/store/app-store";
import { toBn } from "@/lib/tools/helpers";

/** UI string dictionary — key: [Bengali, English] */
const STR = {
  // brand / navbar
  brandName: ["ফাইল ম্যাজিক", "File Magic"],
  brandTagline: ["সব ফাইলের সম্পূর্ণ সমাধান", "Every file, one place"],
  allTools: ["সব টুল", "All tools"],
  install: ["ইনস্টল করুন", "Install app"],
  installAria: ["অ্যাপ ইনস্টল করুন", "Install the app"],
  backHomeAria: ["ফাইল ম্যাজিক — হোমে ফিরে যান", "File Magic — back to home"],
  mainMenuAria: ["প্রধান মেনু", "Main menu"],
  languageAria: ["ভাষা বাছাই", "Language selection"],

  // home header
  quickStart: ["জলদি শুরু করুন", "Jump right in"],
  searchPlaceholder: ["টুল খুঁজুন... (যেমন: পিডিএফ, ছবি, কম্প্রেস)", "Search tools... (e.g. pdf, image, compress)"],
  searchAria: ["টুল খুঁজুন", "Search tools"],
  clearSearch: ["সার্চ মুছুন", "Clear search"],
  statTools: ["টুল", "tools"],
  statPrivate: ["১০০% প্রাইভেট", "100% private"],
  statSpeed: ["বজ্রগতি", "Lightning fast"],
  statOffline: ["অফলাইনেও চলে", "Works offline"],
  freeForever: ["সম্পূর্ণ ফ্রি", "Completely free"],

  // featured
  featuredStart: ["শুরু করুন", "Get started"],
  featuredAria: ["জনপ্রিয় টুল", "Popular tools"],
  featuredHeroBadge: ["সবচেয়ে জনপ্রিয়", "Most popular"],

  // grid
  browseAll: ["সব টুল একসাথে", "Browse every tool"],
  toolCount: ["টি টুল", "tools"],
  noMatch: ["কোনো টুল মেলেনি", "No tools matched"],
  noMatchHint: ["অন্য কিছু লিখে খুঁজে দেখুন অথবা সব টুল ব্রাউজ করুন।", "Try a different keyword, or browse all tools."],
  seeAll: ["সব টুল দেখুন", "See all tools"],
  textInputBadge: ["টেক্সট ইনপুট", "Text input"],

  // recent
  recent: ["সাম্প্রতিক", "Recent"],
  recentAria: ["সাম্প্রতিক ব্যবহৃত টুল", "Recently used tools"],
  clearRecent: ["সাম্প্রতিক তালিকা মুছুন", "Clear recent list"],

  // workspace
  addFileAria: ["ফাইল যোগ করুন", "Add files"],
  dropHere: ["ফাইল টেনে আনুন অথবা ক্লিক করুন", "Drag files here or click to browse"],
  multipleOk: ["একাধিক ফাইল দেওয়া যাবে", "Multiple files allowed"],
  oneOnly: ["একটি ফাইল দিন", "One file only"],
  settings: ["সেটিংস", "Settings"],
  remove: ["সরান", "Remove"],
  download: ["ডাউনলোড", "Download"],
  downloadAllZip: ["সব ডাউনলোড (ZIP)", "Download all (ZIP)"],
  zipMaking: ["ZIP তৈরি হচ্ছে...", "Creating ZIP..."],
  working: ["কাজ চলছে...", "Working..."],
  chooseOne: ["বাছুন", "Choose"],
  needText: ["আগে লেখা দিন", "Write something first"],
  needFile: ["প্রথমে ফাইল যোগ করুন", "Add a file first"],
  doneToast: ["সফলভাবে সম্পন্ন হয়েছে!", "Done successfully!"],
  noOutputErr: ["কোনো ফাইল তৈরি হয়নি", "No files were produced"],
  genericErr: ["কিছু একটা সমস্যা হয়েছে", "Something went wrong"],
  zipDoneToast: ["ZIP ফাইল তৈরি হয়েছে", "ZIP file created"],
  zipFailToast: ["ZIP তৈরি করা যায়নি", "Couldn't create the ZIP"],
  doneBanner: ["সম্পন্ন! নিচের ফাইলগুলো ডাউনলোড করুন", "Done! Download your files below"],
  smallerBy: ["ছোট হয়েছে", "smaller"],
  startFresh: ["নতুন কাজ শুরু করুন", "Start over"],
  errTitle: ["সমস্যা হয়েছে", "Something went wrong"],
  toolNotFound: ["টুলটি খুঁজে পাওয়া যায়নি", "Tool not found"],
  toolNotFoundHint: ["সম্ভবত লিংকটি পুরোনো — হোম থেকে আবার একটি টুল বেছে নিন।", "The link may be outdated — pick a tool from home."],
  progressAria: ["অগ্রগতি", "Progress"],

  // features
  featTitle1: ["কেন ", "Why "],
  featTitle2: ["?", "?"],
  featSub: ["নিরাপদ, দ্রুত আর ঝামেলাহীন — কারণ সবকিছু হয় আপনার নিজের ডিভাইসে।", "Safe, fast and fuss-free — everything happens on your own device."],
  featPrivateTitle: ["সম্পূর্ণ প্রাইভেট", "Totally private"],
  featPrivateDesc: ["ফাইল কখনো সার্ভারে যায় না। সব প্রসেসিং হয় আপনার ব্রাউজারের ভেতরেই — কোনো আপলোড নেই।", "Files never leave your device. Everything is processed inside your browser — zero uploads."],
  featSpeedTitle: ["বজ্রের গতি", "Blazing speed"],
  featSpeedDesc: ["আপলোড-ডাউনলোডের লাইনে দাঁড়াতে হবে না। ফাইল দিন, সাথে সাথেই রেজাল্ট নিন।", "No upload queues. Drop a file and get the result instantly."],
  featOfflineTitle: ["অফলাইনেও চলে", "Works offline"],
  featOfflineDesc: ["একবার ইনস্টল করে নিলে ইন্টারনেট ছাড়াও বেশিরভাগ টুল কাজ করবে।", "Install once and most tools keep working without internet."],
  featAllTitle: ["সব এক জায়গায়", "All in one place"],
  featAllDesc: ["পিডিএফ, ছবি, ওয়ার্ড, এক্সেল, ZIP — দশটা অ্যাপের কাজ এক জায়গাতেই।", "PDF, images, Word, Excel, ZIP — the work of ten apps in one."],

  // sidebar
  sidePrivacy: ["১০০% সুরক্ষিত", "100% secure"],
  sidePrivacyDesc: ["আপনার ফাইল ডিভাইসেই থাকে — কোনো আপলোড নেই।", "Your files stay on your device — no uploads."],
  sidebarAria: ["সাইডবার মেনু", "Sidebar menu"],
  pickCategory: ["ক্যাটাগরি বাছাই", "Pick a category"],

  // pdf editor
  edBack: ["হোমে ফিরুন", "Back home"],
  edTitle: ["পিডিএফ এডিটর", "PDF Editor"],
  edDrop: ["এডিট করতে পিডিএফ আনুন", "Drop a PDF to edit"],
  edDropHint: ["লেখা মুছুন, টেক্সট ও ছবি বসান, ড্র করুন — সবকিছু ডিভাইসেই", "Erase text, place text & images, draw — all on-device"],
  edPick: ["পিডিএফ বাছুন", "Choose PDF"],
  edLoading: ["পিডিএফ খোলা হচ্ছে...", "Opening PDF..."],
  edLoadFail: ["পিডিএফ খোলা যায়নি — ফাইলটি ঠিক আছে কিনা দেখুন", "Couldn't open the PDF — please check the file"],
  edToolSelect: ["বাছাই", "Select"],
  edToolWhiteout: ["মুছুন", "Erase"],
  edToolHighlight: ["হাইলাইট", "Highlight"],
  edToolText: ["টেক্সট", "Text"],
  edToolImage: ["ছবি", "Image"],
  edToolDraw: ["ড্র", "Draw"],
  edColor: ["রং", "Color"],
  edStroke: ["ব্রাশ", "Brush"],
  edTextSize: ["ফন্ট", "Font"],
  edUndo: ["আন্ডু", "Undo"],
  edRotate: ["পেজ ঘোরান", "Rotate page"],
  edDeletePage: ["পেজ ডিলিট", "Delete page"],
  edDeleteEl: ["মুছে ফেলুন", "Delete"],
  edSave: ["সেভ করুন", "Save PDF"],
  edSaving: ["সেভ হচ্ছে...", "Saving..."],
  edSaved: ["সেভ সম্পন্ন! ডাউনলোড শুরু হয়েছে।", "Saved! Your download has started."],
  edSaveFail: ["সেভ করা যায়নি — আবার চেষ্টা করুন", "Couldn't save — please try again"],
  edEmptyText: ["লিখুন...", "Type..."],
  edThumbs: ["পেজ তালিকা", "Pages"],
  edDirty: ["অসংরক্ষিত পরিবর্তন আছে — সত্যিই ছেড়ে যাবেন?", "You have unsaved edits — leave anyway?"],
  edZoomIn: ["জুম ইন", "Zoom in"],
  edZoomOut: ["জুম আউট", "Zoom out"],
  edClearPage: ["পেজের সব এডিট মুছুন", "Clear all edits on this page"],
  edEditorAria: ["পিডিএফ এডিটর ক্যানভাস", "PDF editor canvas"],
  edSpotBadge: ["নতুন · প্রিমিয়াম", "New · Premium"],
  edSpotTitle: ["পিডিএফ এডিটর ক্যানভাস", "PDF Editor Canvas"],
  edSpotDesc: [
    "আসল টেক্সট সরাসরি এডিট বা মুছে ফেলুন (ইরেজার ছাড়াই), নতুন টেক্সট ও ছবি বসান, শেপ আঁকুন, সিগনেচার দিন, সংবেদনশীল তথ্য রিড্যাক্ট করুন — সবকিছু ডিভাইসেই।",
    "Edit or delete the real text directly (no eraser), place text & images, draw shapes, sign, redact sensitive info — all on-device.",
  ],
  edToolEditText: ["টেক্সট এডিট", "Edit text"],
  edNoNativeText: [
    "এই পেজে সিলেক্টেবল টেক্সট নেই — স্ক্যান হলে মুছুন টুল ব্যবহার করুন",
    "No selectable text on this page — for scanned pages use the Erase tool",
  ],
  edToolRedact: ["রিড্যাক্ট", "Redact"],
  edToolShape: ["শেপ", "Shape"],
  edShapeRect: ["বাক্স", "Box"],
  edShapeEllipse: ["বৃত্ত", "Ellipse"],
  edShapeLine: ["লাইন", "Line"],
  edShapeArrow: ["তীর", "Arrow"],
  edSignature: ["সিগনেচার", "Signature"],
  edSigTitle: ["সিগনেচার আঁকুন", "Draw your signature"],
  edSigClear: ["মুছুন", "Clear"],
  edSigInsert: ["বসান", "Insert"],
  edDupPage: ["পেজ কপি", "Duplicate page"],
  edBold: ["বোল্ড", "Bold"],
  edSpotCta: ["এডিটর খুলুন", "Open the editor"],
  edSpotAria: ["পিডিএফ এডিটর খুলুন", "Open the PDF editor"],

  // footer
  footerLine: [
    "আপনার ফাইল আপনার ডিভাইসেই থাকে। কোনো আপলোড নেই, কোনো ট্র্যাকিং নেই।",
    "Your files stay on your device. No uploads, no tracking.",
  ],
} as const;

export type StrKey = keyof typeof STR;

/** pick a tool/category label by language (with fallback) */
export function pick(lang: Lang, bn: string, en?: string): string {
  return lang === "en" && en ? en : bn;
}

export function useT() {
  const lang = useAppStore((s) => s.lang);
  /** STR values are [bn, en] tuples — index by position, not by lang string */
  const t = (key: StrKey): string => STR[key][lang === "en" ? 1 : 0];
  /** format numbers with Bengali digits only in bn mode */
  const num = (value: number | string): string =>
    lang === "bn" ? toBn(value) : String(value);
  return { t, num, lang, setLang: useAppStore.getState().setLang };
}

/** non-hook access for rare one-off cases */
export function currentLang(): Lang {
  return useAppStore.getState().lang;
}
