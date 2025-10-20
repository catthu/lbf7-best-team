"use client";

import React from "react";

type HoverPreviewProps = {
  children: React.ReactNode;
  previewUrl: string;
  width?: number;
  height?: number;
};

export default function HoverPreview({ children, previewUrl, width = 480, height = 300 }: HoverPreviewProps) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 });

  React.useEffect(() => {
    if (!open) return;
    let raf = 0;
    const handle = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setPos({ x: e.clientX, y: e.clientY });
      });
    };
    window.addEventListener("mousemove", handle);
    return () => {
      window.removeEventListener("mousemove", handle);
      cancelAnimationFrame(raf);
    };
  }, [open]);

  return (
    <span className="relative inline-block" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {children}
      {open ? (
        (() => {
          const margin = 12;
          const gap = 16; // distance from cursor
          const vw = typeof window !== "undefined" ? window.innerWidth : 0;
          const vh = typeof window !== "undefined" ? window.innerHeight : 0;
          const half = width / 2;
          const leftUnclamped = pos.x;
          const left = Math.min(Math.max(leftUnclamped, half + margin), Math.max(half + margin, vw - half - margin));
          const above = pos.y - height - gap;
          const below = pos.y + gap;
          const topPreferred = above > margin ? above : below;
          const top = Math.min(Math.max(topPreferred, margin), Math.max(margin, vh - height - margin));
          return (
            <span className="pointer-events-none fixed z-50" style={{ left, top, transform: "translateX(-50%)" }}>
              <span className="block overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt="preview" style={{ width, height }} className="object-cover" />
              </span>
            </span>
          );
        })()
      ) : null}
    </span>
  );
}


