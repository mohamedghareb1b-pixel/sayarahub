import { NextRequest, NextResponse } from "next/server";

/** يحمي كل مسارات /admin بـ Basic Auth بسيطة (يوزر + باسورد من .env).
 * لو ADMIN_USERNAME / ADMIN_PASSWORD مش متظبطين في .env، الحماية بتتوقف
 * تلقائياً (مفيد وقت التطوير المحلي) — لازم تتظبط قبل أي نشر فعلي. */
export function middleware(req: NextRequest) {
  const user = process.env.ADMIN_USERNAME;
  const pass = process.env.ADMIN_PASSWORD;

  if (!user || !pass) {
    return NextResponse.next();
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const [scheme, encoded] = authHeader.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = atob(encoded);
      const [reqUser, reqPass] = decoded.split(":");
      if (reqUser === user && reqPass === pass) {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="SayaraHub Admin"' },
  });
}

export const config = {
  matcher: ["/admin/:path*"],
};
