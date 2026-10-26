"use client";

import { useEffect, useState } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  Copy,
  HelpCircle,
  LifeBuoy,
  Mail,
  Send,
} from "lucide-react";
import { toast } from "sonner";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { haptic } from "@/lib/haptics";
import { useT, type StrKey } from "@/lib/i18n";

/** ⚠️ owner: replace with the real inbox before launch */
export const FM_SUPPORT_EMAIL = "support@filemagic.app";

const HELP_EVENT = "fm-open-help";

/** open the help center from anywhere (navbar, footer, FAQ deep-links…) */
export function openHelpCenter(tab: "faq" | "feedback" = "faq") {
  window.dispatchEvent(new CustomEvent(HELP_EVENT, { detail: tab }));
}

const FAQ_Q: StrKey[] = ["hcQ1", "hcQ2", "hcQ3", "hcQ4", "hcQ5", "hcQ6", "hcQ7", "hcQ8"];
const FAQ_A: StrKey[] = ["hcA1", "hcA2", "hcA3", "hcA4", "hcA5", "hcA6", "hcA7", "hcA8"];

const RATINGS: { id: string; key: StrKey; icon: string }[] = [
  { id: "great", key: "fbGreat", icon: "😍" },
  { id: "good", key: "fbGood", icon: "🙂" },
  { id: "needs", key: "fbNeeds", icon: "🙁" },
];
const TOPICS: { id: string; key: StrKey }[] = [
  { id: "bug", key: "fbBug" },
  { id: "feature", key: "fbFeature" },
  { id: "translation", key: "fbTranslation" },
  { id: "other", key: "fbOther" },
];

interface FeedbackEntry {
  at: number;
  rating: string;
  topic: string;
  message: string;
}

function saveFeedback(entry: FeedbackEntry) {
  try {
    const raw = window.localStorage.getItem("fm-feedback-list");
    const list = raw ? (JSON.parse(raw) as FeedbackEntry[]) : [];
    list.unshift(entry);
    window.localStorage.setItem("fm-feedback-list", JSON.stringify(list.slice(0, 20)));
  } catch {
    /* private mode — the thanks screen still shows */
  }
}

function composeText(e: FeedbackEntry): string {
  return [
    "[ফাইল ম্যাজিক — মতামত / File Magic feedback]",
    `রেটিং/Rating: ${e.rating}`,
    `বিষয়/Topic: ${e.topic}`,
    `সময়/At: ${new Date(e.at).toISOString()}`,
    "",
    e.message,
  ].join("\n");
}

