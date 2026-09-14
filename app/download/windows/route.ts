import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
const installer = "/downloads/Crew.Ship_0.5.27_x64-setup.exe";

export function GET(request: Request) {
  return NextResponse.redirect(new URL(installer, request.url), 307);
}
