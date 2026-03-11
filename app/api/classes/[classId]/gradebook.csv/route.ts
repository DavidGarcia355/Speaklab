import { requireTeacherEmail } from "@/lib/authz";
import { findClassById, listGradebookRowsByClassId } from "@/lib/db";
import { withApiHandler } from "@/lib/http";
import { enforceGradebookRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

function escapeCsv(value: string) {
  const neutralized = /^[=+\-@]/.test(value) ? `'${value}` : value;
  const needsQuotes =
    neutralized.includes(",") || neutralized.includes("\"") || neutralized.includes("\n");
  const escaped = neutralized.replace(/"/g, "\"\"");
  return needsQuotes ? `"${escaped}"` : escaped;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ classId: string }> }
) {
  return withApiHandler(request, async () => {
    const teacherEmail = await requireTeacherEmail();
    await enforceGradebookRateLimit(teacherEmail);

    const { classId } = await context.params;
    const found = await findClassById(classId, teacherEmail);
    if (!found) {
      return new Response("Class not found.", { status: 404 });
    }

    const rows = await listGradebookRowsByClassId(classId, teacherEmail);
    const header = ["Student Name", "Student Email", "Assignment", "Grade", "Feedback", "Submitted At"];
    const csvLines = [header.join(",")];

    for (const row of rows) {
      csvLines.push(
        [
          escapeCsv(row.studentName),
          escapeCsv(row.studentEmail),
          escapeCsv(row.assignmentTitle),
          row.grade === null ? "" : String(row.grade),
          escapeCsv(row.feedback),
          escapeCsv(new Date(row.submittedAt).toISOString()),
        ].join(",")
      );
    }

    const filename = `gradebook-${found.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    return new Response(`\uFEFF${csvLines.join("\n")}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
