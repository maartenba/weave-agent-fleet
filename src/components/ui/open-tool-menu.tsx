"use client";

import { Code2, MousePointer2, Terminal, FolderOpen } from "lucide-react";
import type { OpenTool } from "@/hooks/use-open-directory";

import {
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

import {
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";

import { ExternalLink } from "lucide-react";

interface OpenToolItem {
  tool: OpenTool;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TOOL_ITEMS: OpenToolItem[] = [
  { tool: "vscode", label: "VS Code", icon: Code2 },
  { tool: "cursor", label: "Cursor", icon: MousePointer2 },
];

const SECONDARY_TOOL_ITEMS: OpenToolItem[] = [
  { tool: "terminal", label: "Terminal", icon: Terminal },
  { tool: "explorer", label: "File Explorer", icon: FolderOpen },
];

// ── Dropdown Menu variant (for SessionGroup overflow menu) ──────────────────

interface OpenToolDropdownSubmenuProps {
  directory: string;
  onOpen: (directory: string, tool: OpenTool) => void;
}

export function OpenToolDropdownSubmenu({
  directory,
  onOpen,
}: OpenToolDropdownSubmenuProps) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2 text-xs">
        <ExternalLink className="size-3.5" />
        Open in...
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {TOOL_ITEMS.map(({ tool, label, icon: Icon }) => (
          <DropdownMenuItem
            key={tool}
            onClick={() => onOpen(directory, tool)}
            className="gap-2 text-xs"
          >
            <Icon className="size-3.5" />
            {label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {SECONDARY_TOOL_ITEMS.map(({ tool, label, icon: Icon }) => (
          <DropdownMenuItem
            key={tool}
            onClick={() => onOpen(directory, tool)}
            className="gap-2 text-xs"
          >
            <Icon className="size-3.5" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

// ── Context Menu variant (for SidebarWorkspaceItem right-click menu) ────────

interface OpenToolContextSubmenuProps {
  directory: string;
  onOpen: (directory: string, tool: OpenTool) => void;
}

export function OpenToolContextSubmenu({
  directory,
  onOpen,
}: OpenToolContextSubmenuProps) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger className="gap-2 text-xs">
        <ExternalLink className="h-3.5 w-3.5" />
        Open in...
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {TOOL_ITEMS.map(({ tool, label, icon: Icon }) => (
          <ContextMenuItem
            key={tool}
            onClick={() => onOpen(directory, tool)}
            className="gap-2 text-xs"
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        {SECONDARY_TOOL_ITEMS.map(({ tool, label, icon: Icon }) => (
          <ContextMenuItem
            key={tool}
            onClick={() => onOpen(directory, tool)}
            className="gap-2 text-xs"
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
