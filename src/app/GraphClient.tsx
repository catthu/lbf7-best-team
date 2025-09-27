"use client";

import React from "react";
import GraphViewer from "../components/GraphViewer";

export default function GraphClient({ initialViewMode }: { initialViewMode?: 'default' | 'locality' }) {
  return (
    <div className="absolute inset-0">
      <GraphViewer initialViewMode={initialViewMode} />
    </div>
  );
}


