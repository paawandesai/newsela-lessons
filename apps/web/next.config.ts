import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@nl/db", "@nl/schema"],
  poweredByHeader: false,
};

export default config;
