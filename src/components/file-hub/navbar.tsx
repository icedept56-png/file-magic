"use client";

import { Sparkles, LayoutGrid } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { useAppStore } from "@/store/app-store";
import { PwaInstaller } from "@/components/file-hub/pwa-installer";
import { LanguageToggle } from "@/components/file-hub/language-toggle";

/** White top bar — brand + language switcher + install */
export function Navbar() {
  const { t } = useT();
  const view = useAppStore((s) => s.view);
  const goHome = useAppStore((s) => s.goHome);

  return (
    <header className="sticky top-0 z-40">
      <div className="border-b border-emerald-900/[0.06] bg-white/80 backdrop-blur-xl">
        <nav
          aria-label={t("mainMenuAria")}
          className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6"
        >
          {/* brand */}
          <button
            type="button"
            onClick={goHome}
            className="group flex items-center gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            aria-label={t("backHomeAria")}
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/30 transition-transform duration-300 group-hover:rotate-6 group-hover:scale-105">
              <Sparkles className="h-5 w-5 text-white" />
            </span>
            <span className="flex flex-col items-start leading-tight">
              <span className="text-base font-bold text-emerald-950">{t("brandName")}</span>
              <span className="hidden text-xs text-emerald-800/60 sm:block">
                {t("brandTagline")}
              </span>
            </span>
          </button>

          {/* right actions */}
          <div className="flex items-center gap-2">
            {view === "tool" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={goHome}
                className="hidden text-emerald-900/70 hover:bg-emerald-600/10 hover:text-emerald-900 sm:inline-flex"
              >
                <LayoutGrid className="h-4 w-4" />
                {t("allTools")}
              </Button>
            )}
            <LanguageToggle />
            <PwaInstaller />
          </div>
        </nav>
      </div>
      {/* soft emerald hairline */}
      <div
        aria-hidden="true"
        className="h-px bg-gradient-to-r from-transparent via-emerald-500/25 to-transparent"
      />
    </header>
  );
}
