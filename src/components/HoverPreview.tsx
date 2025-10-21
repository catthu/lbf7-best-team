"use client";

import React from "react";

type HoverPreviewProps = {
  children: React.ReactNode;
  previewUrl: string;
  width?: number;
  height?: number;
  appearance?: 'chip' | 'inline';
  className?: string; // extra classes for the trigger
  title?: string; // hover hint
};

export default function HoverPreview({ children, previewUrl, width = 480, height = 300, appearance = 'chip', className = '', title = 'Hover to preview' }: HoverPreviewProps) {
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
    <span className="relative inline-block mx-2" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span
        className={
          (appearance === 'chip'
            ? 'inline-flex items-center rounded-md border border-gray-300 dark:border-gray-700 bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100 px-2 py-0.5 text-xs font-medium cursor-help hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors'
            : 'cursor-help') + (className ? ` ${className}` : '')
        }
        title={title}
      >
        {children}
      </span>
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