/** সহায়তা কেন্দ্র + ফিডব্যাক উইজেট (Day 16 — 60-day roadmap) */
export function HelpCenter() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"faq" | "feedback">("faq");

  // feedback form state
  const [rating, setRating] = useState<string | null>(null);
  const [topic, setTopic] = useState("bug");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState<FeedbackEntry | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail as string | undefined;
      setTab(detail === "feedback" ? "feedback" : "faq");
      setOpen(true);
    };
    window.addEventListener(HELP_EVENT, onOpen);
    return () => window.removeEventListener(HELP_EVENT, onOpen);
  }, []);

  const resetForm = () => {
    setRating(null);
    setTopic("bug");
    setMessage("");
    setSent(null);
  };

  const submit = () => {
    if (!rating) {
      toast.error(t("fbPickRating"));
      return;
    }
    haptic("success");
    const entry: FeedbackEntry = {
      at: Date.now(),
      rating,
      topic,
      message: message.trim().slice(0, 2000),
    };
    saveFeedback(entry);
    setSent(entry);
  };

  const copyReport = async (entry: FeedbackEntry) => {
    try {
      await navigator.clipboard.writeText(composeText(entry));
      haptic("light");
      toast.success(t("fbCopied"));
    } catch {
      toast.error(t("fbCopyFail"));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setSent(null);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl bg-white sm:max-w-lg" role="dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-950">
            <LifeBuoy className="h-5 w-5 text-emerald-600" />
            {t("hcTitle")}
          </DialogTitle>
          <DialogDescription>{t("hcSub")}</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "faq" | "feedback")}>
          <TabsList className="grid w-full grid-cols-2 rounded-xl bg-emerald-50">
            <TabsTrigger value="faq" className="rounded-lg data-[state=active]:text-emerald-700">
              {t("tabFaq")}
            </TabsTrigger>
            <TabsTrigger value="feedback" className="rounded-lg data-[state=active]:text-emerald-700">
              {t("tabFeedback")}
            </TabsTrigger>
          </TabsList>

          {/* ── FAQ ─────────────────────────────────────────── */}
          <TabsContent value="faq" className="mt-2">
            <Accordion type="single" collapsible className="w-full">
              {FAQ_Q.map((qk, i) => (
                <AccordionItem key={qk} value={qk} className="border-emerald-900/[0.08]">
                  <AccordionTrigger className="py-3 text-left text-sm font-semibold text-emerald-950/90 hover:no-underline hover:text-emerald-800">
                    {t(qk)}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm leading-relaxed text-emerald-900/70">
                    {t(FAQ_A[i])}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>

            <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50/70 p-3">
              <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-600" />
              <p className="flex-1 text-sm text-emerald-900/75">{t("hcMore")}</p>
              <Button
                size="sm"
                onClick={() => setTab("feedback")}
                className="h-9 shrink-0 bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700"
              >
                {t("hcMoreBtn")}
              </Button>
            </div>
          </TabsContent>

          {/* ── ফিডব্যাক ─────────────────────────────────────── */}
          <TabsContent value="feedback" className="mt-2">
            {sent ? (
              <div className="py-6 text-center">
                <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
                <p className="mt-3 text-base font-bold text-emerald-950">{t("fbThanks")}</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-emerald-900/65">{t("fbThanksBody")}</p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => void copyReport(sent)}
                    className="h-11 border-emerald-600/25 text-emerald-800 hover:bg-emerald-50"
                  >
                    <Copy className="h-4 w-4" />
                    {t("fbCopy")}
                  </Button>
                  <Button
                    variant="outline"
                    asChild
                    className="h-11 border-emerald-600/25 text-emerald-800 hover:bg-emerald-50"
                  >
                    <a
                      href={`mailto:${FM_SUPPORT_EMAIL}?subject=${encodeURIComponent(
                        "ফাইল ম্যাজিক মতামত / File Magic feedback"
                      )}&body=${encodeURIComponent(composeText(sent))}`}
                    >
                      <Mail className="h-4 w-4" />
                      {t("fbMail")}
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={resetForm}
                    className="h-11 text-emerald-700 hover:bg-emerald-600/10"
                  >
                    {t("fbAnother")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-semibold text-emerald-950/85">{t("fbRate")}</p>
                  <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("fbRate")}>
                    {RATINGS.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        role="radio"
                        aria-checked={rating === r.id}
                        onClick={() => setRating(r.id)}
                        className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl border py-2 text-xs font-medium transition-all ${
                          rating === r.id
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm"
                            : "border-emerald-900/10 bg-white text-emerald-900/70 hover:border-emerald-500/40 hover:bg-emerald-50/50"
                        }`}
                      >
                        <span aria-hidden="true" className="text-lg leading-none">
                          {r.icon}
                        </span>
                        {t(r.key)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-sm font-semibold text-emerald-950/85">{t("fbTopic")}</p>
                  <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={t("fbTopic")}>
                    {TOPICS.map((tp) => (
                      <button
                        key={tp.id}
                        type="button"
                        role="radio"
                        aria-checked={topic === tp.id}
                        onClick={() => setTopic(tp.id)}
                        className={`min-h-9 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all ${
                          topic === tp.id
                            ? "border-emerald-500 bg-emerald-500/10 text-emerald-700"
                            : "border-emerald-900/10 bg-white text-emerald-900/65 hover:border-emerald-500/40"
                        }`}
                      >
                        {t(tp.key)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label htmlFor="fm-fb-msg" className="text-sm font-semibold text-emerald-950/85">
                    {t("fbMsg")}
                  </label>
                  <Textarea
                    id="fm-fb-msg"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    maxLength={2000}
                    rows={4}
                    placeholder={t("fbMsgPh")}
                    className="mt-1.5 resize-none border-emerald-900/10 focus-visible:ring-emerald-500/50"
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <p className="flex items-center gap-1.5 text-[11px] leading-tight text-emerald-900/50">
                    <HelpCircle className="h-3.5 w-3.5 shrink-0" />
                    {t("fbPrivacy")}
                  </p>
                  <Button
                    onClick={submit}
                    disabled={!rating}
                    className="h-11 shrink-0 bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold text-white shadow-md shadow-emerald-500/25 hover:from-emerald-600 hover:to-teal-700"
                  >
                    <Send className="h-4 w-4" />
                    {t("fbSend")}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/** navbar entry */
export function HelpButton() {
  const { t } = useT();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => openHelpCenter("faq")}
      aria-label={t("hcTitle")}
      title={t("hcTitle")}
      className="h-10 w-10 rounded-xl text-emerald-900/70 hover:bg-emerald-600/10 hover:text-emerald-900"
    >
      <LifeBuoy className="h-4 w-4" />
    </Button>
  );
}
