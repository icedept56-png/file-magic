"use client";

import { create } from "zustand";

export type View = "home" | "tool";

const RECENT_KEY = "fm-recent-tools";
const RECENT_MAX = 6;

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
  openTool: (id: string) => void;
  goHome: () => void;
  setSearch: (s: string) => void;
  setCategory: (c: string) => void;
  hydrate: () => void;
  recordRecent: (id: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  view: "home",
  activeToolId: null,
  search: "",
  category: "all",
  recent: [],
  openTool: (id) => {
    // keep the user's search/category so returning home restores their context
    get().recordRecent(id);
    set({ view: "tool", activeToolId: id });
    scrollTop();
    if (typeof window !== "undefined") {
      window.history.pushState({ fm: "tool", id }, "");
    }
  },
  goHome: () => {
    if (typeof window !== "undefined" && window.history.state?.fm === "tool") {
      // let popstate flip the view (keeps the back stack consistent)
      window.history.back();
      return;
    }
    set({ view: "home", activeToolId: null });
    scrollTop();
  },
  setSearch: (search) => set({ search }),
  setCategory: (category) => set({ category }),
  /** restore recent tools from localStorage (called once on mount) */
  hydrate: () => set({ recent: loadRecent() }),
  /** remember a tool as recently used (without touching view/history) */
  recordRecent: (id) => {
    const recent = [id, ...get().recent.filter((r) => r !== id)].slice(0, RECENT_MAX);
    saveRecent(recent);
    set({ recent });
  },
}));
