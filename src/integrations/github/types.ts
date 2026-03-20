export interface GitHubRepo {
  id: number;
  full_name: string; // "owner/repo"
  name: string;
  owner: { login: string; avatar_url: string };
  description: string | null;
  html_url: string;
  private: boolean;
  stargazers_count: number;
  language: string | null;
  updated_at: string;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  labels: Array<{ name: string; color: string }>;
  user: { login: string; avatar_url: string };
  comments: number;
  created_at: string;
  updated_at: string;
  pull_request?: { url: string }; // present if this "issue" is actually a PR
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed" | "merged";
  labels: Array<{ name: string; color: string }>;
  user: { login: string; avatar_url: string };
  comments: number;
  additions: number;
  deletions: number;
  changed_files: number;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  draft: boolean;
}

export interface GitHubComment {
  id: number;
  body: string;
  user: { login: string; avatar_url: string };
  created_at: string;
}
