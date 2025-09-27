import GraphClient from "../GraphClient";

export default function LocalityPage() {
  return (
    <div className="w-full h-[calc(100vh-48px)] relative">
      <GraphClient initialViewMode="locality" />
    </div>
  );
}


