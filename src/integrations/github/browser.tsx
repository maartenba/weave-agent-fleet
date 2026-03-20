"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { CircleDot, GitPullRequest } from "lucide-react";
import { RepoSelector } from "./components/repo-selector";
import { IssueList } from "./components/issue-list";
import { PrList } from "./components/pr-list";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useGitHubIssues } from "./hooks/use-github-issues";
import { useGitHubPulls } from "./hooks/use-github-pulls";
import type { GitHubRepo } from "./types";

function GitHubBrowserInner({ repo }: { repo: GitHubRepo }) {
  const [owner, repoName] = repo.full_name.split("/");
  const { issues } = useGitHubIssues(owner, repoName, { state: "open" });
  const { pulls } = useGitHubPulls(owner, repoName, { state: "open" });

  return (
    <Tabs defaultValue="issues">
      <TabsList variant="line">
        <TabsTrigger value="issues" className="gap-1.5">
          <CircleDot className="h-3.5 w-3.5" />
          Issues
          {issues.length > 0 && (
            <Badge variant="secondary" className="text-[10px] ml-1">
              {issues.length}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="pulls" className="gap-1.5">
          <GitPullRequest className="h-3.5 w-3.5" />
          Pull Requests
          {pulls.length > 0 && (
            <Badge variant="secondary" className="text-[10px] ml-1">
              {pulls.length}
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="issues" className="mt-4">
        <IssueList owner={owner} repo={repoName} />
      </TabsContent>

      <TabsContent value="pulls" className="mt-4">
        <PrList owner={owner} repo={repoName} />
      </TabsContent>
    </Tabs>
  );
}

export function GitHubBrowser() {
  const [selectedRepo, setSelectedRepo] =
    usePersistedState<GitHubRepo | null>("weave:github:lastRepo", null);

  return (
    <div>
      {/* Repo selector bar */}
      <div className="mb-4">
        <RepoSelector selected={selectedRepo} onSelect={setSelectedRepo} />
      </div>

      {selectedRepo ? (
        <GitHubBrowserInner repo={selectedRepo} />
      ) : (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
          <p className="text-sm text-muted-foreground">
            Select a repository to browse issues and pull requests.
          </p>
        </div>
      )}
    </div>
  );
}

export default GitHubBrowser;
