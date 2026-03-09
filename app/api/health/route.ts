import { NextResponse } from "next/server";
import { listClasses } from "@/lib/db";
import { withApiHandler } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiHandler(request, async () => {
    await listClasses();
    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });
}
