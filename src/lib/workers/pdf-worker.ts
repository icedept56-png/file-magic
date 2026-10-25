/* PDF worker (Day 9) — runs pdf-core ops off the main thread.
   Protocol: { id, payload } → { id, type: "progress" | "done" | "error", ... }
   Localization stays on the main thread: errors/progress carry KEYS only. */

import { runPdfOp, type PdfOpPayload } from "./pdf-core";

const ctx = self as unknown as Worker;

ctx.onmessage = async (e: MessageEvent) => {
  const { id, payload } = e.data as { id: number; payload: PdfOpPayload };
  try {
    const result = await runPdfOp(payload, (pct, key, args) => {
      ctx.postMessage({ id, type: "progress", pct, key, args });
    });
    ctx.postMessage({ id, type: "done", result }, result.files.map((f) => f.bytes));
  } catch (err) {
    const fm = err as { key?: string; args?: (string | number)[] };
    ctx.postMessage({
      id,
      type: "error",
      key: fm?.key ?? "unexpected",
      args: Array.isArray(fm?.args) ? fm.args : [],
    });
  }
};
