"use client";

import React from "react";

type CarouselImage = {
  // Original single-source field (kept for backward compatibility)
  src?: string;
  // Optional light/dark variants, like FigureImage
  lightSrc?: string;
  darkSrc?: string;
  alt?: string;
  caption?: string;
  href?: string;
};

export default function ImageCarousel({ images }: { images: CarouselImage[] }) {
  const [index, setIndex] = React.useState(0);
  const hasImages = images && images.length > 0;

  // Track which concrete src string we are using for each image
  const [displaySrcs, setDisplaySrcs] = React.useState<string[]>(
    () => images.map((img) => img.src || img.lightSrc || img.darkSrc || "")
  );
  const triedFallbackRef = React.useRef<Record<number, boolean>>({});

  React.useEffect(() => {
    if (!hasImages) return;
    try {
      const root = document.documentElement;
      const isDark =
        root.classList.contains("dark") ||
        window.matchMedia?.("(prefers-color-scheme: dark)").matches;
      const next = images.map((img) => {
        if (img.lightSrc && img.darkSrc) {
          return isDark ? img.darkSrc : img.lightSrc;
        }
        if (isDark) {
          return img.darkSrc || img.src || img.lightSrc || "";
        }
        return img.lightSrc || img.src || img.darkSrc || "";
      });
      setDisplaySrcs(next);
    } catch {
      setDisplaySrcs(images.map((img) => img.src || img.lightSrc || img.darkSrc || ""));
    }
    triedFallbackRef.current = {};
  }, [hasImages, images]);

  if (!hasImages) return null;

  const current = images[index];
  const currentSrc = displaySrcs[index] || current.src || current.lightSrc || current.darkSrc || "";

  function go(delta: number) {
    setIndex((prev) => (prev + delta + images.length) % images.length);
  }

  function handleError(imageIndex: number) {
    if (triedFallbackRef.current[imageIndex]) return;
    const img = images[imageIndex];
    setDisplaySrcs((prev) => {
      const next = [...prev];
      const current = next[imageIndex] || img.src || img.lightSrc || img.darkSrc || "";
      let alt = current;
      if (img.lightSrc && img.darkSrc) {
        if (current === img.lightSrc) alt = img.darkSrc;
        else if (current === img.darkSrc) alt = img.lightSrc;
      } else if (img.src && img.darkSrc && current === img.src) {
        alt = img.darkSrc;
      } else if (img.src && img.lightSrc && current === img.src) {
        alt = img.lightSrc;
      }
      if (alt !== current) {
        next[imageIndex] = alt;
        triedFallbackRef.current[imageIndex] = true;
      }
      return next;
    });
  }

  return (
    <div className="group relative w-full select-none">
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800 bg-black/5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={currentSrc}
          alt={current.alt || ""}
          className={`h-full w-full object-contain ${current.href ? "cursor-pointer" : ""}`}
          onClick={current.href ? () => window.open(current.href, "_blank") : undefined}
          onError={() => handleError(index)}
        />
      </div>
      {current.caption ? (
        <div className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">{current.caption}</div>
      ) : null}
      <div className="mt-3 flex items-center justify-center gap-3">
        <button onClick={() => go(-1)} className="cursor-pointer rounded-md border border-gray-300 dark:border-gray-700 px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800">Prev</button>
        <div className="text-xs tabular-nums text-gray-500 dark:text-gray-400">{index + 1} / {images.length}</div>
        <button onClick={() => go(1)} className="cursor-pointer rounded-md border border-gray-300 dark:border-gray-700 px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800">Next</button>
      </div>
    </div>
  );
}




