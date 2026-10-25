"use client";

/* ═══════════════════════════════════════════════════════════════════════
   Keyboard shortcuts + help dialog — Day 8 of the 60-day business roadmap
   (docs/ROADMAP-60-DAYS.md, Phase 1)
   Pain point: "পাওয়ার ইউজার ও প্রতিবন্ধী ব্যবহারকারী বাদ পড়ে"

   Global layer (mounted once in page.tsx):
     /  or Ctrl+K → focus tool search (home view, outside text fields)
     ?            → open this shortcut list
     Esc          → back to home from tool/editor views
                    (only when no dialog owns the keystroke)
   The help dialog also opens from the navbar keyboard button via the
   "fm-open-shortcuts" custom event.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from "react";
import { Keyboard } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";
import { useAppStore } from "@/store/app-store";

function isTextTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    node.isContentEditable
  );
}

function dialogOpen(): boolean {
  return !!document.querySelector("[role=dialog][data-state=open]");
}

const EVENT = "fm-open-shortcuts";

export function openShortcutsHelp() {
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function ShortcutLayer() {
  const { t } = useT();
  const view = useAppStore((s) => s.view);
  const goHome = useAppStore((s) => s.goHome);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;

      // Ctrl+K / Cmd+K → search (works anywhere outside text fields)
      if (meta && e.key.toLowerCase() === "k") {
        if (isTextTarget(e.target)) return;
        e.preventDefault();
        if (view !== "home") {
          goHome();
          window.setTimeout(() => {
            document.querySelector<HTMLInputElement>('input[aria-label="টুল খুঁজুন"], input[aria-label="Search tools"]')?.focus();
          }, 120);
        } else {
          document.querySelector<HTMLInputElement>('input[aria-label="টুল খুঁজুন"], input[aria-label="Search tools"]')?.focus();
        }
        return;
      }

      if (isTextTarget(e.target)) return;

      // "/" → search
      if (e.key === "/" && !meta) {
        if (view === "home") {
          e.preventDefault();
          document.querySelector<HTMLInputElement>('input[aria-label="টুল খুঁজুন"], input[aria-label="Search tools"]')?.focus();
        }
        return;
      }

      // "?" → shortcut help
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setOpen(true);
        return;
      }

      // Esc → back to home (dialogs handle their own Esc first)
      if (e.key === "Escape" && !dialogOpen()) {
        if (view === "tool" || view === "editor") {
          goHome();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, goHome]);

  const rows: { keys: string; label: string }[] = [
    { keys: "/", label: t("skSearch") },
    { keys: "Ctrl + K", label: t("skSearch") },
    { keys: "?", label: t("skHelp") },
    { keys: "Esc", label: t("skBack") },
    { keys: "Ctrl + Z", label: t("skUndo") },
    { keys: "Ctrl + Shift + Z", label: t("skRedo") },
    { keys: "Enter / Space", label: t("skSelect") },
    { keys: "Tab", label: t("skTab") },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md rounded-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Keyboard className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
            {t("skTitle")}
          </DialogTitle>
          <DialogDescription>{t("skSubtitle")}</DialogDescription>
        </DialogHeader>
        <ul className="max-h-[50vh] space-y-1 overflow-y-auto pe-1 fm-scroll">
          {rows.map((r) => (
            <li
              key={r.keys + r.label}
              className="flex items-center justify-between gap-3 rounded-xl px-2 py-1.5 odd:bg-slate-50 dark:odd:bg-white/5"
            >
              <kbd className="rounded-lg border border-border bg-white px-2 py-0.5 font-mono text-xs font-semibold text-slate-700 shadow-sm dark:bg-white/10 dark:text-slate-200">
                {r.keys}
              </kbd>
              <span className="text-sm text-muted-foreground">{r.label}</span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
