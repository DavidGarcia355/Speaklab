import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockListClasses } = vi.hoisted(() => ({
  mockListClasses: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  listClasses: mockListClasses,
}));

vi.mock("@/lib/http", () => ({
  withApiHandler: async (_request: Request, handler: () => Promise<Response>) => handler(),
}));

import { GET } from "@/app/api/health/route";

describe("health route", () => {
  beforeEach(() => {
    mockListClasses.mockResolvedValue([]);
  });

  it("reports healthy when the database is reachable", async () => {
    const response = await GET(new Request("http://localhost/api/health"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      timestamp: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(mockListClasses).toHaveBeenCalledOnce();
  });

  it("reports a safe degraded response when the database is unavailable", async () => {
    mockListClasses.mockRejectedValueOnce(
      new Error("database connection failed for postgres://internal-user:secret@private-host")
    );

    const response = await GET(new Request("http://localhost/api/health"));
    const bodyText = await response.text();
    const body = JSON.parse(bodyText);

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      status: "degraded",
      timestamp: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(bodyText).not.toContain("postgres://");
    expect(bodyText).not.toContain("secret");
    expect(bodyText).not.toContain("private-host");
  });
});
