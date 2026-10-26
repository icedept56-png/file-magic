import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ফাইল ম্যাজিক — সব ফাইলের এক ঠিকানা",
    short_name: "ফাইল ম্যাজিক",
    description:
      "PDF, Word, Excel, ছবি, ZIP — সব ধরনের ফাইল কনভার্ট, এডিট, কম্প্রেস ও ম্যানেজ করুন এক জায়গায়।",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f2f9f5",
    theme_color: "#059669",
    lang: "bn",
    categories: ["productivity", "utilities"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "পিডিএফ মার্জ",
        short_name: "মার্জ",
        url: "/?tool=merge-pdf",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "ইমেজ কনভার্টার",
        short_name: "কনভার্ট",
        url: "/?tool=image-convert",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "QR কোড বানান",
        short_name: "QR",
        url: "/?tool=qr-generator",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "টেক্সট → পিডিএফ",
        short_name: "টেক্সট",
        url: "/?tool=text-to-pdf",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
