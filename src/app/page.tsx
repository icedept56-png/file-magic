"use client";

import { motion, AnimatePresence } from "framer-motion";

import { useAppStore } from "@/store/app-store";
import { Background } from "@/components/file-hub/background";
import { Sidebar } from "@/components/file-hub/sidebar";
import { Navbar } from "@/components/file-hub/navbar";
import { Hero } from "@/components/file-hub/hero";
import { RecentTools } from "@/components/file-hub/recent-tools";
import { FeaturedTools } from "@/components/file-hub/featured-tools";
import { CategoryTabs } from "@/components/file-hub/category-tabs";
import { ToolGrid } from "@/components/file-hub/tool-grid";
import { Features } from "@/components/file-hub/features";
import { Workspace } from "@/components/file-hub/workspace";
import { Footer } from "@/components/file-hub/footer";
import { HistorySync } from "@/components/file-hub/history-sync";

export default function Home() {
  const view = useAppStore((s) => s.view);

  return (
    <div className="relative flex min-h-screen bg-background text-foreground">
      <Background />
      <HistorySync />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Navbar />
        <main className="flex-1">
          <AnimatePresence mode="wait">
            {view === "home" ? (
              <motion.div
                key="home"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="pb-4"
              >
                <Hero />
                <RecentTools />
                <FeaturedTools />
                <CategoryTabs />
                <ToolGrid />
                <Features />
              </motion.div>
            ) : (
              <motion.div
                key="tool"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <Workspace />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
        <Footer />
      </div>
    </div>
  );
}
