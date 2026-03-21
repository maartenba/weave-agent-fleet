"use client";

import { useCallback } from "react";
import { usePersistedState } from "@/hooks/use-persisted-state";
import type { BookmarkedRepo } from "@/integrations/github/types";

const BOOKMARKED_REPOS_KEY = "weave:github:repos";

interface UseBookmarkedReposResult {
  repos: BookmarkedRepo[];
  addRepo: (repo: BookmarkedRepo) => void;
  removeRepo: (fullName: string) => void;
  hasRepo: (fullName: string) => boolean;
}

export function useBookmarkedRepos(): UseBookmarkedReposResult {
  const [repos, setRepos] = usePersistedState<BookmarkedRepo[]>(
    BOOKMARKED_REPOS_KEY,
    []
  );

  const addRepo = useCallback(
    (repo: BookmarkedRepo) => {
      setRepos((prev) => {
        if (prev.some((r) => r.fullName === repo.fullName)) return prev;
        return [...prev, repo];
      });
    },
    [setRepos]
  );

  const removeRepo = useCallback(
    (fullName: string) => {
      setRepos((prev) => prev.filter((r) => r.fullName !== fullName));
    },
    [setRepos]
  );

  const hasRepo = useCallback(
    (fullName: string) => repos.some((r) => r.fullName === fullName),
    [repos]
  );

  return { repos, addRepo, removeRepo, hasRepo };
}
