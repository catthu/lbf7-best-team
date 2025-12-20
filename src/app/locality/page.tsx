import type { Metadata } from "next";
import GraphClient from "../GraphClient";

export const metadata: Metadata = {
  title: "Locality View",
  description:
    "Focus on local neighborhoods in the Baker Lab protein–protein interaction network using locality-based layouts.",
};

export default function LocalityPage() {
  return (
    <div className="w-full h-[calc(100vh-48px)] relative">
      <GraphClient initialViewMode="locality" />
    </div>
  );
}


