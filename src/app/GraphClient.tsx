"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import GraphViewer from "../components/GraphViewer";

export default function GraphClient({ initialViewMode }: { initialViewMode?: 'default' | 'locality' }) {
  // Read once on first render to avoid hydration mismatch and racing updates
  const initialFocus = React.useMemo(() => {
    try {
      if (typeof window === 'undefined') return undefined;
      const url = new URL(window.location.href);
      return (url.searchParams.get('protein') || url.searchParams.get('focus') || undefined) || undefined;
    } catch { return undefined; }
  }, []);
  return (
    <div className="absolute inset-0">
      <GraphViewer initialViewMode={initialViewMode} initialFocus={initialFocus} />
    </div>
  );
}


