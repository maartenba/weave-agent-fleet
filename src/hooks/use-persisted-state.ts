"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export function usePersistedState<T>(
  key: string,
  defaultValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  // Always start with defaultValue to match SSR output and avoid hydration mismatch.
  // localStorage is read in useEffect after hydration completes.
  const [state, setStateInternal] = useState<T>(defaultValue);
  const hydrated = useRef(false);

  // Hydrate from localStorage after mount (client-only)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        const parsed = JSON.parse(stored) as T;
        setStateInternal(parsed);
      }
    } catch {
      // localStorage may be unavailable
    }
    hydrated.current = true;
  }, [key]);

  // Persist to localStorage on subsequent state changes (skip the initial hydration write)
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // localStorage may be unavailable in some environments
    }
  }, [key, state]);

  const setState = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStateInternal((prev) => {
        const next = typeof value === "function" ? (value as (prev: T) => T)(prev) : value;
        return next;
      });
    },
    []
  );

  return [state, setState];
}
