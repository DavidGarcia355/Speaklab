import { NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";

export async function GET() {
  const apiKey = process.env.RESEND_API_KEY?.trim() || "";
  if (!apiKey) {
    return NextResponse.json({ ok: false, reason: "missing_api_key" }, { status: 503 });
  }

  const resend = new Resend(apiKey);
  const { data, error } = await resend.domains.list();

  if (error) {
    return NextResponse.json({ ok: false, reason: "resend_error", message: error.message }, { status: 502 });
  }

  const domains = data?.data ?? [];
  const domain = domains.find((item) => item.name === "tryhabla.com");

  if (!domain) {
    return NextResponse.json({ ok: false, reason: "domain_not_found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: domain.status === "verified" && domain.capabilities?.sending === "enabled",
    name: domain.name,
    status: domain.status,
    sending: domain.capabilities?.sending ?? null,
    receiving: domain.capabilities?.receiving ?? null,
  });
}
