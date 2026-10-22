"use client";

import { ShieldCheck, Sparkles, WifiOff } from "lucide-react";

import { TOOL_COUNT } from "@/lib/tools/registry";
import { useT } from "@/lib/i18n";

export function Footer() {
  const { t, num } = useT();

  return (
    <footer className="mt-auto border-t border-emerald-900/[0.06] bg-white/70 backdrop-blur-sm">
      {/* gradient hairline */}
      <div
        aria-hidden="true"
        className="h-px w-full bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent"
      />
      <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6">
        <div className="flex flex-col items-center justify-between gap-5 sm:flex-row">
          {/* brand */}
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/30">
              <Sparkles className="h-[18px] w-[18px] text-white" />
            </span>
            <span className="flex flex-col items-start leading-tight">
              <span className="font-bold text-emerald-950">{t("brandName")}</span>
              <span className="text-xs text-emerald-800/60">
                {num(TOOL_COUNT)} {t("toolCount")} · {t("freeForever")}
              </span>
            </span>
          </div>

          {/* trust badges */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/12 bg-emerald-50/70 px-3 py-1 text-xs font-medium text-emerald-800/80">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              {t("statPrivate")}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/12 bg-emerald-50/70 px-3 py-1 text-xs font-medium text-emerald-800/80">
              <WifiOff className="h-3.5 w-3.5 text-emerald-600" />
              {t("statOffline")}
            </span>
          </div>

          <p className="text-center text-sm text-emerald-900/55 sm:text-right">
            © {new Date().getFullYear()} {t("brandName")} — {t("footerLine")}
          </p>
        </div>
      </div>
    </footer>
  );
}
