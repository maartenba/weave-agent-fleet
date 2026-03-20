"use client";

import { useState } from "react";
import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIntegrationsContext } from "@/contexts/integrations-context";

type ConnectionTestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success"; username: string }
  | { status: "error"; message: string };

interface GitHubUserResponse {
  login: string;
}

/**
 * GitHub settings component — allows entering a PAT and connecting/disconnecting GitHub.
 * Referenced by the GitHub manifest's settingsComponent field.
 */
export function GitHubSettings() {
  const { connect, integrations } = useIntegrationsContext();
  const [token, setToken] = useState("");
  const [testState, setTestState] = useState<ConnectionTestState>({
    status: "idle",
  });
  const [isConnecting, setIsConnecting] = useState(false);

  const isConnected = integrations.some(
    (i) => i.id === "github" && i.status === "connected"
  );

  async function handleTestConnection() {
    if (!token.trim()) return;
    setTestState({ status: "testing" });

    try {
      // Verify the token directly against GitHub's API.
      // The PAT is user-typed and not yet stored server-side, so we must
      // validate it client-side before sending it to the server for storage.
      const userResponse = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      });

      if (userResponse.ok) {
        const user = (await userResponse.json()) as GitHubUserResponse;
        setTestState({ status: "success", username: user.login });
      } else {
        const data = (await userResponse.json().catch(() => ({}))) as { message?: string };
        setTestState({
          status: "error",
          message: data.message ?? "Invalid token",
        });
      }
    } catch {
      setTestState({ status: "error", message: "Network error" });
    }
  }

  async function handleConnect() {
    if (!token.trim()) return;
    setIsConnecting(true);
    try {
      await connect("github", { token: token.trim() });
      setToken("");
      setTestState({ status: "idle" });
    } catch (err) {
      setTestState({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to connect",
      });
    } finally {
      setIsConnecting(false);
    }
  }

  if (isConnected) {
    return null; // Parent (integrations-tab) handles the disconnect button
  }

  return (
    <div className="space-y-2">
      <Input
        type="password"
        placeholder="ghp_xxxxxxxxxxxx"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        disabled={isConnecting}
      />

      {testState.status === "success" && (
        <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
          <CheckCircle className="h-3.5 w-3.5" />
          Connected as @{testState.username}
        </div>
      )}

      {testState.status === "error" && (
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />
          {testState.message}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleTestConnection}
          disabled={!token.trim() || testState.status === "testing" || isConnecting}
        >
          {testState.status === "testing" && (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          )}
          Test Connection
        </Button>

        <Button
          size="sm"
          onClick={handleConnect}
          disabled={!token.trim() || isConnecting}
        >
          {isConnecting && (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          )}
          Connect
        </Button>
      </div>
    </div>
  );
}
