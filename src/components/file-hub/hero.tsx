"use client";

import type { KeyboardEvent } from "react";

import { motion } from "framer-motion";
import { Search, ShieldCheck, Sparkles, WifiOff, Zap, LayoutGrid } from "lucide-react";

import { Input } from "@/components/ui/input";
import { TOOL_COUNT } from "@/lib/tools/registry";
import { useAppStore } from "@/store/app-store";

const MARQUEE_ITEMS = [
  "PDF → JPG",
  "DOCX → PDF",
  "XLSX → CSV",
  "PNG → WebP",
  "ছবি → পিডিএফ",
  "PDF মার্জ",
  "ZIP তৈরি",
  "HTML → PDF",
  "টেক্সট → ওয়ার্ড",
  "PDF কম্প্রেস",
  "JSON ফরম্যাট",
  "QR কোড",
  "ইমেজ রিসাইজ",
  "CSV → এক্সেল",
];

const STATS: { icon: typeof Zap; label: string }[] = [
  { icon: LayoutGrid, label: `${TOOL_COUNT}+ টুল` },
  { icon: ShieldCheck, label: "১০০% প্রাইভেট" },
  { icon: Zap, label: "বজ্রগতি" },
  { icon: WifiOff, label: "অফলাইনেও চলে" },
];

export function Hero() {
  const search = useAppStore((s) => s.search);
  const setSearch = useAppStore((s) => s.setSearch);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      document.getElementById("tools")?.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <section className="pb-8 pt-14 text-center sm:pt-20">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-1.5 text-sm text-zinc-300">
            <Sparkles className="h-4 w-4 text-fuchsia-400" />
            {TOOL_COUNT}টি টুল • ১০০% প্রাইভেট • সম্পূর্ণ ফ্রি
          </span>

          <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            <span className="text-zinc-50">সব ফাইলের</span>
            <br />
            <span className="bg-gradient-to-r from-fuchsia-400 via-violet-400 to-orange-300 bg-clip-text text-transparent">
              সম্পূর্ণ সমাধান, এক জায়গায়
            </span>
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-base text-zinc-400 sm:text-lg">
            পিডিএফ, ওয়ার্ড, এক্সেল, ছবি, ZIP — কনভার্ট, এডিট, কম্প্রেস সবকিছু
            সেকেন্ডেই। কোনো ফাইল সার্ভারে যায় না, সব আপনার ব্রাউজারেই হয়।
          </p>
        </motion.div>

        {/* search */}
        <motion.div
          className="mx-auto mt-8 max-w-xl"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.08 }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" />
            <Input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="টুল খুঁজুন... (যেমন: পিডিএফ, ছবি, কম্প্রেস)"
              aria-label="টুল খুঁজুন"
              className="h-14 rounded-2xl border-white/10 bg-white/[0.05] pl-12 pr-4 text-base placeholder:text-zinc-500 focus-visible:ring-fuchsia-500/50"
            />
          </div>
        </motion.div>

        {/* stats chips */}
        <motion.div
          className="mt-8 flex flex-wrap justify-center gap-3"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.16 }}
        >
          {STATS.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-sm text-zinc-300"
            >
              <Icon className="mr-1.5 inline h-4 w-4 text-fuchsia-400" />
              {label}
            </div>
          ))}
        </motion.div>

        {/* decorative marquee */}
        <motion.div
          className="mt-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35, delay: 0.22 }}
        >
          <div
            aria-hidden="true"
            className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.03] py-3"
          >
            <div className="fm-marquee flex w-max gap-3">
              {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((item, i) => (
                <span
                  key={`${item}-${i}`}
                  className="whitespace-nowrap rounded-lg border border-white/[0.06] bg-white/[0.05] px-3 py-1 text-xs text-zinc-400"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
