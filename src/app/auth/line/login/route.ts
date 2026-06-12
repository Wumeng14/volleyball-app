import { buildLineAuthUrl } from "@/lib/line";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const state = crypto.randomUUID();
  const next = request.nextUrl.searchParams.get("next") ?? "/";

  const cookieStore = await cookies();
  cookieStore.set("line_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  cookieStore.set("line_oauth_next", next, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });

  return NextResponse.redirect(buildLineAuthUrl(state));
}
