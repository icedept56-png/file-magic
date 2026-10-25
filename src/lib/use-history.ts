"use client";

/* ═══════════════════════════════════════════════════════════════════════
   Unified undo/redo — Day 7 of the 60-day business roadmap
   (docs/ROADMAP-60-DAYS.md, Phase 1)
   Pain point: "ভুলে এক ক্লিকে কাজ নষ্ট"

   ONE system for every editor that owns discrete state:
     const h = useEditorHistory<Page[]>([]);
     h.set(nextArray)   → history point
     h.undo() / h.redo() / h.reset(value)
     h.canUndo / h.canRedo  (for visible toolbar buttons)

   Text-heavy surfaces (contentEditable / textareas) keep the browser's
   native undo — useUndoRedoKeys deliberately NEVER hijacks Ctrl+Z inside
   input/textarea/contenteditable targets.
   ═══════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from "react";

export interface EditorHistory<T> {
  state: T;
  /** record a new state (history point) */
  set: (next: T | ((prev: T) => T)) => void;
  undo: () => void;
  redo: () => void;
  /** replace everything WITHOUT creating a history point (new file load) */
  reset: (value: T) => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useEditorHistory<T>(initial: T, max = 60): EditorHistory<T> {
  const [state, setState] = useState<T>(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const stateRef = useRef<T>(initial);
  const [depth, setDepth] = useState({ undo: 0, redo: 0 });

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = stateRef.current;
      const value =
        typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      if (Object.is(value, prev)) return;
      past.current.push(prev);
      if (past.current.length > max) past.current.shift();
      future.current = [];
      stateRef.current = value;
      setState(value);
      setDepth({ undo: past.current.length, redo: 0 });
    },
    [max]
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (prev === undefined) return;
    future.current.push(stateRef.current);
    stateRef.current = prev;
    setState(prev);
    setDepth({ undo: past.current.length, redo: future.current.length });
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next === undefined) return;
    past.current.push(stateRef.current);
    stateRef.current = next;
    setState(next);
    setDepth({ undo: past.current.length, redo: future.current.length });
  }, []);

  const reset = useCallback((value: T) => {
    past.current = [];
    future.current = [];
    stateRef.current = value;
    setState(value);
    setDepth({ undo: 0, redo: 0 });
  }, []);

  return { state, set, undo, redo, reset, canUndo: depth.undo > 0, canRedo: depth.redo > 0 };
}

/** is the event target a text-editing surface? (those keep native undo) */
function isTextTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

/**
 * Global Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y for an editor.
 * Ignores text-editing targets so native undo keeps working there.
 */
export function useUndoRedoKeys(
  h: Pick<EditorHistory<unknown>, "undo" | "redo">,
  enabled = true
): void {
  const ref = useRef(h);
  useEffect(() => {
    ref.current = h;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (isTextTarget(e)) return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) ref.current.redo();
        else ref.current.undo();
      } else if (key === "y") {
        e.preventDefault();
        ref.current.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
