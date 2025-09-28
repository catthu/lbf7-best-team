import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable React 18 dev double-invocation of effects to prevent duplicate graph builds
  reactStrictMode: false,
};

export default nextConfig;
