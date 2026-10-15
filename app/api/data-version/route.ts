import { getAnalyticsVersion } from "@/lib/analytics/batches";

// This endpoint contains only a revision marker, never student or offer data.
export async function GET(request: Request) {
  const version = await getAnalyticsVersion();
  const etag = `"${version}"`;
  const headers = {
    ETag: etag,
    "Cache-Control": "public, max-age=0, s-maxage=5, must-revalidate",
  };
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return Response.json({ version }, { headers });
}
