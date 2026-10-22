import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "standalone" is for self-hosting (docker/vps).
  // On Vercel the VERCEL env var is set automatically, so Vercel
  // gets its default optimized output — zero manual config needed.
  output: process.env.VERCEL ? undefined : "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
