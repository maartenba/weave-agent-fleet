import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ["@opencode-ai/sdk", "better-sqlite3"],
};

export default nextConfig;
