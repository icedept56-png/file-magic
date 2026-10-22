"use client";

import { useEffect } from "react";

/**
 * PWA service-worker lifecycle manager.
 *
 * 1. Dev (and any environment where we don't register): actively UNREGISTER
 *    every service worker + delete every cache, then reload once. This heals
 *    browsers that still hold a stale SW from an older deployment (broken
 *    graphics = old cached CSS mixed with new HTML).
 * 2. Production: register /sw.js (offline support). The SW itself is
 *    versioned and clears old caches on activate.
 */
export function RegisterSW() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const shouldRegister = process.env.NODE_ENV === "production";

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
        navigator.serviceWorker.register("/sw.js").catch(() => {
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
