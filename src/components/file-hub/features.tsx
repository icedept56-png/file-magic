"use client";

import { motion } from "framer-motion";
import { ShieldCheck, Sparkles, WifiOff, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useT } from "@/lib/i18n";

/** per-feature gradient tile (variety is eye-catching but stays on-palette) */
const FEATURE_TILE = [
  "bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/30",
  "bg-gradient-to-br from-orange-500 to-amber-600 shadow-orange-500/30",
  "bg-gradient-to-br from-rose-500 to-red-600 shadow-rose-500/30",
  "bg-gradient-to-br from-fuchsia-500 to-purple-600 shadow-fuchsia-500/30",
];

export function Features() {
  const { t } = useT();

  const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
    { icon: ShieldCheck, title: t("featPrivateTitle"), desc: t("featPrivateDesc") },
    { icon: Zap, title: t("featSpeedTitle"), desc: t("featSpeedDesc") },
    { icon: WifiOff, title: t("featOfflineTitle"), desc: t("featOfflineDesc") },
    { icon: Sparkles, title: t("featAllTitle"), desc: t("featAllDesc") },
  ];

  return (
    <section className="mb-14 mt-16">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.3 }}
        >
          <h2 className="text-center text-2xl font-bold sm:text-3xl text-emerald-950">
            {t("featTitle1")}
            <span className="bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-600 bg-clip-text text-transparent">
              {t("brandName")}
            </span>
            {t("featTitle2")}
          </h2>
          <p className="mt-2 text-center text-emerald-900/60">
            {t("featSub")}
          </p>
        </motion.div>

        <div className="mt-9 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, desc }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.3, delay: Math.min(i * 0.06, 0.24) }}
              whileHover={{ y: -4 }}
              className="fm-card fm-card-hover rounded-2xl p-6 transition-all"
            >
              <span
                className={`grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br shadow-md ${FEATURE_TILE[i % FEATURE_TILE.length]}`}
              >
                <Icon className="h-5 w-5 text-white" />
              </span>
              <h3 className="mt-4 font-bold text-emerald-950">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-emerald-900/60">{desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
