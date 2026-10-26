"use client";

import { motion, AnimatePresence } from "framer-motion";

import { useAppStore } from "@/store/app-store";
import { Background } from "@/components/file-hub/background";
import { Sidebar } from "@/components/file-hub/sidebar";
import { Navbar } from "@/components/file-hub/navbar";
import { Hero } from "@/components/file-hub/hero";
import { RecentTools } from "@/components/file-hub/recent-tools";
import { EditorSpotlight } from "@/components/file-hub/editor-spotlight";
import { FeaturedTools } from "@/components/file-hub/featured-tools";
import { CategoryTabs } from "@/components/file-hub/category-tabs";
import { ToolGrid } from "@/components/file-hub/tool-grid";
import { Features } from "@/components/file-hub/features";
import { Workspace } from "@/components/file-hub/workspace";
import { PdfEditor } from "@/components/file-hub/pdf-editor";
import { PageManager } from "@/components/file-hub/page-manager";
import { ImageEditor } from "@/components/file-hub/image-editor";
import { SheetEditor } from "@/components/file-hub/sheet-editor";
import { MarkdownEditor } from "@/components/file-hub/markdown-editor";
import { AudioEditor } from "@/components/file-hub/audio-editor";
import { ScanEditor } from "@/components/file-hub/scan-editor";
import { OcrStudio } from "@/components/file-hub/ocr-studio";
import { BatchStudio } from "@/components/file-hub/batch-studio";
import { CompressionStudio } from "@/components/file-hub/compression-studio";
import { WordEditor } from "@/components/file-hub/word-editor";
import { ShortcutLayer } from "@/components/file-hub/shortcut-layer";
import { OnboardingTour } from "@/components/file-hub/onboarding-tour";
import { Footer } from "@/components/file-hub/footer";
import { HistorySync } from "@/components/file-hub/history-sync";

/** editor tool id → its full-screen component */
const EDITOR_VIEWS: Record<string, React.ComponentType> = {
  "pdf-editor": PdfEditor,
  "page-manager": PageManager,
  "image-editor": ImageEditor,
  "sheet-editor": SheetEditor,
  "markdown-editor": MarkdownEditor,
  "audio-editor": AudioEditor,
  "document-scan": ScanEditor,
  "ocr-studio": OcrStudio,
  "batch-studio": BatchStudio,
  "compression-studio": CompressionStudio,
  "word-editor": WordEditor,
};

export default function Home() {
  const view = useAppStore((s) => s.view);
  const activeToolId = useAppStore((s) => s.activeToolId);
  const EditorView = activeToolId ? EDITOR_VIEWS[activeToolId] : undefined;

  return (
    <div className="relative flex min-h-screen bg-background text-foreground">
      <Background />
      <HistorySync />
      {/* a11y: keyboard users jump straight to the content (Day 8) */}
      <a
        href="#fm-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-emerald-600 focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-white focus:shadow-xl"
      >
        মূল কন্টেন্টে যান / Skip to content
      </a>
      <ShortcutLayer />
      <OnboardingTour />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Navbar />
        <main id="fm-main" className="flex-1">
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
                <EditorSpotlight />
                <FeaturedTools />
                <CategoryTabs />
                <ToolGrid />
                <Features />
              </motion.div>
            ) : view === "editor" && EditorView ? (
              <motion.div
                key="editor"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <EditorView />
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
