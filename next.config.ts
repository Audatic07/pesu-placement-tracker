import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emits .next/standalone with only the traced dependencies, so the runtime
  // container does not carry node_modules. Platforms that build Next natively
  // (Vercel) ignore this; everything else needs it. See DEPLOYMENT.md.
  output: "standalone",
  // exceljs is only used by the offline ETL script, never at request time.
  // Keeping it external stops the bundler from trying to trace it into the app.
  serverExternalPackages: ["exceljs", "@prisma/adapter-pg", "pg"],
};

export default nextConfig;
