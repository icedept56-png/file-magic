"use client";

import { AlertOctagon, Home, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * রুট এরর বাউন্ডারি (Day 23 — 60-day roadmap).
 * Bilingual by design (the store may itself be the crash site), privacy-first
 * copy: the user's files never left the device.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <div className="fm-card w-full max-w-md rounded-2xl p-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 shadow-lg shadow-rose-500/30">
          <AlertOctagon className="h-7 w-7 text-white" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-bold text-emerald-950">
          একটু সমস্যা হয়েছে <span className="text-emerald-900/40">·</span> Something went wrong
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-emerald-900/65">
          চিন্তা নেই — আপনার ফাইল ডিভাইসেই নিরাপদ। পেজটি আবার চালু করে দেখুন।
          <br />
          <span className="text-emerald-900/50">
            Don&apos;t worry — your files are safe on this device. Try again below.
          </span>
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button
            onClick={reset}
            className="h-11 bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold text-white shadow-md shadow-emerald-500/25 hover:from-emerald-600 hover:to-teal-700"
          >
            <RotateCcw className="h-4 w-4" />
            আবার চালু করুন / Try again
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              window.location.href = "/";
            }}
            className="h-11 border-emerald-600/25 text-emerald-800 hover:bg-emerald-50"
          >
            <Home className="h-4 w-4" />
            হোমে যান / Go home
          </Button>
        </div>
        {error.digest && (
          <p className="mt-4 font-mono text-[10px] text-emerald-900/35">{error.digest}</p>
        )}
      </div>
    </div>
  );
}
