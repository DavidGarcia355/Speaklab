import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireTeacherEmail: vi.fn(),
  findClassById: vi.fn(),
  listRosterByClassId: vi.fn(),
  upsertRosterEntry: vi.fn(),
  deleteRosterEntry: vi.fn(),
  bulkUpsertRosterEntries: vi.fn(),
  parseOrThrow400: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  requireTeacherEmail: mocks.requireTeacherEmail,
}));

vi.mock("@/lib/db", () => ({
  findClassById: mocks.findClassById,
  listRosterByClassId: mocks.listRosterByClassId,
  upsertRosterEntry: mocks.upsertRosterEntry,
  deleteRosterEntry: mocks.deleteRosterEntry,
  bulkUpsertRosterEntries: mocks.bulkUpsertRosterEntries,
}));

vi.mock("@/lib/validation", () => ({
  parseOrThrow400: mocks.parseOrThrow400,
  rosterAddSchema: {},
  rosterBulkSchema: {},
}));

vi.mock("@/lib/http", async () => {
  class MockHttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    HttpError: MockHttpError,
    withApiHandler: async (_req: Request, handler: () => Promise<Response>) => {
      try {
        return await handler();
      } catch (error) {
        // Handle both HttpError and plain errors with a status property
        if (error instanceof Error && "status" in error) {
          return Response.json({ error: error.message }, { status: (error as { status: number }).status });
        }
        throw error;
      }
    },
  };
});

const TEACHER = "teacher@school.edu";
const CLASS_ID = "class_1";
const STUDENT_EMAIL = "student@school.edu";
const ROSTER_ENTRY = {
  id: "roster_1",
  classId: CLASS_ID,
  studentEmail: STUDENT_EMAIL,
  studentName: "Ana García",
  addedAt: 1000,
  addedBy: "teacher" as const,
};

function makeCtx(params: Record<string, string>) {
  return { params: Promise.resolve(params) } as never;
}

function makeRequest(method = "GET", body?: unknown) {
  const hasBody = body !== undefined;
  return new Request(`http://localhost/api/classes/${CLASS_ID}/roster`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(hasBody ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  mocks.requireTeacherEmail.mockResolvedValue(TEACHER);
  mocks.findClassById.mockResolvedValue({ id: CLASS_ID, name: "Spanish 1", ownerEmail: TEACHER });
  mocks.listRosterByClassId.mockResolvedValue([ROSTER_ENTRY]);
  mocks.upsertRosterEntry.mockResolvedValue(true);
  mocks.deleteRosterEntry.mockResolvedValue(true);
  mocks.bulkUpsertRosterEntries.mockResolvedValue({ added: 2, skipped: 0 });
  mocks.parseOrThrow400.mockImplementation((_schema: unknown, input: unknown) => input);
});

// ─── GET /roster ───────────────────────────────────────────────────────────────

describe("GET /api/classes/[classId]/roster", () => {
  it("returns the roster for a valid class", async () => {
    const { GET } = await import("@/app/api/classes/[classId]/roster/route");
    const response = await GET(makeRequest(), makeCtx({ classId: CLASS_ID }));
    const data = (await response.json()) as { items: typeof ROSTER_ENTRY[] };

    expect(response.status).toBe(200);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].studentEmail).toBe(STUDENT_EMAIL);
  });

  it("returns 404 when class does not belong to the teacher", async () => {
    mocks.findClassById.mockResolvedValue(null);
    const { GET } = await import("@/app/api/classes/[classId]/roster/route");
    const response = await GET(makeRequest(), makeCtx({ classId: CLASS_ID }));

    expect(response.status).toBe(404);
  });
});

// ─── POST /roster ──────────────────────────────────────────────────────────────

describe("POST /api/classes/[classId]/roster", () => {
  it("adds a student and returns updated roster with 201", async () => {
    mocks.parseOrThrow400.mockReturnValue({ name: "Ana García", email: STUDENT_EMAIL });
    const { POST } = await import("@/app/api/classes/[classId]/roster/route");
    const response = await POST(
      makeRequest("POST", { name: "Ana García", email: STUDENT_EMAIL }),
      makeCtx({ classId: CLASS_ID })
    );
    const data = (await response.json()) as { items: unknown[] };

    expect(response.status).toBe(201);
    expect(mocks.upsertRosterEntry).toHaveBeenCalledWith(
      expect.objectContaining({ classId: CLASS_ID, studentEmail: STUDENT_EMAIL, addedBy: "teacher" })
    );
    expect(data.items).toHaveLength(1);
  });

  it("returns 409 when student is already on the roster", async () => {
    mocks.parseOrThrow400.mockReturnValue({ name: "Ana García", email: STUDENT_EMAIL });
    mocks.upsertRosterEntry.mockResolvedValue(false);
    const { POST } = await import("@/app/api/classes/[classId]/roster/route");
    const response = await POST(
      makeRequest("POST", { name: "Ana García", email: STUDENT_EMAIL }),
      makeCtx({ classId: CLASS_ID })
    );
    const data = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(data.error).toContain("already on the roster");
  });

  it("returns 404 when class is not found", async () => {
    mocks.findClassById.mockResolvedValue(null);
    const { POST } = await import("@/app/api/classes/[classId]/roster/route");
    const response = await POST(
      makeRequest("POST", { name: "Ana", email: STUDENT_EMAIL }),
      makeCtx({ classId: CLASS_ID })
    );

    expect(response.status).toBe(404);
    expect(mocks.upsertRosterEntry).not.toHaveBeenCalled();
  });
});

