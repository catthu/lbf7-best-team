export const metadata = {
  title: "Write-up",
  description:
    "Narrative walk-through of the Baker Lab protein–protein interaction visualization and key biological observations.",
};

import Content from "@/app/write-up/content";

export default function WriteUpPage() {
  return (
    <div className="writeup mx-auto max-w-3xl px-4 py-8 prose prose-gray dark:prose-invert">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Visualizing the Baker Lab's Protein-Protein Interaction Dataset</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Observations we captured when building and exploring the visualization.
        </p>
      </header>
      <Content />
    </div>
  );
}


