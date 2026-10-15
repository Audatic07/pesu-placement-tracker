import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";

/** Verify the session signature before routing. Database authorization lives in lib/auth/rbac.ts. */

const PUBLIC_PATHS = ["/login", "/api/health", "/api/data-version", "/overview", "/analysis", "/companies", "/calendar"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname === "/" ||
    PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") {
      loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    }
    const response = NextResponse.redirect(loginUrl);
    // Clear a token that failed verification so the browser stops sending it.
    if (token) response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except Next.js internals and static assets. Note this
     * deliberately includes API routes.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
