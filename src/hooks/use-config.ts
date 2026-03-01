"use client";

import { useState, useEffect, useCallback } from "react";

interface InstalledSkill {
  name: string;
  description: string;
  path: string;
  assignedAgents: string[];
}

interface WeaveConfig {
  agents?: Record<string, { skills?: string[] }>;
}

interface ConfigData {
  userConfig: WeaveConfig;
  installedSkills: InstalledSkill[];
  paths: { userConfig: string; skillsDir: string };
}

export function useConfig() {
  const [data, setData] = useState<ConfigData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch("/api/config");
      if (!res.ok) {
        throw new Error(`Failed to fetch config: ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const updateConfig = useCallback(
    async (config: WeaveConfig) => {
      try {
        setError(null);
        const res = await fetch("/api/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        });
        if (!res.ok) {
          throw new Error(`Failed to update config: ${res.status}`);
        }
        await fetchConfig();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        throw err;
      }
    },
    [fetchConfig]
  );

  return {
    config: data?.userConfig ?? null,
    installedSkills: data?.installedSkills ?? [],
    paths: data?.paths ?? null,
    isLoading,
    error,
    fetchConfig,
    updateConfig,
  };
}
