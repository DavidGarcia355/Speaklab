import "server-only";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

export class HttpError extends Error {
  status: number;
  fieldErrors?: Record<string, string[]>;

  constructor(status: number, message: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function enforceCors(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;

  const env = getEnv();
  const normalizedOrigin = origin.endsWith("/") ? origin.slice(0, -1) : origin;
  const allowed = new Set([env.productionOrigin]);

  if (env.isDev) {
    allowed.add("http://localhost:3000");
    allowed.add("http://127.0.0.1:3000");
  }

  if (!allowed.has(normalizedOrigin)) {
    throw new HttpError(403, "Cross-origin requests are not allowed.");
  }
}

type Handler = () => Promise<Response>;

export async function withApiHandler(request: Request, handler: Handler) {
  try {
    getEnv();
    enforceCors(request);
    return await handler();
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json(
        error.fieldErrors
          ? { error: error.message, fieldErrors: error.fieldErrors }
          : { error: error.message },
        { status: error.status }
      );
    }

    console.error("Unhandled API error", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}

