"use client";

import { Loader2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useConfig } from "@/hooks/use-config";

export function AgentsTab() {
  const { config, installedSkills, isLoading } = useConfig();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const agents = config?.agents ?? {};
  const agentNames = Object.keys(agents);

  if (agentNames.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Users className="h-8 w-8 mb-3 opacity-40" />
        <p className="text-sm">No agent configurations found</p>
        <p className="text-xs mt-1">
          Agent mappings are defined in{" "}
          <code className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">
            weave-opencode.jsonc
          </code>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {agentNames.length} agent{agentNames.length !== 1 ? "s" : ""} configured.
        Showing skills assigned to each agent.
      </p>

      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
        {agentNames.sort().map((agentName) => {
          const agentConfig = agents[agentName];
          const skills = agentConfig.skills ?? [];

          return (
            <Card key={agentName}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold font-mono">
                    {agentName}
                  </h4>
                  <Badge variant="secondary" className="text-[10px]">
                    {skills.length} skill{skills.length !== 1 ? "s" : ""}
                  </Badge>
                </div>

                {skills.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No skills assigned
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {skills.map((skillName) => {
                      // Find description from installed skills
                      const installed = installedSkills.find(
                        (s) => s.name === skillName
                      );
                      return (
                        <Badge
                          key={skillName}
                          variant="outline"
                          className="text-[10px]"
                          title={installed?.description ?? ""}
                        >
                          {skillName}
                        </Badge>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
