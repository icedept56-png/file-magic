"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { WifiOff, X } from "lucide-react";

import { useT } from "@/lib/i18n";

/**
 * অফলাইন ব্যানার (Day 15) — when the network drops, reassure the user that
 * every tool keeps working (all processing is on-device, and the app itself
 * is served from the service-worker cache).
 */
export function OfflineBanner() {
  const { t } = useT();
  const [offline, setOffline] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const sync = () => {
      const nowOffline = !navigator.onLine;
      setOffline(nowOffline);
      // a fresh offline episode gets its own banner
      if (!nowOffline) setDismissed(false);
    };
    // defer the first read out of the effect body (hydration-safe)
    const id = requestAnimationFrame(sync);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return (
    <AnimatePresence>
      {offline && !dismissed && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.25 }}
          role="status"
          aria-live="polite"
          className="fixed inset-x-4 bottom-4 z-[80] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-emerald-900/10 bg-white/95 p-3.5 shadow-xl shadow-emerald-950/10 backdrop-blur sm:bottom-6"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600">
            <WifiOff className="h-4.5 w-4.5 text-white" />
          </span>
          <p className="min-w-0 flex-1 text-sm leading-snug text-emerald-950/85">
            <span className="font-semibold">{t("ofTitle")}</span>{" "}
            {t("ofBody")}
          </p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label={t("ofDismiss")}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-emerald-900/40 transition hover:bg-emerald-600/10 hover:text-emerald-700"
          >
            <X className="h-4 w-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
