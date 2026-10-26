"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  Download,
  FileUser,
  Languages,
  Loader2,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { downloadBlob } from "@/lib/tools/helpers";
import { useT } from "@/lib/i18n";
import { useAppStore, type Lang } from "@/store/app-store";

/**
 * সিভি বিল্ডার (Day 18 — 60-day roadmap)
 * Bengali-first résumé builder: structured form → live A4 preview → PDF.
 * Drafts auto-save to localStorage; nothing ever leaves the device.
 */

type Tpl = "classic" | "sidebar" | "minimal";

interface EduItem {
  degree: string;
  org: string;
  year: string;
}
interface ExpItem {
  role: string;
  org: string;
  period: string;
  detail: string;
}
interface CVData {
  name: string;
  jobTitle: string;
  phone: string;
  email: string;
  address: string;
  summary: string;
  education: EduItem[];
  experience: ExpItem[];
  skills: string;
  tpl: Tpl;
  cvLang: Lang; // language of the CV's own section headings
}

const EMPTY: CVData = {
  name: "",
  jobTitle: "",
  phone: "",
  email: "",
  address: "",
  summary: "",
  education: [{ degree: "", org: "", year: "" }],
  experience: [{ role: "", org: "", period: "", detail: "" }],
  skills: "",
  tpl: "classic",
  cvLang: "bn",
};

const STORE_KEY = "fm-cv-data";

function loadDraft(): CVData {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return EMPTY;
    const d = JSON.parse(raw) as Partial<CVData>;
    return {
      ...EMPTY,
      ...d,
      education: Array.isArray(d.education) && d.education.length ? d.education : EMPTY.education,
      experience: Array.isArray(d.experience) && d.experience.length ? d.experience : EMPTY.experience,
      tpl: d.tpl === "sidebar" || d.tpl === "minimal" ? d.tpl : "classic",
      cvLang: d.cvLang === "en" ? "en" : "bn",
    };
  } catch {
    return EMPTY;
  }
}

/** section-heading pairs — the CV's own language (not the UI language) */
const HEAD = {
  contact: ["যোগাযোগ", "Contact"],
  summary: ["ক্যারিয়ার লক্ষ্য", "Career objective"],
  education: ["শিক্ষা", "Education"],
  experience: ["অভিজ্ঞতা", "Experience"],
  skills: ["দক্ষতা", "Skills"],
} as const;

const EMERALD = "#059669";
const INK = "#1f2937";
const MUTED = "#6b7280";

function row(title: string, sub: string, right: string): string {
  return `<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:8px">
    <div><b style="color:${INK}">${title}</b>${sub ? `<span style="color:${MUTED}"> — ${sub}</span>` : ""}</div>
    ${right ? `<span style="color:${MUTED};white-space:nowrap;font-size:12.5px">${right}</span>` : ""}
  </div>`;
}

