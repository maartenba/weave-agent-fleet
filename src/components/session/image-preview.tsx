"use client";

import { useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface ImagePreviewProps {
  path: string;
  content: string; // base64 for binary images, raw SVG text for SVGs
  isBinary: boolean;
  isSvg: boolean;
  mime?: string;
  className?: string;
}

export function ImagePreview({
  path,
  content,
  isBinary,
  isSvg,
  mime,
  className,
}: ImagePreviewProps) {
  const [scale, setScale] = useState(1);

  const fileName = path.split("/").pop() ?? path;

  const zoomIn = () => setScale((s) => Math.min(4, parseFloat((s * 1.25).toFixed(2))));
  const zoomOut = () => setScale((s) => Math.max(0.1, parseFloat((s / 1.25).toFixed(2))));
  const resetZoom = () => setScale(1);

  return (
    <div className={cn("flex flex-1 flex-col overflow-hidden", className)}>
      {/* Toolbar */}
      <div className="flex h-8 items-center justify-end gap-1 border-b border-border/50 px-2">
        <span className="mr-auto text-xs text-muted-foreground font-mono truncate">
          {fileName}
        </span>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Zoom out"
          onClick={zoomOut}
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <span className="text-xs text-muted-foreground w-12 text-center">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Zoom in"
          onClick={zoomIn}
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Reset zoom"
          onClick={resetZoom}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Image content */}
      <ScrollArea className="flex-1">
        <div className="flex min-h-full items-center justify-center p-6">
          {isSvg ? (
            // SVG rendered via <img> data URI for security — sandboxes scripts/event handlers
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`data:image/svg+xml;base64,${typeof btoa !== "undefined" ? btoa(unescape(encodeURIComponent(content))) : Buffer.from(content).toString("base64")}`}
              alt={fileName}
              className="max-w-full"
              style={{
                transform: `scale(${scale})`,
                transformOrigin: "center center",
              }}
            />
          ) : isBinary && mime ? (
            // Raster image via data URI
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`data:${mime};base64,${content}`}
              alt={fileName}
              className="max-w-full rounded"
              style={{
                transform: `scale(${scale})`,
                transformOrigin: "center center",
                imageRendering: scale > 2 ? "pixelated" : "auto",
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Unable to preview this image</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
