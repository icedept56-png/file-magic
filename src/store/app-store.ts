"use client";

import { create } from "zustand";
import { isEditorTool } from "@/lib/tools/registry";

export type View = "home" | "tool" | "editor";
export type Lang = "bn" | "en";

const RECENT_KEY = "fm-recent-tools";
const RECENT_MAX = 6;
const LANG_KEY = "fm-lang";

function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function saveRecent(ids: string[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    /* private mode — ignore */
  }
}

function loadLang(): Lang {
  if (typeof window === "undefined") return "bn";
  return window.localStorage.getItem(LANG_KEY) === "en" ? "en" : "bn";
}

function saveLang(lang: Lang) {
  try {
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* ignore */
  }
}

const scrollTop = () => {
  if (typeof window !== "undefined") {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }
};

interface AppState {
  view: View;
  activeToolId: string | null;
  search: string;
  category: string;
  recent: string[];
  lang: Lang;
  /** files staged for the OCR studio (scanner → OCR hand-off); not persisted */
  ocrHandoff: File[];
  /** one-shot option snapshot for "চালিয়ে যাওয়া" (resume) from recent activity */
  resumeOpts: { toolId: string; opts: Record<string, string | number | boolean> } | null;
  /** one-shot template payload for editor tools (gallery → editor seeding) */
  templateHandoff: { toolId: string; html?: string; preset?: string; docName?: string } | null;
  openTool: (id: string) => void;
  goHome: () => void;
  setSearch: (s: string) => void;
  setCategory: (c: string) => void;
  hydrate: () => void;
  recordRecent: (id: string) => void;
  setLang: (l: Lang) => void;
  setOcrHandoff: (files: File[]) => void;
  setResumeOpts: (r: { toolId: string; opts: Record<string, string | number | boolean> } | null) => void;
  setTemplateHandoff: (h: { toolId: string; html?: string; preset?: string; docName?: string } | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  view: "home",
  activeToolId: null,
  search: "",
  category: "all",
  recent: [],
  lang: "bn",
  ocrHandoff: [],
  resumeOpts: null,
  templateHandoff: null,
  openTool: (id) => {
    // keep the user's search/category so returning home restores their context
    get().recordRecent(id);
    // editor tools (PDF, image, sheet, markdown, audio) get their own full-screen canvas view
    if (isEditorTool(id)) {
      set({ view: "editor", activeToolId: id });
      scrollTop();
      if (typeof window !== "undefined") {
        window.history.pushState({ fm: "editor", id }, "");
      }
      return;
    }
    set({ view: "tool", activeToolId: id });
    scrollTop();
    if (typeof window !== "undefined") {
      window.history.pushState({ fm: "tool", id }, "");
    }
  },
  goHome: () => {
    // NOTE: history.back() is unreliable here — Next.js App Router patches the
    // history stack. Pushing an explicit home entry is deterministic.
    set({ view: "home", activeToolId: null });
    scrollTop();
    if (typeof window !== "undefined") {
      window.history.pushState({ fm: "home" }, "");
    }
  },
  setSearch: (search) => set({ search }),
  setCategory: (category) => set({ category }),
  /** restore recent tools + language from localStorage (called once on mount) */
  hydrate: () => {
    const lang = loadLang();
    if (typeof document !== "undefined") document.documentElement.lang = lang;
    set({ recent: loadRecent(), lang });
  },
  /** remember a tool as recently used (without touching view/history) */
  recordRecent: (id) => {
    const recent = [id, ...get().recent.filter((r) => r !== id)].slice(0, RECENT_MAX);
    saveRecent(recent);
    set({ recent });
  },
  setLang: (lang) => {
    saveLang(lang);
    if (typeof document !== "undefined") document.documentElement.lang = lang;
    set({ lang });
  },
  setOcrHandoff: (files) => set({ ocrHandoff: files }),
  setResumeOpts: (resumeOpts) => set({ resumeOpts }),
  setTemplateHandoff: (templateHandoff) => set({ templateHandoff }),
}));
