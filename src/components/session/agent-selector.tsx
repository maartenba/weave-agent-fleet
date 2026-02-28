"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { AutocompleteAgent } from "@/lib/api-types";
import { ChevronDownIcon } from "lucide-react";

interface AgentSelectorProps {
  agents: AutocompleteAgent[];
  selectedAgent: string | null;
  onSelect: (agent: string | null) => void;
  disabled?: boolean;
}

function toTitleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function AgentSelector({
  agents,
  selectedAgent,
  onSelect,
  disabled,
}: AgentSelectorProps) {
  // Filter to non-subagent, non-hidden agents — matching the TUI exactly
  const visibleAgents = agents.filter(
    (a) => a.mode !== "subagent" && a.hidden !== true
  );

  const currentAgent = visibleAgents.find((a) => a.name === selectedAgent);
  const label = currentAgent ? toTitleCase(currentAgent.name) : "Default";

  function handleValueChange(value: string) {
    if (value === "__default__") {
      onSelect(null);
    } else {
      onSelect(value);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="h-9 gap-1.5 px-2.5 text-xs"
        >
          {currentAgent?.color && (
            <span
              className="inline-block h-2 w-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: currentAgent.color }}
            />
          )}
          {label}
          <ChevronDownIcon className="h-3 w-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuRadioGroup
          value={selectedAgent ?? "__default__"}
          onValueChange={handleValueChange}
        >
          <DropdownMenuRadioItem value="__default__" className="text-xs">
            <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40 mr-2 flex-shrink-0" />
            Default
          </DropdownMenuRadioItem>
          {visibleAgents.length > 0 && <DropdownMenuSeparator />}
          {visibleAgents.map((agent) => (
            <DropdownMenuRadioItem
              key={agent.name}
              value={agent.name}
              className="text-xs"
            >
              <span
                className="inline-block h-2 w-2 rounded-full mr-2 flex-shrink-0"
                style={{ backgroundColor: agent.color ?? "var(--muted-foreground)" }}
              />
              <span className="flex-1">{toTitleCase(agent.name)}</span>
              {agent.model && (
                <span className="ml-2 text-muted-foreground truncate max-w-[80px]">
                  {agent.model.modelID}
                </span>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
