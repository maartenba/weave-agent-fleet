"use client";

import { Suspense } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useIntegrationsContext } from "@/contexts/integrations-context";
import { getIntegrations } from "@/integrations/registry";

export function IntegrationsTab() {
  const { connect, disconnect, integrations } = useIntegrationsContext();
  const manifests = getIntegrations();

  const isConnected = (id: string) =>
    integrations.some((i) => i.id === id && i.status === "connected");

  if (manifests.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Connect external services to browse their content and create sessions
          with context.
        </p>
        <p className="text-sm text-muted-foreground italic">
          No integrations available.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Connect external services to browse their content and create sessions
        with context.
      </p>

      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {manifests.map((manifest) => {
          const connected = isConnected(manifest.id);
          const Icon = manifest.icon;
          const SettingsComponent = manifest.settingsComponent;

          return (
            <Card key={manifest.id} className={connected ? "" : "opacity-80"}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon size={20} />
                    <h4 className="text-sm font-semibold">{manifest.name}</h4>
                  </div>
                  {connected ? (
                    <Badge
                      variant="secondary"
                      className="text-[10px] bg-green-500/10 text-green-600 dark:text-green-400"
                    >
                      <Wifi className="h-3 w-3 mr-1" />
                      Connected
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-[10px] text-muted-foreground"
                    >
                      <WifiOff className="h-3 w-3 mr-1" />
                      Not Connected
                    </Badge>
                  )}
                </div>

                {connected ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => disconnect(manifest.id)}
                  >
                    Disconnect
                  </Button>
                ) : SettingsComponent ? (
                  <Suspense fallback={null}>
                    <SettingsComponent />
                  </Suspense>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    No configuration available.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
