"use client";

/**
 * হ্যাপটিক ফিডব্যাক (Day 21 — 60-day roadmap)
 * Tiny vibration cues on Android (Vibration API). iOS ignores vibrate —
 * silently a no-op there, so this is always safe to call.
 */
export type HapticKind = "select" | "light" | "success" | "error";

const PATTERNS: Record<HapticKind, number | number[]> = {
  select: 8, // tool/card open, toggles
  light: 12, // downloads, small confirmations
  success: [12, 40, 18], // job done
  error: [24, 50, 24], // something failed
};

export function haptic(kind: HapticKind = "light") {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(PATTERNS[kind] as VibratePattern);
  } catch {
    /* never let a haptic break a flow */
  }
}
