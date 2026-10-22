"use client";

import { Sparkles } from "lucide-react";

import { useT } from "@/lib/i18n";

export function Footer() {
  const { t } = useT();

  return (
    <footer className="mt-auto border-t border-emerald-900/[0.06] bg-white/70 backdrop-blur-sm">
      <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm shadow-emerald-500/30">
              <Sparkles className="h-4 w-4 text-white" />
            </span>
            <span className="font-bold text-emerald-950">{t("brandName")}</span>
          </div>
          <p className="text-center text-sm text-emerald-900/55 sm:text-right">
            © {new Date().getFullYear()} {t("brandName")} — {t("footerLine")}
          </p>
        </div>
      </div>
    </footer>
  );
}
