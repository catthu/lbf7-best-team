"use client";

import React from "react";

type CarouselImage = {
  src: string;
  alt?: string;
  caption?: string;
};

export default function ImageCarousel({ images }: { images: CarouselImage[] }) {
  const [index, setIndex] = React.useState(0);
  const hasImages = images && images.length > 0;

  if (!hasImages) return null;

  const current = images[index];

  function go(delta: number) {
    setIndex((prev) => (prev + delta + images.length) % images.length);
  }

  return (
    <div className="group relative w-full select-none">
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800 bg-black/5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.src} alt={current.alt || ""} className="h-full w-full object-contain" />
      </div>
      {current.caption ? (
        <div className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">{current.caption}</div>
      ) : null}
      <div className="mt-3 flex items-center justify-center gap-3">
        <button onClick={() => go(-1)} className="rounded-md border border-gray-300 dark:border-gray-700 px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800">Prev</button>
        <div className="text-xs tabular-nums text-gray-500 dark:text-gray-400">{index + 1} / {images.length}</div>
        <button onClick={() => go(1)} className="rounded-md border border-gray-300 dark:border-gray-700 px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800">Next</button>
      </div>
    </div>
  );
}