// ─── DELETE /roster/[studentEmail] ─────────────────────────────────────────────

describe("DELETE /api/classes/[classId]/roster/[studentEmail]", () => {
  it("removes the student and returns ok", async () => {
    const { DELETE } = await import("@/app/api/classes/[classId]/roster/[studentEmail]/route");
    const response = await DELETE(
      makeRequest("DELETE"),
      makeCtx({ classId: CLASS_ID, studentEmail: encodeURIComponent(STUDENT_EMAIL) })
    );
    const data = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(mocks.deleteRosterEntry).toHaveBeenCalledWith(CLASS_ID, STUDENT_EMAIL, TEACHER);
  });

  it("returns 404 when class is not found", async () => {
    mocks.findClassById.mockResolvedValue(null);
    const { DELETE } = await import("@/app/api/classes/[classId]/roster/[studentEmail]/route");
    const response = await DELETE(
      makeRequest("DELETE"),
      makeCtx({ classId: CLASS_ID, studentEmail: encodeURIComponent(STUDENT_EMAIL) })
    );

    expect(response.status).toBe(404);
    expect(mocks.deleteRosterEntry).not.toHaveBeenCalled();
  });

  it("returns 404 when student is not in roster", async () => {
    mocks.deleteRosterEntry.mockResolvedValue(false);
    const { DELETE } = await import("@/app/api/classes/[classId]/roster/[studentEmail]/route");
    const response = await DELETE(
      makeRequest("DELETE"),
      makeCtx({ classId: CLASS_ID, studentEmail: encodeURIComponent(STUDENT_EMAIL) })
    );
    const data = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(data.error).toContain("not found in roster");
  });

  it("URL-decodes the student email param", async () => {
    const emailWithPlus = "student+tag@school.edu";
    const { DELETE } = await import("@/app/api/classes/[classId]/roster/[studentEmail]/route");
    await DELETE(
      makeRequest("DELETE"),
      makeCtx({ classId: CLASS_ID, studentEmail: encodeURIComponent(emailWithPlus) })
    );

    expect(mocks.deleteRosterEntry).toHaveBeenCalledWith(CLASS_ID, emailWithPlus, TEACHER);
  });
});

// ─── POST /roster/bulk ─────────────────────────────────────────────────────────

describe("POST /api/classes/[classId]/roster/bulk", () => {
  const BULK_STUDENTS = [
    { name: "Ana García", email: "ana@school.edu" },
    { name: "Ben Smith", email: "ben@school.edu" },
    { name: "Carlos Ruiz", email: "carlos@school.edu" },
  ];

  it("imports students and returns added/skipped counts", async () => {
    mocks.bulkUpsertRosterEntries.mockResolvedValue({ added: 2, skipped: 1 });
    mocks.parseOrThrow400.mockReturnValue({ students: BULK_STUDENTS });

    const { POST } = await import("@/app/api/classes/[classId]/roster/bulk/route");
    const response = await POST(
      makeRequest("POST", { students: BULK_STUDENTS }),
      makeCtx({ classId: CLASS_ID })
    );
    const data = (await response.json()) as { added: number; skipped: number };

    expect(response.status).toBe(201);
    expect(data.added).toBe(2);
    expect(data.skipped).toBe(1);
    expect(mocks.bulkUpsertRosterEntries).toHaveBeenCalledWith(
      CLASS_ID,
      expect.arrayContaining([expect.objectContaining({ studentEmail: "ana@school.edu" })])
    );
  });

  it("returns 404 when class is not found", async () => {
    mocks.findClassById.mockResolvedValue(null);
    mocks.parseOrThrow400.mockReturnValue({ students: BULK_STUDENTS });

    const { POST } = await import("@/app/api/classes/[classId]/roster/bulk/route");
    const response = await POST(
      makeRequest("POST", { students: BULK_STUDENTS }),
      makeCtx({ classId: CLASS_ID })
    );

    expect(response.status).toBe(404);
    expect(mocks.bulkUpsertRosterEntries).not.toHaveBeenCalled();
  });

  it("blocks unauthenticated access", async () => {
    const authError = Object.assign(new Error("You'll need to sign in first."), { status: 401 });
    mocks.requireTeacherEmail.mockRejectedValue(authError);

    const { POST } = await import("@/app/api/classes/[classId]/roster/bulk/route");
    const response = await POST(
      makeRequest("POST", { students: BULK_STUDENTS }),
      makeCtx({ classId: CLASS_ID })
    );

    expect(response.status).toBe(401);
    expect(mocks.bulkUpsertRosterEntries).not.toHaveBeenCalled();
  });
});
