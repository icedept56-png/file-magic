"use client";

import { motion } from "framer-motion";
import {
  FileImage,
  FileOutput,
  FileSpreadsheet,
  FileText,
  FolderArchive,
  Home,
  LayoutGrid,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { CATEGORIES, TOOLS } from "@/lib/tools/registry";
import { toBn } from "@/lib/tools/helpers";
import { useT } from "@/lib/i18n";
import { useAppStore, type Lang } from "@/store/app-store";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  all: LayoutGrid,
  pdf: FileText,
  image: FileImage,
  document: FileOutput,
  spreadsheet: FileSpreadsheet,
  archive: FolderArchive,
  utility: Wrench,
};

/** literal text-color classes (Tailwind needs them verbatim in source) */
const CATEGORY_TEXT: Record<string, string> = {
  pdf: "text-rose-500",
  image: "text-fuchsia-500",
  document: "text-orange-500",
  spreadsheet: "text-emerald-500",
  archive: "text-teal-500",
  utility: "text-pink-500",
};

const CATEGORY_TINT: Record<string, string> = {
  pdf: "bg-rose-500/10",
  image: "bg-fuchsia-500/10",
  document: "bg-orange-500/10",
  spreadsheet: "bg-emerald-500/10",
  archive: "bg-teal-500/10",
  utility: "bg-pink-500/10",
};

/** Desktop sidebar — dashboard-style navigation (hidden on mobile) */
export function Sidebar() {
  const { t, lang } = useT();
  const category = useAppStore((s) => s.category);
  const view = useAppStore((s) => s.view);
  const goHome = useAppStore((s) => s.goHome);
  const setCategory = useAppStore((s) => s.setCategory);

  const selectCategory = (id: string) => {
    if (view === "tool") goHome();
    setCategory(id);
  };

  const isHomeActive = view === "home" && category === "all";

  const countFor = (id: string) => TOOLS.filter((tl) => tl.category === id).length;

  return (
    <aside
      aria-label={t("sidebarAria")}
      className="sticky top-0 z-30 hidden h-screen w-72 shrink-0 flex-col border-r border-emerald-900/[0.06] bg-white/60 px-4 py-5 backdrop-blur-sm lg:flex"
    >
      {/* mini brand */}
      <button
        type="button"
        onClick={goHome}
        className="mb-6 flex items-center gap-3 rounded-xl px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        aria-label={t("backHomeAria")}
      >
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/30">
          <Sparkles className="h-5 w-5 text-white" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-base font-bold text-emerald-950">
            {t("brandName")}
          </span>
          <span className="block truncate text-xs text-emerald-800/60">
            {t("brandTagline")}
          </span>
        </span>
      </button>

      {/* nav */}
      <nav className="flex flex-col gap-1" aria-label={t("pickCategory")}>
        <NavItem
          icon={Home}
          label={lang === "en" ? "Home" : "হোম"}
          sub={lang === "en" ? "Everything, in one place" : "সব কিছু এক জায়গায়"}
          active={isHomeActive}
          onClick={() => {
            if (view === "tool") goHome();
            setCategory("all");
          }}
        />
        {CATEGORIES.filter((c) => c.id !== "all").map((c) => {
          const Icon = CATEGORY_ICONS[c.id] ?? LayoutGrid;
          const active = view === "home" && category === c.id;
          return (
            <NavItem
              key={c.id}
              icon={Icon}
              label={lang === "en" ? (c.labelEn ?? c.label) : c.label}
              active={active}
              tint={CATEGORY_TINT[c.id]}
              iconText={CATEGORY_TEXT[c.id]}
              count={countFor(c.id)}
              lang={lang}
              onClick={() => selectCategory(c.id)}
            />
          );
        })}
      </nav>

      {/* privacy card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.3 }}
        className="mt-auto rounded-2xl border border-emerald-600/10 bg-gradient-to-br from-emerald-50 to-teal-50 p-4"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
          <ShieldCheck className="h-4 w-4" />
          {t("sidePrivacy")}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-emerald-800/70">
          {t("sidePrivacyDesc")}
        </p>
      </motion.div>
    </aside>
  );
}

function NavItem({
  icon: Icon,
  label,
  sub,
  active,
  tint,
  iconText,
  count,
  lang,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  sub?: string;
  active: boolean;
  tint?: string;
  iconText?: string;
  count?: number;
  lang?: Lang;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left outline-none transition-all focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
        active
          ? "bg-gradient-to-r from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25"
          : "hover:bg-emerald-600/[0.06]"
      }`}
    >
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors ${
          active ? "bg-white/20" : (tint ?? "bg-emerald-600/10")
        }`}
      >
        <Icon
          className={`h-[18px] w-[18px] ${
            active ? "text-white" : (iconText ?? "text-emerald-700")
          }`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm font-semibold ${
            active ? "text-white" : "text-emerald-950/85"
          }`}
        >
          {label}
        </span>
        {sub && (
          <span
            className={`block truncate text-[11px] ${
              active ? "text-emerald-50/85" : "text-emerald-900/45"
            }`}
          >
            {sub}
          </span>
        )}
      </span>
      {typeof count === "number" && count > 0 && (
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
            active ? "bg-white/25 text-white" : "bg-emerald-600/10 text-emerald-800/70"
          }`}
        >
          {lang === "en" ? String(count) : toBn(count)}
        </span>
      )}
    </button>
  );
}
