"use client";

import React from "react";

type FigureImageProps = {
  lightSrc?: string;
  darkSrc?: string;
  alt: string;
  caption?: React.ReactNode;
  className?: string;
};

export default function FigureImage({ lightSrc, darkSrc, alt, caption, className }: FigureImageProps) {
  // At least one source must be provided
  const initialSrc = lightSrc || darkSrc || "";
  const [src, setSrc] = React.useState(initialSrc);
  const triedFallbackRef = React.useRef(false);

  React.useEffect(() => {
    // Decide initial image based on current theme if both are provided
    if (lightSrc && darkSrc) {
      try {
        const root = document.documentElement;
        const isDark = root.classList.contains("dark") || window.matchMedia?.("(prefers-color-scheme: dark)").matches;
        setSrc(isDark ? darkSrc : lightSrc);
      } catch {
        setSrc(lightSrc);
      }
    } else {
      setSrc(initialSrc);
    }
    triedFallbackRef.current = false;
  }, [lightSrc, darkSrc]);

  function handleError(e: React.SyntheticEvent<HTMLImageElement>) {
    if (triedFallbackRef.current) return;
    // Try swapping to the other variant if available
    if (src === lightSrc && darkSrc) {
      triedFallbackRef.current = true;
      setSrc(darkSrc);
      return;
    }
    if (src === darkSrc && lightSrc) {
      triedFallbackRef.current = true;
      setSrc(lightSrc);
      return;
    }
  }

  if (!lightSrc && !darkSrc) return null;

  return (
    <figure className={className}>
      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="block w-full h-auto object-contain" onError={handleError} />
      </div>
      {caption ? (
        <figcaption className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">{caption}</figcaption>
      ) : null}
    </figure>
  );
}


