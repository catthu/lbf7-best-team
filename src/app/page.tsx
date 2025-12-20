import type { Metadata } from "next";
import GraphClient from "./GraphClient";

export const metadata: Metadata = {
  title: "Global Graph",
  description:
    "Explore the full Baker Lab protein–protein interaction network with an interactive, locality-aware graph visualization.",
};

export default function Home() {
  return (
    <div className="w-screen h-screen">
      <GraphClient />
    </div>
  );
}
