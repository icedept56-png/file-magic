"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

import { motion } from "framer-motion";
import { Search, ShieldCheck, Sparkles, WifiOff, Zap, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n";
import { TOOL_COUNT } from "@/lib/tools/registry";
import { useAppStore } from "@/store/app-store";

const MARQUEE_ITEMS = [
  "PDF → Word",
  "PDF → JPG",
  "DOCX → PDF",
  "XLSX → CSV",
  "PNG → WebP",
  "Image → PDF",
  "Merge PDF",
  "Create ZIP",
  "HTML → PDF",
  "Text → Word",
  "Compress PDF",
  "JSON Format",
  "QR Code",
  "Resize Image",
  "CSV → Excel",
];

/** Dashboard header — greeting + search + stat chips (matches the reference design) */
export function Hero() {
  const { t, num } = useT();
  const search = useAppStore((s) => s.search);
  const setSearch = useAppStore((s) => s.setSearch);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      document.getElementById("tools")?.scrollIntoView({ behavior: "smooth" });
    }
  };

  // press "/" anywhere to jump into search
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const STATS = [
    { icon: Sparkles, label: `${num(TOOL_COUNT)} ${t("statTools")}` },
    { icon: ShieldCheck, label: t("statPrivate") },
    { icon: Zap, label: t("statSpeed") },
    { icon: WifiOff, label: t("statOffline") },
  ];

  return (
    <section className="pt-8 sm:pt-10">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* section title with green icon tile, like the reference dashboard */}
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/25">
              <Sparkles className="h-[18px] w-[18px] text-white" />
            </span>
            <h1 className="text-xl font-bold text-emerald-950 sm:text-2xl">
              {t("quickStart")}
            </h1>
            <span className="ml-1 hidden rounded-full border border-emerald-600/15 bg-white px-2.5 py-0.5 text-xs font-medium text-emerald-700 sm:inline-block">
              {t("freeForever")}
            </span>
          </div>
        </motion.div>

        {/* search */}
        <motion.div
          className="mx-auto mt-6 max-w-2xl"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.06 }}
        >
          <div className="group relative">
            <div
              aria-hidden="true"
              className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-emerald-500/25 via-teal-500/25 to-orange-400/20 opacity-0 blur-sm transition-opacity duration-300 group-focus-within:opacity-100"
            />
            <Search className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-emerald-700/50" />
            <Input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchAria")}
              className="relative h-13 rounded-2xl border-emerald-900/10 bg-white pl-12 pr-24 text-base text-emerald-950 shadow-[0_2px_10px_-4px_rgba(5,150,105,0.15)] placeholder:text-emerald-900/40 focus-visible:ring-emerald-500/50 min-h-11"
            />
            {search ? (
              <button
                type="button"
                aria-label={t("clearSearch")}
                onClick={() => {
                  setSearch("");
                  inputRef.current?.focus();
                }}
                className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-emerald-600/15 bg-emerald-50 p-1.5 text-emerald-700/70 transition hover:bg-emerald-100 hover:text-emerald-800"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <kbd
                aria-hidden="true"
                className="absolute right-3.5 top-1/2 z-10 hidden -translate-y-1/2 rounded-md border border-emerald-600/15 bg-emerald-50 px-2 py-0.5 font-mono text-xs text-emerald-800/60 sm:block"
              >
                /
              </kbd>
            )}
          </div>
        </motion.div>

        {/* stats chips */}
        <motion.div
          className="mt-5 flex flex-wrap justify-center gap-2.5"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.12 }}
        >
          {STATS.map(({ icon: Icon, label }, i) => (
            <div
              key={label}
              className={`flex items-center rounded-xl border px-3.5 py-1.5 text-sm shadow-sm ${
                i === 0
                  ? "border-emerald-600/20 bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold text-white shadow-emerald-500/25"
                  : "border-emerald-900/[0.06] bg-white text-emerald-900/75"
              }`}
            >
              <Icon
                className={`mr-1.5 inline h-4 w-4 ${i === 0 ? "text-white" : "text-emerald-600"}`}
              />
              {label}
            </div>
          ))}
        </motion.div>

        {/* supported-formats marquee */}
        <motion.div
          className="mt-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35, delay: 0.18 }}
        >
          <div
            aria-hidden="true"
            className="overflow-hidden rounded-2xl border border-emerald-900/[0.06] bg-white/70 py-2.5 shadow-sm"
          >
            <div className="fm-marquee flex w-max gap-2.5">
              {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((item, i) => (
                <span
                  key={`${item}-${i}`}
                  className="whitespace-nowrap rounded-lg border border-emerald-600/10 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800/70"
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
