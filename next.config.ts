import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /*
   * `standalone` emits .next/standalone carrying only the traced dependencies,
   * so the runtime container does not ship node_modules. The Dockerfile depends
   * on it, and so does any self-hosted deploy.
   *
   * Vercel must NOT get it. Vercel does its own dependency tracing after the
   * build and reads .next/next-server.js.nft.json, which a standalone build
   * does not write at that path. The result is a build that compiles cleanly,
   * then fails in Vercel's onBuildComplete step with an ENOENT naming a file
   * nobody in this repository asked for:
   *
   *   Error: ENOENT: no such file or directory, open
   *   '/vercel/path0/.next/next-server.js.nft.json'
   *
   * VERCEL=1 is set for every build on that platform.
   */
  output: process.env.VERCEL ? undefined : "standalone",
  // exceljs is only used by the offline ETL script, never at request time.
  // Keeping it external stops the bundler from trying to trace it into the app.
  serverExternalPackages: ["exceljs", "@prisma/adapter-pg", "pg"],
};

export default nextConfig;
