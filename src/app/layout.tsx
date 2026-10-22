import type { Metadata, Viewport } from "next";
import { Hind_Siliguri, Outfit } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { RegisterSW } from "@/components/file-hub/register-sw";

const bengali = Hind_Siliguri({
  variable: "--font-bengali",
  subsets: ["bengali", "latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const latin = Outfit({
  variable: "--font-latin",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "ফাইল ম্যাজিক — সব ফাইলের সম্পূর্ণ সমাধান",
  description:
    "PDF, Word, Excel, ছবি, ZIP — সব ধরনের ফাইল কনভার্ট, এডিট, কম্প্রেস ও ম্যানেজ করুন এক জায়গায়। সম্পূর্ণ ফ্রি, সব প্রসেসিং আপনার ব্রাউজারেই — কোনো ফাইল সার্ভারে যায় না।",
  keywords: [
    "ফাইল কনভার্টার",
    "pdf to word",
    "image converter",
    "file converter",
    "pdf tools",
    "compress pdf",
    "file magic",
  ],
  applicationName: "ফাইল ম্যাজিক",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "ফাইল ম্যাজিক — সব ফাইলের সম্পূর্ণ সমাধান",
    description:
      "PDF, Word, Excel, ছবি, ZIP — সব ধরনের ফাইল কনভার্ট, এডিট, কম্প্রেস করুন এক জায়গায়। ১০০% প্রাইভেট, সব প্রসেসিং আপনার ব্রাউজারেই।",
    type: "website",
    locale: "bn_BD",
    siteName: "ফাইল ম্যাজিক",
  },
  twitter: {
    card: "summary",
    title: "ফাইল ম্যাজিক — সব ফাইলের সম্পূর্ণ সমাধান",
    description:
      "PDF, Word, Excel, ছবি, ZIP — সব ধরনের ফাইল কনভার্ট, এডিট, কম্প্রেস করুন এক জায়গায়।",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ফাইল ম্যাজিক",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#07070d",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="bn" className="dark" suppressHydrationWarning>
      <body
        className={`${bengali.variable} ${latin.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster position="top-center" richColors />
        <RegisterSW />
      </body>
    </html>
  );
}
