"use client";

import { motion } from "framer-motion";
import { ShieldCheck, Sparkles, WifiOff, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: ShieldCheck,
    title: "সম্পূর্ণ প্রাইভেট",
    desc: "ফাইল কখনো সার্ভারে যায় না। সব প্রসেসিং হয় আপনার ব্রাউজারের ভেতরেই — কোনো আপলোড নেই।",
  },
  {
    icon: Zap,
    title: "বজ্রের গতি",
    desc: "আপলোড-ডাউনলোডের লাইনে দাঁড়াতে হবে না। ফাইল দিন, সাথে সাথেই রেজাল্ট নিন।",
  },
  {
    icon: WifiOff,
    title: "অফলাইনেও চলে",
    desc: "একবার ইনস্টল করে নিলে ইন্টারনেট ছাড়াও বেশিরভাগ টুল কাজ করবে।",
  },
  {
    icon: Sparkles,
    title: "সব এক জায়গায়",
    desc: "পিডিএফ, ছবি, ওয়ার্ড, এক্সেল, ZIP — দশটা অ্যাপের কাজ এক জায়গাতেই।",
  },
];

export function Features() {
  return (
    <section className="mb-16 mt-20">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.3 }}
        >
          <h2 className="text-center text-2xl font-bold sm:text-3xl">
            <span className="text-zinc-50">কেন </span>
            <span className="bg-gradient-to-r from-fuchsia-400 via-violet-400 to-orange-300 bg-clip-text text-transparent">
              ফাইল ম্যাজিক
            </span>
            <span className="text-zinc-50">?</span>
          </h2>
          <p className="mt-2 text-center text-zinc-400">
            নিরাপদ, দ্রুত আর ঝামেলাহীন — কারণ সবকিছু হয় আপনার নিজের ডিভাইসে।
          </p>
        </motion.div>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, desc }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.3, delay: Math.min(i * 0.06, 0.24) }}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6 backdrop-blur-sm transition-colors hover:border-white/[0.16] hover:bg-white/[0.06]"
            >
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-gradient-to-br from-fuchsia-500/80 to-violet-600/80">
                <Icon className="h-5 w-5 text-white" />
              </span>
              <h3 className="mt-4 font-semibold text-zinc-100">{title}</h3>
              <p className="mt-2 text-sm text-zinc-400">{desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
