"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

type BeforeInstallPromptEvent = {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: string }>;
};

/** Shows an "install app" button whenever the browser exposes the install prompt */
export function PwaInstaller() {
  const { lang } = useT();
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
      aria-label={installLabel[0]}
      className="hidden border-emerald-600/20 bg-white text-emerald-800 shadow-sm hover:bg-emerald-50 hover:text-emerald-900 md:inline-flex"
    >
      <Download className="h-4 w-4 text-emerald-600" />
      {installLabel[lang === "en" ? 1 : 0]}
    </Button>
  );
}

const installLabel = ["ইনস্টল করুন", "Install app"] as const;
