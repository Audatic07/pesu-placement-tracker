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
  experimental: {
    /*
     * How long the client keeps a page it has already rendered before asking
     * the server again. Every page here is dynamic, and the default for
     * dynamic pages is zero: the sidebar's Overview link re-rendered the whole
     * page on every click, including a click straight back to the page just
     * left. Thirty seconds makes a return trip instant while keeping the
     * figures fresh — a season's numbers do not change within a click.
     *
     * `static` governs the pages the sidebar prefetches in full. A prefetched
     * page is served from the cache until it is this old. A student's own
     * submission revalidates the pages it changes, so the one figure a person
     * is waiting to see is never the stale one.
     */
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
