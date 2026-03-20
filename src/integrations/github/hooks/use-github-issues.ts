"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api-client";
import type { GitHubIssue } from "../types";

interface UseGitHubIssuesOptions {
  state?: "open" | "closed" | "all";
  sort?: "created" | "updated" | "comments";
  direction?: "asc" | "desc";
}

interface UseGitHubIssuesResult {
  issues: GitHubIssue[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

export function useGitHubIssues(
  owner: string | null,
  repo: string | null,
  options: UseGitHubIssuesOptions = {}
): UseGitHubIssuesResult {
  const { state = "open", sort = "updated", direction = "desc" } = options;
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [fetchKey, setFetchKey] = useState(0);

  const PER_PAGE = 30;
  const prevKeyRef = useRef<string | null>(null);

  // Derive empty state from owner/repo outside the effect
  const ownerRepoKey = owner && repo ? `${owner}/${repo}` : null;
  if (prevKeyRef.current !== ownerRepoKey && !ownerRepoKey) {
    prevKeyRef.current = ownerRepoKey;
    if (issues.length > 0) setIssues([]);
  } else if (prevKeyRef.current !== ownerRepoKey) {
    prevKeyRef.current = ownerRepoKey;
  }

  useEffect(() => {
    if (!owner || !repo) return;

    let cancelled = false;

    const fetchIssues = async () => {
      setIsLoading(true);
      setError(null);

      const params = new URLSearchParams({
        state,
        sort,
        direction,
        page: String(page),
        per_page: String(PER_PAGE),
      });

      try {
        const res = await apiFetch(`/api/integrations/github/repos/${owner}/${repo}/issues?${params}`);
        const data: GitHubIssue[] = await res.json();
        if (cancelled) return;
        // Filter out pull requests (GitHub issues endpoint also returns PRs)
        const issuesOnly = data.filter((i) => !i.pull_request);
        if (page === 1) {
          setIssues(issuesOnly);
        } else {
          setIssues((prev) => [...prev, ...issuesOnly]);
        }
        setHasMore(data.length === PER_PAGE);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load issues");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchIssues();

    return () => {
      cancelled = true;
    };
  }, [owner, repo, state, sort, direction, page, fetchKey]);

  const loadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      setPage((p) => p + 1);
    }
  }, [isLoading, hasMore]);

  const refetch = useCallback(() => {
    setPage(1);
    setIssues([]);
    setFetchKey((k) => k + 1);
  }, []);

  return { issues, isLoading, error, hasMore, loadMore, refetch };
}
