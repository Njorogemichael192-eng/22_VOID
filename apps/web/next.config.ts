import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@22void/db", "@22void/domain", "@22void/shared"],
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
};

export default nextConfig;