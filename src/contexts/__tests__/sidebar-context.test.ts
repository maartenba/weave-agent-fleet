// @vitest-environment jsdom

import React from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  SidebarProvider,
  useSidebar,
  viewHasPanel,
} from "@/contexts/sidebar-context";

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(SidebarProvider, null, children);
}

describe("sidebar context", () => {
  it("tracks panel visibility by view", () => {
    expect(viewHasPanel("fleet")).toBe(true);
    expect(viewHasPanel("github")).toBe(true);
    expect(viewHasPanel("repositories")).toBe(true);
    expect(viewHasPanel("welcome")).toBe(false);
  });

  it("toggleSidebar collapses without changing activeView", () => {
    localStorage.clear();
    const { result } = renderHook(() => useSidebar(), { wrapper });

    act(() => {
      result.current.setActiveView("github");
    });
    expect(result.current.activeView).toBe("github");
    expect(result.current.panelOpen).toBe(true);
    expect(result.current.isCollapsed).toBe(false);

    // toggleSidebar → collapses (isCollapsed=true), activeView stays "github"
    act(() => {
      result.current.toggleSidebar();
    });
    expect(result.current.activeView).toBe("github");
    expect(result.current.isCollapsed).toBe(true);
    expect(result.current.panelOpen).toBe(false);

    // toggleSidebar again → expands back, activeView still "github"
    act(() => {
      result.current.toggleSidebar();
    });
    expect(result.current.activeView).toBe("github");
    expect(result.current.isCollapsed).toBe(false);
    expect(result.current.panelOpen).toBe(true);
  });

  it("toggleSidebar collapses repositories view without navigation", () => {
    localStorage.clear();
    const { result } = renderHook(() => useSidebar(), { wrapper });

    act(() => {
      result.current.setActiveView("repositories");
    });
    expect(result.current.activeView).toBe("repositories");
    expect(result.current.panelOpen).toBe(true);

    act(() => {
      result.current.toggleSidebar();
    });
    expect(result.current.activeView).toBe("repositories");
    expect(result.current.isCollapsed).toBe(true);
    expect(result.current.panelOpen).toBe(false);

    act(() => {
      result.current.toggleSidebar();
    });
    expect(result.current.activeView).toBe("repositories");
    expect(result.current.isCollapsed).toBe(false);
    expect(result.current.panelOpen).toBe(true);
  });

  it("toggleSidebar from welcome restores last panel view and expands", () => {
    localStorage.clear();
    const { result } = renderHook(() => useSidebar(), { wrapper });

    // Visit github, then navigate to welcome
    act(() => {
      result.current.setActiveView("github");
    });
    act(() => {
      result.current.setActiveView("welcome");
    });
    expect(result.current.activeView).toBe("welcome");

    // ⌘B from welcome → restores last panel view and expands
    act(() => {
      result.current.toggleSidebar();
    });
    expect(result.current.activeView).toBe("github");
    expect(result.current.isCollapsed).toBe(false);
    expect(result.current.panelOpen).toBe(true);
  });

  it("setActiveView keeps collapsed state when switching views", () => {
    localStorage.clear();
    const { result } = renderHook(() => useSidebar(), { wrapper });

    // Collapse the sidebar
    act(() => {
      result.current.setActiveView("fleet");
    });
    act(() => {
      result.current.toggleCollapse();
    });
    expect(result.current.isCollapsed).toBe(true);
    expect(result.current.panelOpen).toBe(false);

    // Switching to a panel view while collapsed → stays collapsed
    act(() => {
      result.current.setActiveView("github");
    });
    expect(result.current.activeView).toBe("github");
    expect(result.current.isCollapsed).toBe(true);
    expect(result.current.panelOpen).toBe(false);
  });

  it("isCollapsed is independent of activeView", () => {
    localStorage.clear();
    const { result } = renderHook(() => useSidebar(), { wrapper });

    act(() => {
      result.current.setActiveView("fleet");
    });
    // Collapse
    act(() => {
      result.current.toggleCollapse();
    });
    expect(result.current.isCollapsed).toBe(true);
    expect(result.current.panelOpen).toBe(false);
    expect(result.current.activeView).toBe("fleet");

    // Switching view stays collapsed
    act(() => {
      result.current.setActiveView("github");
    });
    expect(result.current.isCollapsed).toBe(true);
    expect(result.current.panelOpen).toBe(false);
    expect(result.current.activeView).toBe("github");

    // Manually expand
    act(() => {
      result.current.toggleCollapse();
    });
    expect(result.current.isCollapsed).toBe(false);
    expect(result.current.panelOpen).toBe(true);
    expect(result.current.activeView).toBe("github");

    // Collapse again
    act(() => {
      result.current.toggleCollapse();
    });
    expect(result.current.isCollapsed).toBe(true);
    expect(result.current.panelOpen).toBe(false);
    expect(result.current.activeView).toBe("github");
  });

  it("setCollapsed directly sets collapse state", () => {
    localStorage.clear();
    const { result } = renderHook(() => useSidebar(), { wrapper });

    act(() => {
      result.current.setActiveView("fleet");
    });
    act(() => {
      result.current.setCollapsed(true);
    });
    expect(result.current.isCollapsed).toBe(true);
    expect(result.current.panelOpen).toBe(false);

    act(() => {
      result.current.setCollapsed(false);
    });
    expect(result.current.isCollapsed).toBe(false);
    expect(result.current.panelOpen).toBe(true);
  });

  it("collapsed backwards-compat alias equals isCollapsed", () => {
    localStorage.clear();
    const { result } = renderHook(() => useSidebar(), { wrapper });

    act(() => {
      result.current.setActiveView("fleet");
    });
    expect(result.current.collapsed).toBe(false);
    expect(result.current.isCollapsed).toBe(false);

    act(() => {
      result.current.toggleCollapse();
    });
    expect(result.current.collapsed).toBe(true);
    expect(result.current.isCollapsed).toBe(true);
  });
});
