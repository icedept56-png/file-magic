"use client";

/* ═══════════════════════════════════════════════════════════════════════
   PDF worker client (Day 9) — routes heavy pdf-lib ops off the main thread.

   • lazily creates ONE module worker (src/lib/workers/pdf-worker.ts)
   • buffers are TRANSFERRED (zero-copy) to the worker
   • progress messages are re-localized via pLabel on this thread
   • functional errors arrive as { key, args } → re-thrown via err()
   • worker-level crashes (old browser, script load failure) throw
     PdfWorkerCrash — the caller re-reads its Files and retries on the
     main thread via runPdfOnMain(). The app behaves exactly as before,
     just without the responsiveness win.
   • (window as any).__fmPdfWorkerMode exposes "worker" | "main" for
     diagnostics/E2E after each call.
   ═══════════════════════════════════════════════════════════════════════ */

import { err, pLabel } from "@/lib/tools/messages";
import {
  runPdfOp as runPdfCore,
  type PdfOpPayload,
  type PdfOpResult,
} from "./pdf-core";

export class PdfWorkerCrash extends Error {
  constructor() {
    super("pdf-worker-crash");
  }
}

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;

/** diagnostics: how did the last call actually run? */
export const pdfWorkerState = { lastMode: "main" as "worker" | "main" };

function mark(mode: "worker" | "main") {
  pdfWorkerState.lastMode = mode;
  if (typeof window !== "undefined") {
    (window as unknown as { __fmPdfWorkerMode?: string }).__fmPdfWorkerMode = mode;
  }
}

/** main-thread fallback with the same localization contract as the worker */
export function runPdfOnMain(
  payload: PdfOpPayload,
  onProgress: (pct: number, label: string) => void
): Promise<PdfOpResult> {
  mark("main");
  return runPdfCore(payload, (pct, key, args) =>
    onProgress(pct, pLabel(key as never, ...(args ?? [])))
  );
}

function transfers(payload: PdfOpPayload): ArrayBuffer[] {
  const list: ArrayBuffer[] = [];
  const push = (b: unknown) => {
    if (b instanceof ArrayBuffer) list.push(b);
  };
  if (payload.op === "merge") payload.buffers.forEach(push);
  else {
    push(payload.buffer);
    if (payload.op === "watermark") push(payload.png);
  }
  return list;
}

export function runPdf(
  payload: PdfOpPayload,
  onProgress: (pct: number, label: string) => void
): Promise<PdfOpResult> {
  if (typeof window === "undefined" || typeof Worker === "undefined" || workerBroken) {
    return runPdfOnMain(payload, onProgress);
  }

  let w: Worker;
  try {
    if (!worker) {
      worker = new Worker(new URL("./pdf-worker.ts", import.meta.url), { type: "module" });
    }
    w = worker;
  } catch {
    workerBroken = true;
    return runPdfOnMain(payload, onProgress);
  }

  const id = nextId++;

  return new Promise<PdfOpResult>((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as {
        id: number;
        type: "progress" | "done" | "error";
        pct?: number;
        key?: string;
        args?: (string | number)[];
        result?: PdfOpResult;
      };
      if (!msg || msg.id !== id) return;
      if (msg.type === "progress") {
        onProgress(msg.pct ?? 0, pLabel((msg.key ?? "pDone") as never, ...(msg.args ?? [])));
        return;
      }
      cleanup();
      if (msg.type === "done" && msg.result) {
        mark("worker");
        resolve(msg.result);
      } else {
        // functional error (corrupt PDF, bad range...) — worker stays healthy
        mark("worker");
        reject(err((msg.key ?? "unexpected") as never, ...(msg.args ?? [])));
      }
    };
    const onError = () => {
      // worker-level failure (script didn't load etc.) — caller falls back
      cleanup();
      workerBroken = true;
      reject(new PdfWorkerCrash());
    };
    const cleanup = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);

    try {
      w.postMessage({ id, payload }, transfers(payload));
    } catch {
      cleanup();
      workerBroken = true;
      reject(new PdfWorkerCrash());
    }
  });
}
