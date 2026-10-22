import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ফাইল ম্যাজিক — সব ফাইলের সম্পূর্ণ সমাধান",
    short_name: "ফাইল ম্যাজিক",
    description:
      "PDF, Word, Excel, ছবি, ZIP — সব ধরনের ফাইল কনভার্ট, এডিট, কম্প্রেস ও ম্যানেজ করুন এক জায়গায়।",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#07070d",
    theme_color: "#07070d",
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
  };
}
