import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: ["172.30.1.95"],
};

export default nextConfig;