function buildCvHtml(d: CVData): string {
  const bn = d.cvLang === "bn";
  const head = (k: keyof typeof HEAD) => HEAD[k][bn ? 0 : 1];
  const name = d.name.trim() || (bn ? "আপনার নাম" : "Your name");
  const contact = [d.phone, d.email, d.address].map((s) => s.trim()).filter(Boolean);
  const skills = d.skills.split(/[,·|]/).map((s) => s.trim()).filter(Boolean);
  const edu = d.education.filter((e) => e.degree.trim() || e.org.trim());
  const exp = d.experience.filter((e) => e.role.trim() || e.org.trim() || e.detail.trim());

  const section = (title: string, body: string) =>
    `<h2 style="margin:22px 0 10px;font-size:15px;font-weight:700;letter-spacing:.02em;color:#065f46;border-bottom:1.5px solid rgba(5,150,105,.28);padding-bottom:5px">${title}</h2>${body}`;

  // ── header variants ──
  let header = "";
  let layoutOpen = "";
  let layoutClose = "";
  let sidebar = "";
  let sectionFn = section;

  if (d.tpl === "classic") {
    header = `<div style="text-align:center">
      <div style="font-size:30px;font-weight:700;color:#064e3b;line-height:1.3">${name}</div>
      ${d.jobTitle.trim() ? `<div style="margin-top:2px;font-size:15px;font-weight:600;color:${EMERALD}">${d.jobTitle}</div>` : ""}
      ${contact.length ? `<div style="margin-top:6px;font-size:12.5px;color:${MUTED}">${contact.join(" · ")}</div>` : ""}
      <div style="height:3px;width:130px;margin:14px auto 0;background:linear-gradient(90deg,#10b981,#0d9488);border-radius:2px"></div>
    </div>`;
  } else if (d.tpl === "sidebar") {
    header = `<div style="background:linear-gradient(135deg,#059669,#0d9488);border-radius:12px;padding:20px 22px;color:#ffffff">
      <div style="font-size:26px;font-weight:700;line-height:1.3">${name}</div>
      ${d.jobTitle.trim() ? `<div style="margin-top:2px;font-size:14px;opacity:.92">${d.jobTitle}</div>` : ""}
      ${contact.length ? `<div style="margin-top:8px;font-size:12px;opacity:.9">${contact.join(" · ")}</div>` : ""}
    </div>`;
    layoutOpen = `<div style="display:flex;gap:22px;margin-top:6px"><div style="flex:2.1;min-width:0">`;
    layoutClose = `</div><div style="flex:1;min-width:0;background:rgba(16,185,129,.07);border-radius:10px;padding:14px 16px;height:fit-content">
      ${contact.length ? `<div style="font-weight:700;color:#065f46;font-size:13.5px;margin-bottom:6px">${head("contact")}</div><div style="font-size:12.5px;color:${INK};line-height:1.8;margin-bottom:14px">${contact.map((c) => `<div>${c}</div>`).join("")}</div>` : ""}
      ${skills.length ? `<div style="font-weight:700;color:#065f46;font-size:13.5px;margin-bottom:6px">${head("skills")}</div><div style="font-size:12.5px;color:${INK};line-height:1.9">${skills.map((s) => `<div>• ${s}</div>`).join("")}</div>` : ""}
    </div></div>`;
    sidebar = "";
  } else {
    // minimal
    header = `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;border-bottom:2px solid ${INK};padding-bottom:10px">
      <div>
        <div style="font-size:26px;font-weight:700;color:${INK};line-height:1.3">${name}</div>
        ${d.jobTitle.trim() ? `<div style="margin-top:2px;font-size:14px;color:${MUTED}">${d.jobTitle}</div>` : ""}
      </div>
      ${contact.length ? `<div style="text-align:right;font-size:12px;color:${MUTED};line-height:1.7">${contact.map((c) => `<div>${c}</div>`).join("")}</div>` : ""}
    </div>`;
    sectionFn = (title, body) =>
      `<h2 style="margin:20px 0 8px;font-size:12.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${EMERALD}">${title}</h2><div style="border-top:1px solid rgba(31,41,55,.12)">${body}</div>`;
  }

  const parts: string[] = [];
  if (d.summary.trim())
    parts.push(
      sectionFn(head("summary"), `<p style="margin:8px 0 0;color:${INK};line-height:1.8">${d.summary}</p>`)
    );
  if (exp.length)
    parts.push(
      sectionFn(
        head("experience"),
        exp
          .map(
            (e) =>
              row(e.role, e.org, e.period) +
              (e.detail.trim() ? `<div style="color:${MUTED};font-size:13px;line-height:1.7;margin:-2px 0 10px">${e.detail}</div>` : "")
          )
          .join("")
      )
    );
  if (edu.length)
    parts.push(
      sectionFn(head("education"), edu.map((e) => row(e.degree, e.org, e.year)).join(""))
    );
  if (skills.length && d.tpl !== "sidebar")
    parts.push(
      sectionFn(
        head("skills"),
        `<div style="margin-top:8px">${skills
          .map(
            (s) =>
              `<span style="display:inline-block;margin:0 6px 6px 0;padding:3px 10px;border:1px solid rgba(5,150,105,.35);border-radius:999px;font-size:12.5px;color:#047857">${s}</span>`
          )
          .join("")}</div>`
      )
    );

  return `${header}${d.tpl === "sidebar" ? layoutOpen : ""}${parts.join("")}${layoutClose}${sidebar}`;
}

