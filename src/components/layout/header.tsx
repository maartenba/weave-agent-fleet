"use client";

import { Button } from "@/components/ui/button";
import { Bell, Plus } from "lucide-react";
import { NewSessionDialog } from "@/components/session/new-session-dialog";

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Header({ title, subtitle, actions }: HeaderProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border px-6">
      <div>
        <h2 className="text-lg font-semibold font-mono">{title}</h2>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full weave-gradient-bg text-[10px] text-white">
            2
          </span>
        </Button>
      </div>
    </header>
  );
}

export function NewSessionButton() {
  return (
    <NewSessionDialog
      trigger={
        <Button size="sm" className="gap-1.5 weave-gradient-bg hover:opacity-90 border-0">
          <Plus className="h-3.5 w-3.5" />
          New Session
        </Button>
      }
    />
  );
}
