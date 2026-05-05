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
    if (process.env.NODE_ENV === 'production') {
      return new NextResponse('Service Unavailable: APP_PASSWORD not configured', { status: 503 })
    }
    console.warn("[middleware] APP_PASSWORD is not set — skipping auth (dev mode)");
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

  // HTML body (not text/plain) so mobile browsers render the auth challenge
  // inline. With text/plain, iOS Safari + some Android browsers turn the
  // unknown-extension URL (/connect, /report, etc.) into a download named
  // `connect.txt` when the user dismisses or doesn't see the Basic prompt.
  const body = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in — Sales Tracker</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#18181b;color:#e4e4e7;margin:0;padding:2rem;display:flex;align-items:center;justify-content:center;min-height:100vh}
.box{max-width:24rem;text-align:center}
h1{margin:0 0 0.5rem;font-size:1.25rem}
p{margin:0;color:#a1a1aa;font-size:0.875rem;line-height:1.5}
</style>
</head>
<body>
<div class="box">
<h1>Sales Tracker</h1>
<p>This area requires the team password. Your browser should prompt you for it — if not, refresh the page.</p>
</div>
</body>
</html>`
  return new NextResponse(body, {
    status: 401,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "WWW-Authenticate": 'Basic realm="Sales Tracker"',
    },
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
