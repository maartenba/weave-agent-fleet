"use client";

import { use } from "react";
import { Badge } from "@/components/ui/badge";
import { CircleDot, GitPullRequest } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Header } from "@/components/layout/header";
import { IssueList } from "@/integrations/github/components/issue-list";
import { PrList } from "@/integrations/github/components/pr-list";
import { useGitHubIssues } from "@/integrations/github/hooks/use-github-issues";
import { useGitHubPulls } from "@/integrations/github/hooks/use-github-pulls";

interface PageProps {
  params: Promise<{ owner: string; repo: string }>;
}

export default function GitHubRepoPage({ params }: PageProps) {
  const { owner, repo } = use(params);

  const { issues: openIssues } = useGitHubIssues(owner, repo, { state: "open" });
  const { pulls: openPulls } = useGitHubPulls(owner, repo, { state: "open" });

  return (
    <div className="flex flex-col h-full">
      <Header title={`${owner}/${repo}`} />
        <div className="flex-1 overflow-auto thin-scrollbar p-6">
        <Tabs defaultValue="issues">
          <TabsList variant="line">
            <TabsTrigger value="issues" className="gap-1.5">
              <CircleDot className="h-3.5 w-3.5" />
              Issues
              {openIssues.length > 0 && (
                <Badge variant="secondary" className="text-[10px] ml-1">
                  {openIssues.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="pulls" className="gap-1.5">
              <GitPullRequest className="h-3.5 w-3.5" />
              Pull Requests
              {openPulls.length > 0 && (
                <Badge variant="secondary" className="text-[10px] ml-1">
                  {openPulls.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="issues" className="mt-4">
            <IssueList owner={owner} repo={repo} />
          </TabsContent>

          <TabsContent value="pulls" className="mt-4">
            <PrList owner={owner} repo={repo} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
