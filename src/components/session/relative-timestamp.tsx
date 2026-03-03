"use client";

import { useEffect, useState } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { formatTimestamp, formatRelativeTime } from "@/lib/format-utils";

interface RelativeTimestampProps {
  timestamp: number;
}

export function RelativeTimestamp({ timestamp }: RelativeTimestampProps) {
  // Incrementing this counter forces a re-render every 30 seconds.
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-[10px] text-muted-foreground ml-auto cursor-default">
          {formatRelativeTime(timestamp)}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {formatTimestamp(timestamp)}
      </TooltipContent>
    </Tooltip>
  );
}
