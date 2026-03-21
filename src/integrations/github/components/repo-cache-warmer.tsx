"use client";

import { useEffect } from "react";
import { useIntegrationsContext } from "@/contexts/integrations-context";
import { useGitHubRepos } from "../hooks/use-github-repos";

/**
 * Invisible component that keeps the repo cache warm.
 * - On startup: if GitHub is connected and cache is empty or stale, preloads all repos.
 * - On disconnect: clears the cache.
 * Mount at app-layout level so it's always active.
 */
export function GitHubRepoCacheWarmer() {
  const { connectedIntegrations } = useIntegrationsContext();
  const { isStale, refresh, clear } = useGitHubRepos();

  const isGitHubConnected = connectedIntegrations.some(
    (i) => i.id === "github"
  );

  useEffect(() => {
    if (isGitHubConnected && isStale) {
      refresh();
    }
    if (!isGitHubConnected) {
      clear();
    }
  }, [isGitHubConnected, isStale, refresh, clear]);

  return null;
}
