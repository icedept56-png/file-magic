"use client";

/**
 * সাম্প্রতিক কাজ — recent ACTIVITY store (Day 14 — 60-day roadmap).
 *
 * Privacy-first by design: IndexedDB keeps only METADATA (tool id, file
 * names/sizes, output count, option snapshot). File contents are NEVER
 * stored — processing stays 100% client-side and nothing is uploaded.
 */

export interface ActivityRecord {
  id: number; // auto-increment key
  at: number; // epoch ms
  toolId: string;
  names: string[]; // first few input file names (or [] for text-only input)
  count: number; // input file count
  bytes: number; // total input bytes
  outputs: number; // output count
  /** option snapshot so "চালিয়ে যাওয়া" (resume) can pre-fill the form */
  opts?: Record<string, string | number | boolean>;
  /** pasted text for text-input tools, capped — small and local-only */
  text?: string;
}

const DB_NAME = "fm-recents";
const STORE = "activity";
const MAX = 20;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const t = db.transaction(STORE, mode);
          const req = run(t.objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
          t.oncomplete = () => db.close();
        } catch {
          resolve(null);
        }
      })
  );
}

/** add one activity entry, prune to the newest MAX — fire-and-forget safe */
export async function recordActivity(r: Omit<ActivityRecord, "id" | "at">): Promise<void> {
  const all = await getAll();
  if (!all) return;
  const rec: Omit<ActivityRecord, "id"> = { ...r, at: Date.now() };
  // de-dup: same tool + same inputs within 60s just updates the timestamp
  const dup = all.find(
    (a) =>
      a.toolId === r.toolId &&
      a.count === r.count &&
      a.bytes === r.bytes &&
      a.names.slice(0, 4).join("|") === r.names.slice(0, 4).join("|") &&
      Date.now() - a.at < 60_000
  );
  const db = await openDb();
  if (!db) return;
  try {
    const t = db.transaction(STORE, "readwrite");
    const store = t.objectStore(STORE);
    if (dup) store.put({ ...rec, id: dup.id });
    else store.add(rec);
    for (const old of all.slice(MAX - 1)) store.delete(old.id);
    t.oncomplete = () => db.close();
  } catch {
    /* private mode — silently skip */
  }
}

async function getAll(): Promise<ActivityRecord[] | null> {
  const out = await tx<ActivityRecord[]>("readonly", (s) => s.getAll() as IDBRequest<ActivityRecord[]>);
  if (!out) return null;
  return out.sort((a, b) => b.at - a.at);
}

export async function getActivity(limit = 8): Promise<ActivityRecord[]> {
  const all = await getAll();
  return (all ?? []).slice(0, limit);
}

export async function deleteActivity(id: number): Promise<void> {
  await tx("readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
}

export async function clearActivity(): Promise<void> {
  await tx("readwrite", (s) => s.clear() as IDBRequest<undefined>);
}

/** relative time in the active language — "এইমাত্র", "৫ মিনিট আগে"… */
export function relTime(at: number, bn: boolean, num: (v: number | string) => string): string {
  const s = Math.max(1, Math.round((Date.now() - at) / 1000));
  const fmt = (n: number, unitBn: string, unitEn: string) =>
    bn ? `${num(n)} ${unitBn} আগে` : `${n} ${unitEn} ago`;
  if (s < 60) return bn ? "এইমাত্র" : "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return fmt(m, "মিনিট", "min");
  const h = Math.floor(m / 60);
  if (h < 24) return fmt(h, "ঘণ্টা", "hour");
  const d = Math.floor(h / 24);
  if (d === 1) return bn ? "গতকাল" : "yesterday";
  if (d < 30) return fmt(d, "দিন", "day");
  const mo = Math.floor(d / 30);
  return fmt(mo, "মাস", "month");
}
