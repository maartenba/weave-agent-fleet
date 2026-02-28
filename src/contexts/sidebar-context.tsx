"use client";

import {
  createContext,
  useCallback,
  useContext,
  type ReactNode,
} from "react";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";

const SIDEBAR_COLLAPSED_KEY = "weave:sidebar:collapsed";

interface SidebarContextValue {
  collapsed: boolean;
  setCollapsed: (value: boolean | ((prev: boolean) => boolean)) => void;
  toggleSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

interface SidebarProviderProps {
  children: ReactNode;
}

export function SidebarProvider({ children }: SidebarProviderProps) {
  const [collapsed, setCollapsed] = usePersistedState<boolean>(
    SIDEBAR_COLLAPSED_KEY,
    false
  );

  const toggleSidebar = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, [setCollapsed]);

  // Global keyboard shortcut: Cmd+B on macOS, Ctrl+B elsewhere
  useKeyboardShortcut("b", toggleSidebar, { platformModifier: true });

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed, toggleSidebar }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return ctx;
}
