"use client";

/**
 * Global error boundary (Day 23) — last resort when the root layout itself
 * fails. Minimal, self-contained styling (globals.css may not have loaded).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="bn">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f8faf9",
          fontFamily: "system-ui, 'Hind Siliguri', sans-serif",
          color: "#052e2b",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>
            একটু সমস্যা হয়েছে · Something went wrong
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.7, margin: "0 0 20px", opacity: 0.75 }}>
            আপনার ফাইল ডিভাইসেই নিরাপদ। Your files are safe on this device.
          </p>
          <button
            onClick={reset}
            style={{
              border: 0,
              borderRadius: 12,
              padding: "12px 22px",
              background: "linear-gradient(90deg,#10b981,#0d9488)",
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            আবার চালু করুন / Try again
          </button>
          {error.digest && (
            <p style={{ marginTop: 16, fontSize: 10, fontFamily: "monospace", opacity: 0.4 }}>
              {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
