<div align="center">

# ✨ ফাইল ম্যাজিক | File Magic

**সব ফাইলের জন্য একটাই জাদুকরী টুলবক্স** — কনভার্ট, এডিট, কম্প্রেস, সবকিছু এক জায়গায়।

Convert • Edit • Compress • Merge — ২৮+ প্রিমিয়াম টুল, সম্পূর্ণ ফ্রি, ব্রাউজারেই সব কাজ।

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ficedept56-png%2Ffile-magic&project-name=file-magic&repository-name=file-magic)

</div>

---

## 🚀 Vercel-এ ডিপ্লয় (৩ ধাপ, ১০০% অটোমেটিক)

> **কোনো API Key, Environment Variable, বা ম্যানুয়াল সেটআপ লাগবে না।** সব কনফিগ কোডের ভেতরেই রেডি (`vercel.json` + `next.config.ts`)।

### ধাপ ১ — উপরের **Deploy with Vercel** বাটনে ক্লিক করুন
অথবা সরাসরি: [vercel.com/new/clone?repository-url=https://github.com/icedept56-png/file-magic](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ficedept56-png%2Ffile-magic&project-name=file-magic&repository-name=file-magic)

### ধাপ ২ — GitHub অ্যাকাউন্ট কানেক্ট করে **Deploy** চাপুন
Vercel নিজে থেকেই:
- ✅ `bun install` চালাবে (bun.lock ডিটেক্ট করে)
- ✅ `next build` চালাবে (vercel.json থেকে)
- ✅ Node.js 20+ সিলেক্ট করবে
- ✅ Environment Variable — **কিছুই লাগবে না** (অ্যাপ সম্পূর্ণ ক্লায়েন্ট-সাইড)

### ধাপ ৩ — লাইভ! 🎉
`main` ব্রাঞ্চে প্রতিটি `git push` = **অটোমেটিক নতুন ডিপ্লয়**। আর কিছুই করতে হবে না।

---

## 🛠️ লোকাল ডেভেলপমেন্ট

```bash
# ইনস্টল
bun install

# ডেভ সার্ভার (http://localhost:3000)
bun run dev

# কোয়ালিটি চেক
bun run lint
bunx tsc --noEmit
```

## 📦 সেলফ-হোস্টিং (VPS/Docker — ঐচ্ছিক)

```bash
bun run build:standalone
bun run start   # .next/standalone/server.js
```

---

## 🧰 ফিচারসমূহ

| ক্যাটাগরি | টুল |
|---|---|
| 📄 PDF | Merge, Split, Compress, Rotate, Page delete, **PDF এডিটর ক্যানভাস** (টেক্সট এডিট/ডিলিট, ছবি ইনসার্ট), PDF↔Word/Excel/Image |
| 🖼️ Image | Convert (JPG/PNG/WebP/AVIF…), Compress, Resize, Crop, Watermark |
| 📝 Document | DOCX/ODT/TXT এডিট ও কনভার্ট, Markdown |
| 📊 Spreadsheet | XLSX/CSV কনভার্ট ও এডিট |
| 🗜️ Archive | ZIP create/extract |
| 🧪 Utility | QR Generator, Password, Hash, Base64 এবং আরও |

- 🌐 **দ্বিভাষিক** — বাংলা + English সম্পূর্ণ UI (বাংলা সংখ্যা সহ)
- 📱 **PWA** — ইনস্টল করে অফলাইনেও চালান
- 🔒 **প্রাইভেসি ফার্স্ট** — ফাইল আপনার ডিভাইস ছাড়ে না, সব প্রসেসিং ব্রাউজারে
- 👁️ **চোখের আরাম** — সফট, আই-ফ্রেন্ডলি গ্রাফিক্স ডিজাইন

## 🧱 টেক স্ট্যাক

Next.js 16 (App Router) · TypeScript 5 · Tailwind CSS 4 · shadcn/ui · Framer Motion · Zustand · pdf.js · pdf-lib · jsPDF · docx · xlsx · JSZip · PWA (Service Worker)

---

<div align="center">

**© File Magic** — সবার জন্য ফ্রি ফাইল টুলবক্স 💚

</div>
