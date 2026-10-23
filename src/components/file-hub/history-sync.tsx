"use client";

import { useEffect } from "react";

import { getTool, isEditorTool } from "@/lib/tools/registry";
import { useAppStore } from "@/store/app-store";

/**
 * Wires the SPA view into browser history:
 *  - popstate (back/forward) flips between home ↔ tool ↔ editor views
 *  - "/?tool=<id>" deep links (also used by the PWA app shortcuts) open the tool directly
 *  - hydrates the recent-tools list from localStorage
 */
export function HistorySync() {
  useEffect(() => {
    const store = useAppStore.getState();

    // restore recent tools (client only — avoids hydration mismatch)
    store.hydrate();

    // deep link support: /?tool=merge-pdf (editor tools open their canvas view)
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("tool");
    if (requested && getTool(requested)) {
      // seed the history entry as "home" so Back from the tool stays inside the app
      window.history.replaceState({ fm: "home" }, "");
      useAppStore.getState().recordRecent(requested);
      useAppStore.setState({
        view: isEditorTool(requested) ? "editor" : "tool",
        activeToolId: requested,
      });
      window.history.pushState(
        { fm: isEditorTool(requested) ? "editor" : "tool", id: requested },
        ""
      );
    }

    const onPop = (e: PopStateEvent) => {
      const st = e.state as { fm?: string; id?: string } | null;
      if (st?.fm === "tool" && st.id && getTool(st.id)) {
        useAppStore.setState({ view: "tool", activeToolId: st.id });
        window.scrollTo({ top: 0 });
      } else if (st?.fm === "editor" && st.id && getTool(st.id)) {
        useAppStore.setState({ view: "editor", activeToolId: st.id });
        window.scrollTo({ top: 0 });
      } else {
        useAppStore.setState({ view: "home", activeToolId: null });
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return null;
}
