"use client";

import { create } from "zustand";

export type View = "home" | "tool";

interface AppState {
  view: View;
  activeToolId: string | null;
  search: string;
  category: string;
  openTool: (id: string) => void;
  goHome: () => void;
  setSearch: (s: string) => void;
  setCategory: (c: string) => void;
}

const scrollTop = () => {
  if (typeof window !== "undefined") {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }
};

export const useAppStore = create<AppState>((set) => ({
  view: "home",
  activeToolId: null,
  search: "",
  category: "all",
  openTool: (id) => {
    set({ view: "tool", activeToolId: id, search: "", category: "all" });
    scrollTop();
  },
  goHome: () => {
    set({ view: "home", activeToolId: null });
    scrollTop();
  },
  setSearch: (search) => set({ search }),
  setCategory: (category) => set({ category }),
}));
