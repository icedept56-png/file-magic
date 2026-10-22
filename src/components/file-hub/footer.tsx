"use client";

import { Wand2 } from "lucide-react";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-white/[0.06] bg-black/20">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-fuchsia-500 via-violet-500 to-orange-400">
              <Wand2 className="h-4 w-4 text-white" />
            </span>
            <span className="font-semibold text-zinc-200">ফাইল ম্যাজিক</span>
          </div>
          <p className="text-center text-sm text-zinc-500 sm:text-right">
            © {new Date().getFullYear()} ফাইল ম্যাজিক — আপনার ফাইল আপনার ডিভাইসেই
            থাকে। কোনো আপলোড নেই, কোনো ট্র্যাকিং নেই।
          </p>
        </div>
      </div>
    </footer>
  );
}
