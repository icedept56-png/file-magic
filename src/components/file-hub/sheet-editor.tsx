"use client";

import { memo, useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Columns3,
  Download,
  FileSpreadsheet,
  Loader2,
  Minus,
  Plus,
  Rows3,
  Table2,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n";
import { downloadBlob, stripExt } from "@/lib/tools/helpers";
import { useAppStore } from "@/store/app-store";

/* ── model ─────────────────────────────────────────────────────────────── */

type WorkbookState = {
  sheetNames: string[];
  data: Record<string, string[][]>;
  active: string;
};

const MAX_RENDER_ROWS = 300;
const MAX_RENDER_COLS = 40;
const SHEET_ACCEPT = ".xlsx,.xls,.csv";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/* column index → spreadsheet letters (A..Z, AA..AB…) */
function colName(i: number): string {
  let s = "";
  let n = i;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

/* pad every row to the same column count; guarantee ≥1 row & ≥1 col */
function normalizeSheet(rows: string[][]): string[][] {
  let maxCols = 1;
  for (const row of rows) if (row.length > maxCols) maxCols = row.length;
  const out: string[][] = rows.map((row) => {
    if (row.length >= maxCols) return row;
    return [...row, ...new Array<string>(maxCols - row.length).fill("")];
  });
  if (out.length === 0) out.push(new Array<string>(maxCols).fill(""));
  return out;
}

/* ── memoized grid row (only the edited row re-renders on keystroke) ───── */

type GridRowProps = {
  row: string[];
  rowIndex: number;
  viewCols: number;
  rowSelected: boolean;
  selectedCol: number;
  onCell: (r: number, c: number, v: string) => void;
  onPickCell: (r: number, c: number) => void;
  onPickRow: (r: number) => void;
};

const GridRow = memo(function GridRow({
  row,
  rowIndex,
  viewCols,
  rowSelected,
  selectedCol,
  onCell,
  onPickCell,
  onPickRow,
}: GridRowProps) {
  const { t, num } = useT();
  return (
    <tr className={rowSelected ? "bg-amber-50" : "bg-white"}>
      <th
        scope="row"
        className={`sticky left-0 z-10 w-12 min-w-12 border-b border-r border-emerald-900/10 p-0 text-center ${
          rowSelected ? "bg-amber-100/90" : "bg-white"
        }`}
      >
        <button
          type="button"
          onClick={() => onPickRow(rowIndex)}
          aria-label={`${t("seSelRow")} ${num(rowIndex + 1)}`}
          className={`h-full w-full cursor-pointer py-2 text-center text-xs font-semibold tabular-nums transition ${
            rowSelected
              ? "text-amber-900 hover:bg-amber-200/60"
              : "text-emerald-900/60 hover:bg-emerald-50 hover:text-emerald-900"
          }`}
        >
          {num(rowIndex + 1)}
        </button>
      </th>
      {Array.from({ length: viewCols }, (_, c) => {
        const inSelCol = selectedCol === c;
        return (
          <td
            key={c}
            className={`border-b border-r border-emerald-900/[0.07] p-0 ${
              inSelCol ? (rowSelected ? "bg-amber-100" : "bg-amber-50") : ""
            }`}
          >
            <Input
              value={row[c] ?? ""}
              onChange={(e) => onCell(rowIndex, c, e.target.value)}
              onFocus={() => onPickCell(rowIndex, c)}
              aria-label={`${t("seCellAria")} — ${num(rowIndex + 1)} × ${num(c + 1)}`}
              className="h-9 min-w-[7rem] rounded-none border-0 bg-transparent px-2 text-sm text-emerald-950 shadow-none dark:bg-transparent focus-visible:border-emerald-500/40 focus-visible:ring-[2px] focus-visible:ring-emerald-500/40"
            />
          </td>
        );
      })}
    </tr>
  );
});

/* ══════════════════════════════════════════════════════════════════════ */

export function SheetEditor() {
  const { t, num, lang } = useT();
  const goHome = useAppStore((s) => s.goHome);

  const [wb, setWb] = useState<WorkbookState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedRow, setSelectedRow] = useState(-1);
  const [selectedCol, setSelectedCol] = useState(-1);
  const [baseName, setBaseName] = useState("sheet");

  const fileInputRef = useRef<HTMLInputElement>(null);

  /* derived (render-time slice only — FULL data always kept in state) */
  const rows = wb ? (wb.data[wb.active] ?? []) : [];
  const rowCount = rows.length;
  const colCount = rows[0]?.length ?? 1;
  const big = rowCount > MAX_RENDER_ROWS || colCount > MAX_RENDER_COLS;
  const viewRows = rowCount > MAX_RENDER_ROWS ? rows.slice(0, MAX_RENDER_ROWS) : rows;
  const viewCols = Math.min(colCount, MAX_RENDER_COLS);
  const busy = loading || saving;

  /* ── load ──────────────────────────────────────────────────────────── */

  const openFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setLoading(true);
      try {
        const buf = await file.arrayBuffer();
        const XLSX = await import("xlsx");
        /* CSV byte arrays default to CP1252 in SheetJS — decode UTF-8 ourselves
           so Bengali (and any non-ASCII) survives; XLSX is UTF-8 XML internally */
        const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
        const parsed = isCsv
          ? XLSX.read(new TextDecoder("utf-8").decode(buf), { type: "string" })
          : XLSX.read(buf, { type: "array" });
        if (!parsed.SheetNames.length) throw new Error("no sheets");
        const data: Record<string, string[][]> = {};
        for (const name of parsed.SheetNames) {
          const ws = parsed.Sheets[name];
          if (!ws) throw new Error("missing sheet");
          const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, {
            header: 1,
            raw: false,
            defval: "",
          });
          const grid = raw.map((row) =>
            row.map((cell) => (cell == null ? "" : String(cell)))
          );
          data[name] = normalizeSheet(grid);
        }
        setWb({ sheetNames: parsed.SheetNames, data, active: parsed.SheetNames[0] });
        setBaseName(stripExt(file.name) || "sheet");
        setSelectedRow(-1);
        setSelectedCol(-1);
      } catch {
        toast.error(t("seLoadFail"));
      } finally {
        setLoading(false);
      }
    },
    [t]
  );

  /* ── immutable mutations (only the affected row is copied) ─────────── */

  const onCell = useCallback((r: number, c: number, v: string) => {
    setWb((prev) => {
      if (!prev) return prev;
      const rows = prev.data[prev.active];
      const row = rows[r];
      if (!row || row[c] === v) return prev;
      const newRow = row.slice();
      newRow[c] = v;
      const newRows = rows.slice();
      newRows[r] = newRow;
      return { ...prev, data: { ...prev.data, [prev.active]: newRows } };
    });
  }, []);

  const onPickCell = useCallback((r: number, c: number) => {
    setSelectedRow(r);
    setSelectedCol(c);
  }, []);

  const onPickRow = useCallback((r: number) => setSelectedRow(r), []);
  const onPickCol = useCallback((c: number) => setSelectedCol(c), []);

  const addRow = useCallback(() => {
    setWb((prev) => {
      if (!prev) return prev;
      const rows = prev.data[prev.active];
      const cols = rows[0]?.length ?? 1;
      return {
        ...prev,
        data: {
          ...prev.data,
          [prev.active]: [...rows, new Array<string>(cols).fill("")],
        },
      };
    });
  }, []);

  const addCol = useCallback(() => {
    setWb((prev) => {
      if (!prev) return prev;
      const rows = prev.data[prev.active];
      return {
        ...prev,
        data: { ...prev.data, [prev.active]: rows.map((row) => [...row, ""]) },
      };
    });
  }, []);

  const delRow = useCallback(() => {
    if (selectedRow < 0) return;
    setWb((prev) => {
      if (!prev) return prev;
      const rows = prev.data[prev.active];
      if (rows.length <= 1 || selectedRow >= rows.length) return prev;
      return {
        ...prev,
        data: {
          ...prev.data,
          [prev.active]: rows.filter((_, i) => i !== selectedRow),
        },
      };
    });
    setSelectedRow(-1);
  }, [selectedRow]);

  const delCol = useCallback(() => {
    if (selectedCol < 0) return;
    setWb((prev) => {
      if (!prev) return prev;
      const rows = prev.data[prev.active];
      const cols = rows[0]?.length ?? 1;
      if (cols <= 1 || selectedCol >= cols) return prev;
      return {
        ...prev,
        data: {
          ...prev.data,
          [prev.active]: rows.map((row) => {
            const nr = row.slice();
            nr.splice(selectedCol, 1);
            return nr;
          }),
        },
      };
    });
    setSelectedCol(-1);
  }, [selectedCol]);

  const switchSheet = useCallback((name: string) => {
    setWb((prev) =>
      prev && prev.active !== name ? { ...prev, active: name } : prev
    );
    setSelectedRow(-1);
    setSelectedCol(-1);
  }, []);

  /* ── save ──────────────────────────────────────────────────────────── */

  const saveXlsx = useCallback(async () => {
    if (!wb) return;
    setSaving(true);
    try {
      const XLSX = await import("xlsx");
      const outWb = XLSX.utils.book_new();
      for (const name of wb.sheetNames) {
        const ws = XLSX.utils.aoa_to_sheet(wb.data[name] ?? []);
        XLSX.utils.book_append_sheet(outWb, ws, name);
      }
      const ab = XLSX.write(outWb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
      downloadBlob(
        new Blob([new Uint8Array(ab)], { type: XLSX_MIME }),
        `${baseName}-edited.xlsx`
      );
      toast.success(t("seSaved"));
    } catch {
      toast.error(t("seSaveFail"));
    } finally {
      setSaving(false);
    }
  }, [wb, baseName, t]);

  const saveCsv = useCallback(async () => {
    if (!wb) return;
    setSaving(true);
    try {
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet(wb.data[wb.active] ?? []);
      const csv = XLSX.utils.sheet_to_csv(ws);
      /* BOM so Excel opens Bengali text correctly */
      downloadBlob(
        new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
        `${baseName}-edited.csv`
      );
      toast.success(t("seSaved"));
    } catch {
      toast.error(t("seSaveFail"));
    } finally {
      setSaving(false);
    }
  }, [wb, baseName, t]);

  /* ═══════════════════════════════════════════════════════ render ══ */

  if (!wb) {
    return (
      <section className="mx-auto w-full max-w-3xl px-4 pb-16 pt-10 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="fm-card rounded-3xl p-8 text-center sm:p-12"
        >
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/30">
            <Table2 className="h-8 w-8 text-white" />
          </span>
          <h1 className="mt-5 text-xl font-bold text-emerald-950 sm:text-2xl">
            {t("seTitle")}
          </h1>
          <p className="mt-2 text-sm text-emerald-900/60">{t("seDropHint")}</p>

          {loading ? (
            <div className="mt-8 flex items-center justify-center text-emerald-700">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <>
              <div
                role="button"
                tabIndex={0}
                aria-label={t("sePick")}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  void openFile(e.dataTransfer.files?.[0]);
                }}
                className={`mt-8 cursor-pointer rounded-2xl border-2 border-dashed px-6 py-10 outline-none transition focus-visible:ring-2 focus-visible:ring-emerald-500/50 ${
                  dragOver
                    ? "border-emerald-500/60 bg-emerald-50"
                    : "border-emerald-500/25 bg-emerald-50/40 hover:border-emerald-500/50 hover:bg-emerald-50/70"
                }`}
              >
                <UploadCloud className="mx-auto h-8 w-8 text-emerald-600/70" />
                <p className="mt-3 font-semibold text-emerald-950/85">{t("seDrop")}</p>
                <Button className="btn-shine mt-4 bg-gradient-to-r from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25 hover:from-emerald-600 hover:to-teal-700">
                  {t("sePick")}
                </Button>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-emerald-900/50">
                {[
                  `${t("seAddRow")} · ${t("seAddCol")} · ${t("seDelRow")} · ${t("seDelCol")}`,
                  `${t("seSaveXlsx")} · ${t("seSaveCsv")}`,
                  `${t("seRows")} ${MAX_RENDER_ROWS}+ · ${t("seCols")} ${MAX_RENDER_COLS}+`,
                ].map((chip, i) => (
                  <span
                    key={i}
                    className="rounded-full border border-emerald-600/10 bg-emerald-50/70 px-3 py-1 font-medium"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </>
          )}

          <Label htmlFor="se-file" className="sr-only">
            {t("sePick")}
          </Label>
          <input
            ref={fileInputRef}
            id="se-file"
            type="file"
            accept={SHEET_ACCEPT}
            className="sr-only"
            onChange={(e) => {
              void openFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </motion.div>
      </section>
    );
  }

  return (
    <section className="flex min-h-[calc(100vh-4rem)] flex-col">
      {/* ── toolbar row 1: back + file + badges + save ─────────────────── */}
      <div className="sticky top-16 z-20 border-b border-emerald-900/[0.06] bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-2 px-3 py-2.5 sm:px-5">
          <Button
            variant="ghost"
            size="sm"
            onClick={goHome}
            className="h-9 text-emerald-900/70 hover:bg-emerald-600/10 hover:text-emerald-900"
            aria-label={lang === "en" ? "Back" : "ফিরুন"}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">{lang === "en" ? "Back" : "ফিরুন"}</span>
          </Button>

          <span className="flex min-w-0 items-center gap-1.5">
            <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600" />
            <span className="hidden max-w-[160px] truncate text-sm font-semibold text-emerald-950 md:block">
              {baseName}
            </span>
          </span>

          <span className="flex items-center gap-1.5 text-xs font-semibold">
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-600/15 bg-emerald-50 px-2.5 py-1 text-emerald-800">
              <Rows3 className="h-3.5 w-3.5" />
              {num(rowCount)} {t("seRows")}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-teal-600/15 bg-teal-50 px-2.5 py-1 text-teal-800">
              <Columns3 className="h-3.5 w-3.5" />
              {num(colCount)} {t("seCols")}
            </span>
          </span>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {selectedRow >= 0 && (
              <span className="hidden items-center gap-1 rounded-full border border-amber-500/25 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 sm:inline-flex">
                {t("seSelRow")} {num(selectedRow + 1)}
              </span>
            )}
            {selectedCol >= 0 && (
              <span className="hidden items-center gap-1 rounded-full border border-amber-500/25 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 md:inline-flex">
                {t("seSelCol")} {num(selectedCol + 1)}
              </span>
            )}

            <Button
              size="sm"
              onClick={() => void saveXlsx()}
              disabled={busy}
              className="btn-shine h-9 bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/25 hover:from-emerald-600 hover:to-teal-700"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {saving ? t("seSaving") : t("seSaveXlsx")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void saveCsv()}
              disabled={busy}
              className="h-9 border-emerald-600/30 bg-white text-emerald-800 hover:bg-emerald-50 hover:text-emerald-900"
            >
              <Download className="h-4 w-4" />
              {t("seSaveCsv")}
            </Button>
          </div>
        </div>

        {/* ── toolbar row 2: grid operations ──────────────────────────── */}
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-1.5 px-3 pb-2.5 sm:px-5">
          <button
            type="button"
            onClick={addRow}
            disabled={loading}
            aria-label={t("seAddRow")}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-emerald-900/[0.08] bg-white px-3 text-xs font-semibold text-emerald-900/80 shadow-sm transition hover:bg-emerald-50 hover:text-emerald-900 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("seAddRow")}
          </button>
          <button
            type="button"
            onClick={addCol}
            disabled={loading}
            aria-label={t("seAddCol")}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-emerald-900/[0.08] bg-white px-3 text-xs font-semibold text-emerald-900/80 shadow-sm transition hover:bg-emerald-50 hover:text-emerald-900 disabled:opacity-40"
          >
            <Columns3 className="h-3.5 w-3.5" />
            {t("seAddCol")}
          </button>
          <button
            type="button"
            onClick={delRow}
            disabled={selectedRow < 0 || rowCount <= 1}
            aria-label={
              selectedRow >= 0
                ? `${t("seDelRow")} (${num(selectedRow + 1)})`
                : t("seDelRow")
            }
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-rose-600/15 bg-white px-3 text-xs font-semibold text-rose-600/80 shadow-sm transition hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
          >
            <Minus className="h-3.5 w-3.5" />
            {t("seDelRow")}
          </button>
          <button
            type="button"
            onClick={delCol}
            disabled={selectedCol < 0 || colCount <= 1}
            aria-label={
              selectedCol >= 0
                ? `${t("seDelCol")} (${num(selectedCol + 1)})`
                : t("seDelCol")
            }
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-rose-600/15 bg-white px-3 text-xs font-semibold text-rose-600/80 shadow-sm transition hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
          >
            <X className="h-3.5 w-3.5" />
            {t("seDelCol")}
          </button>
        </div>
      </div>

      {/* ── sheet tabs ─────────────────────────────────────────────────── */}
      <div className="fm-scroll overflow-x-auto border-b border-emerald-900/[0.06] bg-white/60">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-1.5 px-3 py-2 sm:px-5">
          <span className="mr-1 shrink-0 text-xs font-semibold text-emerald-900/50">
            {t("seSheet")}
          </span>
          {wb.sheetNames.map((name) => {
            const active = name === wb.active;
            return (
              <button
                key={name}
                type="button"
                onClick={() => switchSheet(name)}
                aria-label={`${t("seSheet")}: ${name}`}
                aria-pressed={active}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                  active
                    ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/20"
                    : "border border-emerald-900/10 bg-white text-emerald-900/70 hover:bg-emerald-50 hover:text-emerald-900"
                }`}
              >
                <Table2 className="h-3.5 w-3.5" />
                {name}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── grid ───────────────────────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 pb-10 sm:px-5">
        {big && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            <span>{t("seBigWarn")}</span>
            <span className="tabular-nums">
              {num(viewRows.length)}/{num(rowCount)} {t("seRows")} · {num(viewCols)}/
              {num(colCount)} {t("seCols")}
            </span>
          </div>
        )}

        <div className="fm-scroll max-h-[65vh] overflow-auto rounded-2xl border border-emerald-900/10 bg-white shadow-sm">
          <table className="w-full border-separate border-spacing-0 text-sm text-emerald-950">
            <thead>
              <tr>
                <th
                  scope="col"
                  aria-label={lang === "en" ? "Row numbers" : "সারি নম্বর"}
                  className="sticky left-0 top-0 z-30 w-12 min-w-12 border-b border-r border-emerald-900/10 bg-white p-0"
                />
                {Array.from({ length: viewCols }, (_, c) => (
                  <th
                    key={c}
                    scope="col"
                    className="sticky top-0 z-20 border-b border-r border-emerald-900/10 bg-white p-0"
                  >
                    <button
                      type="button"
                      onClick={() => onPickCol(c)}
                      aria-label={`${t("seSelCol")} ${num(c + 1)}`}
                      className={`h-full w-full min-w-[7rem] cursor-pointer select-none px-2 py-2 text-center text-xs font-bold tracking-wide transition ${
                        selectedCol === c
                          ? "bg-amber-100/90 text-amber-900"
                          : "text-emerald-900/60 hover:bg-emerald-50 hover:text-emerald-900"
                      }`}
                    >
                      {colName(c)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {viewRows.map((row, r) => (
                <GridRow
                  key={r}
                  row={row}
                  rowIndex={r}
                  viewCols={viewCols}
                  rowSelected={selectedRow === r}
                  selectedCol={selectedCol}
                  onCell={onCell}
                  onPickCell={onPickCell}
                  onPickRow={onPickRow}
                />
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-center text-xs text-emerald-900/45">
          {t("seRows")} {num(viewRows.length)} · {t("seCols")} {num(viewCols)}
        </p>
      </div>
    </section>
  );
}
