"use client";

import { LayoutGrid, Wand2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/app-store";
import { PwaInstaller } from "@/components/file-hub/pwa-installer";

export function Navbar() {
  const view = useAppStore((s) => s.view);
  const goHome = useAppStore((s) => s.goHome);

  return (
    <header className="sticky top-0 z-40">
      <div className="border-b border-white/[0.06] bg-[#07070d]/70 backdrop-blur-xl">
        <nav
          aria-label="প্রধান মেনু"
          className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6"
        >
          {/* brand */}
          <button
            type="button"
            onClick={goHome}
            className="group flex items-center gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500/60"
            aria-label="ফাইল ম্যাজিক — হোমে ফিরে যান"
          >
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 via-violet-500 to-orange-400 shadow-lg shadow-fuchsia-500/30 transition-transform duration-300 group-hover:rotate-6 group-hover:scale-105">
              <Wand2 className="h-5 w-5 text-white" />
            </span>
            <span className="flex items-center gap-2">
              <span className="text-lg font-bold text-zinc-50">ফাইল ম্যাজিক</span>
              <Badge
                variant="outline"
                className="hidden border-white/15 text-zinc-400 sm:inline-flex"
              >
                PWA
              </Badge>
            </span>
          </button>

          {/* right actions */}
          <div className="flex items-center gap-2">
            {view === "tool" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={goHome}
                className="hidden text-zinc-300 hover:bg-white/10 hover:text-white sm:inline-flex"
              >
                <LayoutGrid className="h-4 w-4" />
                সব টুল
              </Button>
            )}
            <PwaInstaller />
          </div>
        </nav>
      </div>
      {/* gradient hairline accent */}
      <div
        aria-hidden="true"
        className="h-px bg-gradient-to-r from-transparent via-fuchsia-500/30 to-transparent"
      />
    </header>
  );
}
