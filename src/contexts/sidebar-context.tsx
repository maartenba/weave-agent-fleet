"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";

const SIDEBAR_COLLAPSED_KEY = "weave:sidebar:collapsed";
const SIDEBAR_WIDTH_KEY = "weave:sidebar:width";

export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_COLLAPSED_WIDTH = 64;
export const SIDEBAR_DEFAULT_WIDTH = 224;

interface SidebarContextValue {
  collapsed: boolean;
  setCollapsed: (value: boolean | ((prev: boolean) => boolean)) => void;
  toggleSidebar: () => void;
  width: number;
  setWidth: (value: number | ((prev: number) => number)) => void;
  isResizing: boolean;
  setIsResizing: (value: boolean) => void;
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

  const [width, setWidth] = usePersistedState<number>(
    SIDEBAR_WIDTH_KEY,
    SIDEBAR_DEFAULT_WIDTH
  );

  const [isResizing, setIsResizing] = useState(false);

  const toggleSidebar = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, [setCollapsed]);

  // Global keyboard shortcut: Cmd+B on macOS, Ctrl+B elsewhere
  useKeyboardShortcut("b", toggleSidebar, { platformModifier: true });

  return (
    <SidebarContext.Provider
      value={{
        collapsed,
        setCollapsed,
        toggleSidebar,
        width,
        setWidth,
        isResizing,
        setIsResizing,
      }}
    >
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
