"use client";

import { useState, useEffect, useRef } from "react";
import { MarkdownRenderer } from "@/components/session/markdown-renderer";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, MessageSquare, Loader2 } from "lucide-react";
import { GithubIcon as Github } from "@/components/icons/github";
import { cn } from "@/lib/utils";
import { useGitHubComments } from "../hooks/use-github-comments";
import { CreateSessionButton } from "./create-session-button";
import type { GitHubIssue } from "../types";
import type { ContextSource } from "@/integrations/types";

interface IssueRowProps {
  issue: GitHubIssue;
  owner: string;
  repo: string;
  onLabelClick?: (label: string) => void;
}

function formatAge(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function IssueRow({ issue, owner, repo, onLabelClick }: IssueRowProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { comments, isLoading, fetch: fetchComments } =
    useGitHubComments(owner, repo, "issues", issue.number);

  const hasFetchedRef = useRef(false);

  useEffect(() => {
    if (isOpen && !hasFetchedRef.current && !isLoading) {
      hasFetchedRef.current = true;
      fetchComments();
    }
  }, [isOpen, isLoading, fetchComments]);

  const contextSource: ContextSource = {
    type: "github-issue",
    url: issue.html_url,
    title: `Issue #${issue.number}: ${issue.title}`,
    body: issue.body ?? "",
    metadata: {
      owner,
      repo,
      number: issue.number,
      labels: issue.labels,
      state: issue.state,
      comments: comments.map((c) => ({
        author: c.user.login,
        body: c.body,
        createdAt: c.created_at,
      })),
    },
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors group">
        <CollapsibleTrigger className="flex items-start gap-2 flex-1 min-w-0 text-left pt-0.5">
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform mt-0.5",
              isOpen && "rotate-90"
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground font-mono shrink-0">
                #{issue.number}
              </span>
              <span className="text-sm truncate">{issue.title}</span>
            </div>
            {issue.labels.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {issue.labels.map((l) => (
                  <Badge
                    key={l.name}
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 cursor-pointer hover:opacity-70 transition-opacity"
                    style={{ borderColor: `#${l.color}`, color: `#${l.color}` }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onLabelClick?.(l.name);
                    }}
                  >
                    {l.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CollapsibleTrigger>
        <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
          {issue.comments > 0 && (
            <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
              <MessageSquare className="h-3 w-3" />
              {issue.comments}
            </span>
          )}
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {issue.user.login}
          </span>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {formatAge(issue.created_at)}
          </span>
          <div className="flex items-center gap-0.5 can-hover:opacity-0 can-hover:group-hover:opacity-100 transition-opacity">
            <a
              href={issue.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Open on GitHub"
              onClick={(e) => e.stopPropagation()}
            >
              <Github className="h-3.5 w-3.5" />
            </a>
            <CreateSessionButton contextSource={contextSource} iconOnly />
          </div>
        </div>
      </div>
      <CollapsibleContent>
        <div className="ml-7 mr-2 mb-2 p-3 rounded-md border bg-muted/30 space-y-3">
          {issue.body ? (
            <MarkdownRenderer content={issue.body} />
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No description provided.
            </p>
          )}

          <div className="border-t pt-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Comments ({issue.comments})
            </p>
            {isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading comments…
              </div>
            ) : comments.length > 0 ? (
              <div className="space-y-3">
                {comments.map((comment) => (
                  <div key={comment.id} className="text-xs space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">@{comment.user.login}</span>
                      <span className="text-muted-foreground">
                        {formatAge(comment.created_at)}
                      </span>
                    </div>
                    <MarkdownRenderer content={comment.body} className="text-muted-foreground" />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No comments yet.</p>
            )}
          </div>

          <div className="border-t pt-3">
            <CreateSessionButton contextSource={contextSource} />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
