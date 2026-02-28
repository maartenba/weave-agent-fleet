import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@opencode-ai/sdk", "better-sqlite3"],
};

export default nextConfig;
