import type { NextConfig } from "next";
import { execSync } from "child_process";
import packageJson from "./package.json" with { type: "json" };

function getGitCommitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function getAppVersion(): string {
  // CI sets APP_VERSION from the git tag (e.g. "v0.4.0" → "0.4.0")
  if (process.env.APP_VERSION) {
    return process.env.APP_VERSION.replace(/^v/, "");
  }
  // Fallback to package.json for local dev
  return packageJson.version;
}

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ["@opencode-ai/sdk", "better-sqlite3"],
  env: {
    NEXT_PUBLIC_APP_VERSION: getAppVersion(),
    NEXT_PUBLIC_COMMIT_SHA: getGitCommitSha(),
    // NEXT_PUBLIC_API_BASE_URL — set at build time to point the frontend at
    // an external API server (e.g. "http://localhost:3000"). When unset or
    // empty, all fetch calls use relative URLs (same-origin / standalone mode).
    // See also: .env.development.split for split-mode dev setup.
  },
};

export default nextConfig;
