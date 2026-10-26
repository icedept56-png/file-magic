"use client";

import {
  BadgeCheck,
  FileImage,
  Files,
  IdCard,
  Mail,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { Lang } from "@/store/app-store";

/** টেমপ্লেট গ্যালারি (Day 17) — one-click common workflows */

export interface TemplateDef {
  id: string;
  icon: LucideIcon;
  gradient: string;
  /** target tool to open */
  toolId: string;
  name: [string, string]; // [bn, en]
  desc: [string, string];
  /** confirmation toast after launch */
  note: [string, string];
  /** workspace tools: pre-filled options (via resumeOpts) */
  opts?: Record<string, string | number | boolean>;
  /** editor tools: one-shot seeding payload (via templateHandoff) */
  editor?: { html?: string; preset?: string; docName?: string };
}

const pick2 = (l: Lang, pair: [string, string]) => (l === "en" ? pair[1] : pair[0]);

/** starter CV (semantic HTML — the word editor exports it to docx/PDF cleanly) */
const CV_HTML = [
  "<h1>আপনার নাম</h1>",
  "<p>ঠিকানা: ঢাকা, বাংলাদেশ · ফোন: ০১XXXXXXXXX · ইমেইল: you@example.com</p>",
  "<h2>ক্যারিয়ার লক্ষ্য</h2>",
  "<p>দুই-তিন লাইনে লিখুন আপনি কোন ধরনের কাজ খুঁজছেন এবং কেন আপনি উপযুক্ত।</p>",
  "<h2>শিক্ষা</h2>",
  "<ul><li>বিএ (অনার্স) — ঢাকা বিশ্ববিদ্যালয়, ২০২৪</li><li>উচ্চ মাধ্যমিক — ঢাকা কলেজ, ২০২০</li></ul>",
  "<h2>অভিজ্ঞতা</h2>",
  "<ul><li>ইন্টার্ন — প্রতিষ্ঠানের নাম (২০২৪–বর্তমান): সংক্ষেপে কাজের বিবরণ</li></ul>",
  "<h2>দক্ষতা</h2>",
  "<p>এক্সেল · ইংরেজি ও বাংলা টাইপিং · যোগাযোগ দক্ষতা</p>",
].join("");

export const TEMPLATES: TemplateDef[] = [
  {
    id: "nid-scan",
    icon: IdCard,
    gradient: "bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/30",
    toolId: "document-scan",
    name: ["এনআইডি স্ক্যান", "NID scan"],
    desc: ["ছবি → পরিষ্কার ধূসর স্ক্যান কপি", "Photo → crisp gray scan copy"],
    note: ["গ্রে প্রিসেট চালু আছে — ছবি দিলেই ডকুমেন্ট-স্ক্যান রেডি", "Gray preset is on — add a photo and the document scan is ready"],
    editor: { preset: "gray", docName: "nid-scan" },
  },
  {
    id: "make-cv",
    icon: BadgeCheck,
    gradient: "bg-gradient-to-br from-orange-500 to-amber-600 shadow-orange-500/30",
    toolId: "word-editor",
    name: ["সিভি বানান", "Make a CV"],
    desc: ["বাংলা সিভির প্রস্তুত কাঠামো, বদলে নিজের তথ্য", "Ready Bengali CV skeleton — edit in your details"],
    note: ["সিভির কাঠামো বসানো হয়েছে — নাম-অভিজ্ঞতা বদলে ডাউনলোড করুন", "CV skeleton inserted — swap in your details and download"],
    editor: { html: CV_HTML, docName: "my-cv" },
  },
  {
    id: "passport-photo",
    icon: FileImage,
    gradient: "bg-gradient-to-br from-fuchsia-500 to-purple-600 shadow-fuchsia-500/30",
    toolId: "image-resize",
    name: ["পাসপোর্ট ছবি", "Passport photo"],
    desc: ["৩৫×৪৫ মিমি — সঠিক মাপে রিসাইজ", "35×45 mm — resized to the exact print size"],
    note: ["৪১৩×৫৩১ px (৩৫×৪৫ মিমি @ ৩০০ DPI) প্রি-সেট", "413×531 px (35×45 mm @ 300 DPI) pre-set"],
    opts: { width: 413, height: 531, keepAspect: false },
  },
  {
    id: "email-image",
    icon: Mail,
    gradient: "bg-gradient-to-br from-pink-500 to-rose-600 shadow-pink-500/30",
    toolId: "image-compress",
    name: ["ইমেইল ছবি", "Email-size image"],
    desc: ["ইমেইল/হোয়াটসঅ্যাপে পাঠানোর মতো ছোট", "Small enough for email or WhatsApp"],
    note: ["কোয়ালিটি ৫৫% প্রি-সেট — ফাইল দিয়ে সাথে সাথে কম্প্রেস", "Quality pre-set to 55% — add a file and compress"],
    opts: { quality: 55 },
  },
  {
    id: "webp-web",
    icon: Zap,
    gradient: "bg-gradient-to-br from-teal-500 to-cyan-600 shadow-teal-500/30",
    toolId: "image-convert",
    name: ["ওয়েবের জন্য WebP", "WebP for the web"],
    desc: ["ওয়েবসাইটের জন্য হালকা WebP ছবি", "Lightweight WebP images for websites"],
    note: ["WebP + ৮০% কোয়ালিটি প্রি-সেট", "WebP + 80% quality pre-set"],
    opts: { format: "webp", quality: 80 },
  },
  {
    id: "many-photos",
    icon: Files,
    gradient: "bg-gradient-to-br from-violet-500 to-purple-700 shadow-violet-500/30",
    toolId: "batch-studio",
    name: ["অনেক ছবি একসাথে", "Many photos at once"],
    desc: ["ব্যাচ স্টুডিও — সব ছবি এক কাজে + ZIP", "Batch studio — one action for all + ZIP"],
    note: ["ব্যাচ স্টুডিও খোলা — একাধিক ছবি দিন, একসাথে প্রসেস হবে", "Batch studio is open — add multiple photos to process together"],
  },
];

export { pick2 as templateText };
