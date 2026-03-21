"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { apiFetch } from "@/lib/api-client";
import type { GitHubRepo, CachedGitHubRepo } from "../types";

const CACHE_KEY = "weave:github:repos-cache";
const CACHE_TS_KEY = "weave:github:repos-cache-ts";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const PER_PAGE = 100;

export interface UseGitHubReposResult {
  repos: CachedGitHubRepo[];
  isLoading: boolean;
  error: string | null;
  lastUpdated: number | null;
  isStale: boolean;
  refresh: () => void;
  clear: () => void;
}

function toCache(repo: GitHubRepo): CachedGitHubRepo {
  return {
    id: repo.id,
    full_name: repo.full_name,
    name: repo.name,
    owner_login: repo.owner.login,
    private: repo.private,
    language: repo.language,
    stargazers_count: repo.stargazers_count,
  };
}

export function useGitHubRepos(): UseGitHubReposResult {
  const [cachedRepos, setCachedRepos] = usePersistedState<CachedGitHubRepo[]>(
    CACHE_KEY,
    []
  );
  const [cacheTimestamp, setCacheTimestamp] = usePersistedState<number | null>(
    CACHE_TS_KEY,
    null
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs to prevent concurrent fetches and handle unmount
  const isFetchingRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Exhaustive pagination — fetch all repos
  const fetchAll = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      let page = 1;
      const all: CachedGitHubRepo[] = [];

      while (true) {
        const res = await apiFetch(
          `/api/integrations/github/repos?page=${page}&per_page=${PER_PAGE}&sort=updated`
        );
        if (!res.ok) throw new Error("Failed to fetch repositories");
        if (!isMountedRef.current) return;

        const data: GitHubRepo[] = await res.json();
        all.push(...data.map(toCache));

        if (data.length < PER_PAGE) break;
        page++;
      }

      if (!isMountedRef.current) return;
      setCachedRepos(all);
      setCacheTimestamp(Date.now());
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to load repositories"
      );
    } finally {
      isFetchingRef.current = false;
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [setCachedRepos, setCacheTimestamp]);

  // Staleness check — consumers decide when to act on this
  const isStale =
    cacheTimestamp === null ||
    Date.now() - cacheTimestamp > CACHE_MAX_AGE_MS;

  const refresh = useCallback(() => {
    fetchAll();
  }, [fetchAll]);

  const clear = useCallback(() => {
    setCachedRepos([]);
    setCacheTimestamp(null);
  }, [setCachedRepos, setCacheTimestamp]);

  return {
    repos: cachedRepos,
    isLoading,
    error,
    lastUpdated: cacheTimestamp,
    isStale,
    refresh,
    clear,
  };
}
