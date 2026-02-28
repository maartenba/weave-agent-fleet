"use client";

import { SessionsProvider } from "@/contexts/sessions-context";
import { SidebarProvider } from "@/contexts/sidebar-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/layout/sidebar";

export function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionsProvider>
      <SidebarProvider>
        <TooltipProvider delayDuration={0}>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-auto">{children}</main>
          </div>
        </TooltipProvider>
      </SidebarProvider>
    </SessionsProvider>
  );
}
