import type { LucideIcon } from "lucide-react";

/** A processed output file ready for download */
export interface OutputFile {
  name: string;
  blob: Blob;
}

/** Options passed to a tool processor (values from the options form + textarea text) */
export type ToolOptions = Record<string, string | number | boolean>;

/** Progress callback: 0-100 */
export type ProgressFn = (pct: number, label?: string) => void;

/** The processing function every tool implements */
export type ProcessFn = (
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
) => Promise<OutputFile[]>;

export type CategoryId =
  | "pdf"
  | "image"
  | "document"
  | "spreadsheet"
  | "archive"
  | "utility";

export interface Category {
  id: CategoryId | "all";
  label: string; // Bengali label
  gradient: string; // tailwind gradient classes for the chip when active
}

/** How the tool takes input */
export type InputMode = "file" | "text" | "both";

export interface ToolOptionField {
  key: string;
  label: string; // Bengali
  type: "select" | "text" | "number" | "range" | "checkbox" | "textarea";
  options?: { value: string; label: string }[];
  default?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  /** show this unit after range value */
  unit?: string;
}

export interface ToolDef {
  id: string;
  name: string; // Bengali display name
  nameEn: string; // for search
  desc: string; // Bengali short description
  category: CategoryId;
  icon: LucideIcon;
  /** gradient classes for the icon tile, e.g. "from-rose-500 to-red-600" */
  gradient: string;
  /** css shadow glow color for hover, e.g. "rgba(244,63,94,0.35)" */
  glow: string;
  files: {
    accept: string; // input accept attribute
    multiple: boolean;
    /** minimum number of files required (default 1) */
    min?: number;
  };
  inputMode: InputMode;
  /** Bengali hint about accepted file types, shown in the dropzone */
  hint: string;
  /** Bengali label for the action button, default "প্রসেস করুন" */
  actionLabel: string;
  options: ToolOptionField[];
  process: ProcessFn;
}
