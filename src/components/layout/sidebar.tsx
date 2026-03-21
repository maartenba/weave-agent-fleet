"use client";

import {
  useSidebar,
  SIDEBAR_RAIL_WIDTH,
} from "@/contexts/sidebar-context";
import { SidebarIconRail } from "@/components/layout/sidebar-icon-rail";
import { ContextualPanel } from "@/components/layout/sidebar-panel";

export function Sidebar() {
  const { panelOpen, width } = useSidebar();
  const totalWidth = panelOpen ? SIDEBAR_RAIL_WIDTH + width : SIDEBAR_RAIL_WIDTH;

  return (
    <aside
      className="relative flex h-screen flex-row border-r border-sidebar-border bg-sidebar overflow-hidden"
      style={{ width: totalWidth }}
    >
      <SidebarIconRail />
      {panelOpen && <ContextualPanel />}
    </aside>
  );
}
