import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Containers use standalone output; Vercel handles its own dependency tracing.
  output: process.env.VERCEL ? undefined : "standalone",
  // exceljs is only used by the offline ETL script, never at request time.
  // Keeping it external stops the bundler from trying to trace it into the app.
  serverExternalPackages: ["exceljs", "@prisma/adapter-pg", "pg"],
};

export default nextConfig;
