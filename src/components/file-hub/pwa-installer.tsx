"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";

type BeforeInstallPromptEvent = {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: string }>;
};

/** Shows an "install app" button whenever the browser exposes the install prompt */
export function PwaInstaller() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as unknown as BeforeInstallPromptEvent);
    };
    const installed = () => setDeferredPrompt(null);

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  if (!deferredPrompt) return null;

  const install = async () => {
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch {
      /* user dismissed or browser refused — just hide */
    } finally {
      setDeferredPrompt(null);
    }
  };

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={install}
      aria-label="অ্যাপ ইনস্টল করুন"
      className="border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white"
    >
      <Download className="h-4 w-4" />
      ইনস্টল করুন
    </Button>
  );
}
