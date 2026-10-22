"use client";

import type { CSSProperties } from "react";

import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { CATEGORIES } from "@/lib/tools/registry";
import type { ToolDef } from "@/lib/tools/types";
import { useAppStore } from "@/store/app-store";

interface ToolCardProps {
  tool: ToolDef;
}

export function ToolCard({ tool }: ToolCardProps) {
  const openTool = useAppStore((s) => s.openTool);
  const categoryLabel =
    CATEGORIES.find((c) => c.id === tool.category)?.label ?? tool.category;

  return (
    <motion.button
      type="button"
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => openTool(tool.id)}
      aria-label={`${tool.name} — ${tool.desc}`}
      style={{ "--glow": tool.glow } as CSSProperties}
      className="group relative flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-5 text-left backdrop-blur-sm transition-colors hover:border-white/[0.16] hover:bg-white/[0.06] hover:shadow-[0_20px_50px_-20px_var(--glow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500/60"
    >
      {/* icon + hover arrow */}
      <div className="flex items-start">
        <span
          className={`grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br ${tool.gradient} shadow-lg`}
          style={{ boxShadow: `0 8px 24px -8px ${tool.glow}` }}
        >
          <tool.icon className="h-6 w-6 text-white" />
        </span>
        <ArrowUpRight className="ml-auto h-4 w-4 text-zinc-600 opacity-0 transition group-hover:opacity-100" />
      </div>

      <div>
        <h3 className="font-semibold text-zinc-100">{tool.name}</h3>
        <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{tool.desc}</p>
      </div>

      {/* footer badges */}
      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        <Badge
          variant="outline"
          className="border-white/10 text-[11px] text-zinc-500"
        >
          {categoryLabel}
        </Badge>
        {tool.inputMode !== "file" && (
          <Badge
            variant="outline"
            className="border-white/10 text-[11px] text-zinc-500"
          >
            টেক্সট ইনপুট
          </Badge>
        )}
      </div>
    </motion.button>
  );
}
