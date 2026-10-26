"use client";

/**
 * শেয়ার ও প্রিন্ট (Day 20 — 60-day roadmap)
 * Native file sharing when the platform supports it (mobile PWA gold),
 * WhatsApp/Telegram deep-link fallbacks, and a real print path for
 * PDF/image/text outputs. Everything stays on-device until the user shares.
 */

export function canShareFile(file: File): boolean {
  try {
    return typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

export async function shareFile(
  file: File,
  text: string,
  title: string
): Promise<"shared" | "cancelled" | "unsupported"> {
  if (typeof navigator === "undefined" || !navigator.share) return "unsupported";
  try {
    await navigator.share({ files: [file], text, title });
    return "shared";
  } catch (e) {
    if ((e as DOMException)?.name === "AbortError") return "cancelled";
    return "unsupported";
  }
}

/** WhatsApp deep link — text-only (files can't travel in a URL) */
export const waShareLink = (text: string) =>
  `https://wa.me/?text=${encodeURIComponent(text)}`;

/** Telegram deep link */
export const tgShareLink = (text: string, url: string) =>
  `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;

/** outputs that make sense to send to a printer */
export function isPrintable(type: string): boolean {
  return (
    type === "application/pdf" ||
    type.startsWith("image/") ||
    type === "text/plain" ||
    type === "text/html"
  );
}

/** print a Blob without leaving the page (PDF) or via a minimal window */
export function printBlob(blob: Blob, name: string): "opened" | "blocked" {
  const url = URL.createObjectURL(blob);
  const safe = name.replace(/[<>&"]/g, "");

  if (blob.type === "application/pdf") {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText =
      "position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;";
    iframe.src = url;
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        /* some browsers need the user gesture they already gave */
      }
      // keep the frame alive until the print job spools, then clean up
      setTimeout(() => {
        iframe.remove();
        URL.revokeObjectURL(url);
      }, 60_000);
    };
    document.body.appendChild(iframe);
    return "opened";
  }

  const w = window.open("", "_blank", "width=860,height=1000");
  if (!w) {
    URL.revokeObjectURL(url);
    return "blocked";
  }
  const inner =
    blob.type.startsWith("image/")
      ? `<img src="${url}" alt="${safe}" style="max-width:100%;margin:0 auto" onload="window.focus();window.print()">`
      : `<pre style="white-space:pre-wrap;font-family:var(--font-bengali),'Hind Siliguri',sans-serif;font-size:14px;line-height:1.7">${
          blob.type === "text/html"
            ? "" // html prints itself after injection below
            : ""
        }</pre>`;
  w.document.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safe}</title>` +
      `<style>body{margin:24px;display:grid;place-items:start center;color:#1f2937;background:#fff}</style></head><body>${inner}</body></html>`
  );
  if (blob.type === "text/plain") {
    // put the text inside the pre we just wrote
    void blob.text().then((txt) => {
      const pre = w.document.querySelector("pre");
      if (pre) pre.textContent = txt;
      w.focus();
      w.print();
    });
  } else if (blob.type === "text/html") {
    void blob.text().then((html) => {
      const pre = w.document.querySelector("pre");
      if (pre) {
        const host = w.document.createElement("div");
        host.innerHTML = html;
        pre.replaceWith(host);
      }
      w.focus();
      w.print();
    });
  }
  w.document.close();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "opened";
}
