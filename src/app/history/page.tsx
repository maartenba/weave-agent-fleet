"use client";

import { Header } from "@/components/layout/header";
import { mockSessions, formatTokens, formatCost, getStatusDot, getStatusColor } from "@/lib/mock-data";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, Hash, Coins, Clock, FileCode } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function HistoryPage() {
  const [search, setSearch] = useState("");

  const allSessions = [...mockSessions].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );

  const filtered = allSessions.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.initialPrompt.toLowerCase().includes(search.toLowerCase()) ||
      s.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex flex-col h-full">
      <Header
        title="History"
        subtitle={`${allSessions.length} total sessions`}
      />
      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search sessions by name, prompt, or tag..."
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Table */}
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-accent/30">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Session</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Prompt</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Agent</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Tokens</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Cost</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Files</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Started</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((session) => {
                const totalTokens = session.tokens.input + session.tokens.output + session.tokens.reasoning;
                return (
                  <tr key={session.id} className="border-b hover:bg-accent/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className={`inline-block h-2 w-2 rounded-full ${getStatusDot(session.status)}`} />
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/sessions/${session.id}`} className="font-medium hover:underline">
                        {session.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 max-w-xs truncate text-muted-foreground">
                      {session.initialPrompt}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="secondary" className="text-[10px]">
                        {session.currentAgent}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      {formatTokens(totalTokens)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      {formatCost(session.cost)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      {session.modifiedFiles.length}
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground whitespace-nowrap">
                      {session.createdAt.toLocaleTimeString("en-US", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <p className="text-center text-muted-foreground py-8">No sessions match your search.</p>
        )}
      </div>
    </div>
  );
}
