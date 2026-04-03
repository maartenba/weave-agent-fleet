"use client";

import { useState, useCallback } from "react";
import { XIcon, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { Dialog as DialogPrimitive, VisuallyHidden } from "radix-ui";

interface ImageLightboxProps {
  src: string;
  alt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImageLightbox({ src, alt, open, onOpenChange }: ImageLightboxProps) {
  const [scale, setScale] = useState(1);

  const zoomIn = useCallback(() => setScale((s) => Math.min(4, parseFloat((s * 1.25).toFixed(2)))), []);
  const zoomOut = useCallback(() => setScale((s) => Math.max(0.1, parseFloat((s / 1.25).toFixed(2)))), []);
  const resetZoom = useCallback(() => setScale(1), []);

  const handleOpenChange = useCallback(
    (value: boolean) => {
      if (!value) setScale(1);
      onOpenChange(value);
    },
    [onOpenChange],
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-0 z-50 flex flex-col outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>{alt}</DialogPrimitive.Title>
          </VisuallyHidden.Root>

          {/* Toolbar */}
          <div className="flex h-10 shrink-0 items-center gap-1 border-b border-white/10 bg-black/60 px-3">
            <span className="mr-auto text-xs text-white/70 font-mono truncate">
              {alt}
            </span>
            <button
              type="button"
              className="rounded p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              title="Zoom out"
              onClick={zoomOut}
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs text-white/70 w-12 text-center">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              className="rounded p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              title="Zoom in"
              onClick={zoomIn}
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="rounded p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              title="Reset zoom"
              onClick={resetZoom}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <DialogPrimitive.Close className="ml-2 rounded p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white">
              <XIcon className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>

          {/* Image */}
          <div className="flex-1 overflow-auto flex items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              className="max-w-full max-h-full rounded object-contain"
              style={{
                transform: `scale(${scale})`,
                transformOrigin: "center center",
                imageRendering: scale > 2 ? "pixelated" : "auto",
              }}
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
