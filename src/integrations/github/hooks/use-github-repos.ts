"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import type { GitHubRepo } from "../types";

interface UseGitHubReposResult {
  repos: GitHubRepo[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

export function useGitHubRepos(): UseGitHubReposResult {
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [fetchKey, setFetchKey] = useState(0);

  const PER_PAGE = 30;

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    apiFetch(`/api/integrations/github/repos?page=${page}&per_page=${PER_PAGE}&sort=updated`)
      .then((res) => res.json())
      .then((data: GitHubRepo[]) => {
        if (cancelled) return;
        if (page === 1) {
          setRepos(data);
        } else {
          setRepos((prev) => [...prev, ...data]);
        }
        setHasMore(data.length === PER_PAGE);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load repos");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, fetchKey]);

  const loadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      setPage((p) => p + 1);
    }
  }, [isLoading, hasMore]);

  const refetch = useCallback(() => {
    setPage(1);
    setRepos([]);
    setFetchKey((k) => k + 1);
  }, []);

  return { repos, isLoading, error, hasMore, loadMore, refetch };
}
