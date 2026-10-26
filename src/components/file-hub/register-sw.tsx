"use client";

import { useEffect } from "react";

/**
 * PWA service-worker lifecycle manager.
 *
 * 1. Dev (and any environment where we don't register): actively UNREGISTER
 *    every service worker + delete every cache, then reload once. This heals
 *    browsers that still hold a stale SW from an older deployment (broken
 *    graphics = old cached CSS mixed with new HTML). Dev override: opening
 *    the app with ?fm-sw=1 registers the SW for offline testing.
 * 2. Production: register /sw.js (offline support + background OCR cache
 *    warmup). The SW is versioned and clears old caches on activate; when a
 *    new version waits, a toast offers one-tap refresh.
 */
export function RegisterSW() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const devOverride = new URLSearchParams(window.location.search).has("fm-sw");
    const shouldRegister = process.env.NODE_ENV === "production" || devOverride;

    const heal = async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        let removed = false;

        // Unregister SWs we don't want active in this environment
        for (const reg of regs) {
          const url = reg.active?.scriptURL ?? reg.installing?.scriptURL ?? reg.waiting?.scriptURL ?? "";
          const isOurs = url.endsWith("/sw.js");
          if (!shouldRegister || !isOurs) {
            await reg.unregister();
            removed = true;
          }
        }

        // Drop every cache that doesn't belong to the current SW version
        if ("caches" in window && !shouldRegister) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
          if (keys.length > 0) removed = true;
        }

        if (removed && !sessionStorage.getItem("fm-sw-healed")) {
          sessionStorage.setItem("fm-sw-healed", "1");
          window.location.reload();
        }
      } catch {
        /* healing is best-effort — never block the app */
      }
    };

    const onLoad = () => {
      if (shouldRegister) {
        navigator.serviceWorker
          .register("/sw.js")
          .then(async (reg) => {
            // production only: a waiting new version → offer one-tap refresh
            if (process.env.NODE_ENV !== "production") return;
            const notify = async () => {
              const { toast } = await import("sonner");
              const bn = (window.localStorage.getItem("fm-lang") ?? "bn") !== "en";
              toast(bn ? "নতুন সংস্করণ প্রস্তুত" : "New version ready", {
                description: bn
                  ? "রিফ্রেশ করলেই সর্বশেষ ভার্সন চলবে"
                  : "Refresh to switch to the latest version",
                action: {
                  label: bn ? "রিফ্রেশ" : "Refresh",
                  onClick: () => {
                    reg.waiting?.postMessage("SKIP_WAITING");
                  },
                },
                duration: 8000,
              });
            };
            if (reg.waiting && navigator.serviceWorker.controller) await notify();
            reg.addEventListener("updatefound", () => {
              reg.installing?.addEventListener("statechange", (e) => {
                const sw = e.target as ServiceWorker;
                if (sw.state === "installed" && navigator.serviceWorker.controller) void notify();
              });
            });
            navigator.serviceWorker.addEventListener("controllerchange", () => {
              window.location.reload();
            });
          })
          .catch(() => {
            /* SW is a bonus — never break the app for it */
          });
      } else {
        heal();
      }
    };

    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