export function CvBuilder() {
  const { t, lang } = useT();
  const goHome = useAppStore((s) => s.goHome);

  const [data, setData] = useState<CVData>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [savedTick, setSavedTick] = useState(false);
  const [mobileTab, setMobileTab] = useState<"info" | "preview">("info");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // hydrate the draft once
  useEffect(() => {
    setData(loadDraft());
  }, []);

  // debounced draft save (Day 23-style resilience, shipped early)
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(data));
        setSavedTick(true);
        setTimeout(() => setSavedTick(false), 1600);
      } catch {
        /* private mode */
      }
    }, 900);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [data]);

  const set = useCallback(<K extends keyof CVData>(k: K, v: CVData[K]) => {
    setData((d) => ({ ...d, [k]: v }));
  }, []);

  const exportPdf = async () => {
    setBusy(true);
    setPct(5);
    try {
      const { htmlToPdfBlob } = await import("@/lib/tools/processors/docs");
      const blob = await htmlToPdfBlob(buildCvHtml(data), (p) => setPct(Math.max(pct, p)));
      downloadBlob(blob, `${data.name.trim() || "cv"}.pdf`);
      toast.success(t("cvPdfDone"));
    } catch {
      toast.error(t("genericErr"));
    } finally {
      setBusy(false);
      setPct(0);
    }
  };

  const resetAll = () => {
    if (!window.confirm(`${t("cvResetConfirm")} / Reset?`)) return;
    setData(EMPTY);
    try {
      window.localStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
  };

  const field = (
    key: keyof CVData,
    labelKey: Parameters<typeof t>[0],
    placeholder?: string,
    type = "text"
  ) => (
    <div>
      <Label htmlFor={`cv-${key}`} className="text-xs font-semibold text-emerald-950/80">
        {t(labelKey)}
      </Label>
      <Input
        id={`cv-${key}`}
        type={type}
        value={String(data[key] ?? "")}
        onChange={(e) => set(key, e.target.value as CVData[typeof key])}
        placeholder={placeholder}
        className="mt-1 h-10 border-emerald-900/10 focus-visible:ring-emerald-500/50"
      />
    </div>
  );

  const html = buildCvHtml(data);

  return (
    <div className="mx-auto w-full max-w-7xl px-3 pb-10 pt-4 sm:px-6">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={goHome} aria-label={t("backHomeAria")} className="h-11 w-11 rounded-xl">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 text-white shadow-lg shadow-orange-500/30">
          <FileUser className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-emerald-950 sm:text-xl">{t("cvBuilder")}</h1>
          <p className="truncate text-xs text-emerald-900/55">{t("cvSub")}</p>
        </div>
        <span className="hidden items-center gap-1.5 text-xs text-emerald-900/50 md:inline-flex">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          {t("bsPrivacy")}
        </span>
        <span
          aria-live="polite"
          className={`inline-flex items-center gap-1 text-xs text-emerald-600 transition-opacity ${savedTick ? "opacity-100" : "opacity-0"}`}
        >
          <Check className="h-3.5 w-3.5" />
          {t("cvDraftSaved")}
        </span>
      </div>

      {/* toolbar */}
      <div className="fm-card sticky top-16 z-20 mb-4 flex flex-wrap items-center gap-2 rounded-2xl p-2.5">
        {/* template switcher */}
        <div className="flex items-center gap-1 rounded-xl bg-emerald-50 p-1" role="radiogroup" aria-label={t("cvTemplate")}>
          {(["classic", "sidebar", "minimal"] as Tpl[]).map((tp) => (
            <button
              key={tp}
              type="button"
              role="radio"
              aria-checked={data.tpl === tp}
              onClick={() => set("tpl", tp)}
              className={`min-h-9 rounded-lg px-3 text-xs font-semibold transition-all ${
                data.tpl === tp
                  ? "bg-white text-emerald-700 shadow-sm"
                  : "text-emerald-900/60 hover:text-emerald-800"
              }`}
            >
              {t(tp === "classic" ? "cvClassic" : tp === "sidebar" ? "cvSidebar" : "cvMinimal")}
            </button>
          ))}
        </div>

        {/* CV language */}
        <div className="flex items-center gap-1 rounded-xl bg-emerald-50 p-1" role="radiogroup" aria-label={t("cvCvLang")}>
          <Languages className="ml-1.5 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
          {(["bn", "en"] as Lang[]).map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={data.cvLang === l}
              onClick={() => set("cvLang", l)}
              className={`min-h-9 rounded-lg px-2.5 text-xs font-semibold transition-all ${
                data.cvLang === l ? "bg-white text-emerald-700 shadow-sm" : "text-emerald-900/60 hover:text-emerald-800"
              }`}
            >
              {l === "bn" ? "বাংলা" : "English"}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            onClick={resetAll}
            className="h-10 border-emerald-900/10 text-emerald-900/70 hover:bg-emerald-50 hover:text-emerald-900"
          >
            <RotateCcw className="h-4 w-4" />
            {t("cvReset")}
          </Button>
          <Button
            onClick={() => void exportPdf()}
            disabled={busy}
            className="h-10 bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold text-white shadow-md shadow-emerald-500/25 hover:from-emerald-600 hover:to-teal-700"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {busy ? `${pct}%` : t("cvPdf")}
          </Button>
        </div>
      </div>

      {/* mobile view switcher */}
      <div className="mb-3 grid grid-cols-2 gap-2 lg:hidden" role="radiogroup" aria-label={t("cvPreview")}>
        {(["info", "preview"] as const).map((mt) => (
          <button
            key={mt}
            type="button"
            role="radio"
            aria-checked={mobileTab === mt}
            onClick={() => setMobileTab(mt)}
            className={`min-h-11 rounded-xl border text-sm font-semibold transition-all ${
              mobileTab === mt
                ? "border-emerald-500 bg-emerald-500/10 text-emerald-700"
                : "border-emerald-900/10 bg-white text-emerald-900/60"
            }`}
          >
            {mt === "info" ? t("cvInfo") : t("cvPreview")}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,600px)]">
        {/* ── form ── */}
        <div className={`fm-card rounded-2xl p-4 sm:p-5 ${mobileTab === "info" ? "" : "hidden lg:block"}`}>
          <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-800/70">{t("cvPersonal")}</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {field("name", "cvName", t("cvEmptyName"))}
            {field("jobTitle", "cvTitle", t("cvTitlePh"))}
            {field("phone", "cvPhone", "01XXXXXXXXX", "tel")}
            {field("email", "cvEmail", "you@example.com", "email")}
            <div className="sm:col-span-2">{field("address", "cvAddress", t("cvAddressPh"))}</div>
            <div className="sm:col-span-2">
              <Label htmlFor="cv-summary" className="text-xs font-semibold text-emerald-950/80">
                {t("cvSummary")}
              </Label>
              <Textarea
                id="cv-summary"
                rows={3}
                value={data.summary}
                onChange={(e) => set("summary", e.target.value)}
                placeholder={t("cvSummaryPh")}
                className="mt-1 resize-none border-emerald-900/10 focus-visible:ring-emerald-500/50"
              />
            </div>
          </div>

          {/* education */}
          <div className="mt-6 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-800/70">{t("cvEdu")}</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => set("education", [...data.education, { degree: "", org: "", year: "" }])}
              className="h-9 gap-1 text-emerald-600 hover:bg-emerald-600/10 hover:text-emerald-700"
            >
              <Plus className="h-4 w-4" />
              {t("cvAddEdu")}
            </Button>
          </div>
          <div className="mt-2 space-y-3">
            {data.education.map((edu, i) => (
              <div key={i} className="rounded-xl border border-emerald-900/[0.07] bg-white p-3">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_1fr_100px]">
                  <Input
                    aria-label={t("cvEduDegree")}
                    value={edu.degree}
                    onChange={(e) =>
                      set(
                        "education",
                        data.education.map((x, j) => (j === i ? { ...x, degree: e.target.value } : x))
                      )
                    }
                    placeholder={t("cvEduDegree")}
                    className="h-10 border-emerald-900/10"
                  />
                  <Input
                    aria-label={t("cvEduOrg")}
                    value={edu.org}
                    onChange={(e) =>
                      set(
                        "education",
                        data.education.map((x, j) => (j === i ? { ...x, org: e.target.value } : x))
                      )
                    }
                    placeholder={t("cvEduOrg")}
                    className="h-10 border-emerald-900/10"
                  />
                  <div className="flex gap-2">
                    <Input
                      aria-label={t("cvEduYear")}
                      value={edu.year}
                      onChange={(e) =>
                        set(
                          "education",
                          data.education.map((x, j) => (j === i ? { ...x, year: e.target.value } : x))
                        )
                      }
                      placeholder={t("cvEduYear")}
                      className="h-10 border-emerald-900/10"
                    />
                    {data.education.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${t("cvRemove")} ${i + 1}`}
                        onClick={() => set("education", data.education.filter((_, j) => j !== i))}
                        className="h-10 w-10 shrink-0 text-emerald-900/40 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* experience */}
          <div className="mt-6 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-800/70">{t("cvExp")}</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => set("experience", [...data.experience, { role: "", org: "", period: "", detail: "" }])}
              className="h-9 gap-1 text-emerald-600 hover:bg-emerald-600/10 hover:text-emerald-700"
            >
              <Plus className="h-4 w-4" />
              {t("cvAddExp")}
            </Button>
          </div>
          <div className="mt-2 space-y-3">
            {data.experience.map((exp, i) => (
              <div key={i} className="rounded-xl border border-emerald-900/[0.07] bg-white p-3">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_1fr_130px_auto]">
                  <Input
                    aria-label={t("cvExpRole")}
                    value={exp.role}
                    onChange={(e) =>
                      set(
                        "experience",
                        data.experience.map((x, j) => (j === i ? { ...x, role: e.target.value } : x))
                      )
                    }
                    placeholder={t("cvExpRole")}
                    className="h-10 border-emerald-900/10"
                  />
                  <Input
                    aria-label={t("cvExpOrg")}
                    value={exp.org}
                    onChange={(e) =>
                      set(
                        "experience",
                        data.experience.map((x, j) => (j === i ? { ...x, org: e.target.value } : x))
                      )
                    }
                    placeholder={t("cvExpOrg")}
                    className="h-10 border-emerald-900/10"
                  />
                  <Input
                    aria-label={t("cvExpPeriod")}
                    value={exp.period}
                    onChange={(e) =>
                      set(
                        "experience",
                        data.experience.map((x, j) => (j === i ? { ...x, period: e.target.value } : x))
                      )
                    }
                    placeholder="২০২৪–বর্তমান"
                    className="h-10 border-emerald-900/10"
                  />
                  {data.experience.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${t("cvRemove")} ${i + 1}`}
                      onClick={() => set("experience", data.experience.filter((_, j) => j !== i))}
                      className="h-10 w-10 text-emerald-900/40 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <Textarea
                  aria-label={t("cvExpDetail")}
                  rows={2}
                  value={exp.detail}
                  onChange={(e) =>
                    set(
                      "experience",
                      data.experience.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x))
                    )
                  }
                  placeholder={t("cvExpDetail")}
                  className="mt-2.5 resize-none border-emerald-900/10"
                />
              </div>
            ))}
          </div>

          {/* skills */}
          <div className="mt-6">
            <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-800/70">{t("cvSkills")}</h2>
            <Input
              id="cv-skills"
              value={data.skills}
              onChange={(e) => set("skills", e.target.value)}
              placeholder={t("cvSkillsPh")}
              className="mt-2 h-10 border-emerald-900/10 focus-visible:ring-emerald-500/50"
            />
          </div>
        </div>

        {/* ── live preview (same HTML that becomes the PDF) ── */}
        <div className={`${mobileTab === "preview" ? "" : "hidden lg:block"}`}>
          <div className="fm-card rounded-2xl p-3">
            <div className="fm-scroll overflow-auto" style={{ maxHeight: "72vh" }}>
              <div
                ref={previewRef}
                aria-label={t("cvPreview")}
                // 794px = the exact width htmlToPdfBlob renders at — WYSIWYG
                style={{
                  width: 794,
                  padding: 48,
                  background: "#ffffff",
                  color: INK,
                  fontFamily: "var(--font-bengali),'Hind Siliguri','Noto Sans Bengali',system-ui,sans-serif",
                  fontSize: 15,
                  lineHeight: 1.75,
                  margin: "0 auto",
                }}
              >
                <div dangerouslySetInnerHTML={{ __html: html }} />
              </div>
            </div>
          </div>
          <p className="mt-2 text-center text-xs text-emerald-900/45">{t("cvPreviewHint")}</p>
        </div>
      </div>
    </div>
  );
}
