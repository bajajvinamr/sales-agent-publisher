import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PREFIXES = [
  "/api/health",
  "/api/cron/",
  "/api/sheet-sync/",
  "/_next/",
  "/favicon.ico",
  "/icon.svg",
];

function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) {
    // Still iterate over a to avoid leaking length via timing
    let diff = 0;
    for (let i = 0; i < aBytes.length; i++) {
      diff |= aBytes[i] ^ (bBytes[i % bBytes.length] ?? 0);
    }
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

export function middleware(req: NextRequest) {
  const appPassword = process.env.APP_PASSWORD;

  if (!appPassword) {
    console.warn(
      "[middleware] APP_PASSWORD is not set — skipping auth (dev mode)"
    );
    return NextResponse.next();
  }

  const pathname = req.nextUrl.pathname;

  const isPublic = PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix)
  );

  if (isPublic) {
    return NextResponse.next();
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Basic\s+(.+)$/i);

  if (match) {
    const decoded = Buffer.from(match[1], "base64").toString("utf-8");
    // Format is "username:password" — we only validate the password portion
    const colonIndex = decoded.indexOf(":");
    const password = colonIndex >= 0 ? decoded.slice(colonIndex + 1) : decoded;

    if (timingSafeEqual(password, appPassword)) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Sales Tracker"',
    },
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
