import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";
import PageTitle from "@/app/components/PageTitle";
import { requireAdminEmail } from "@/lib/admin";
import { getTrackingSummary, listRecentTeacherActivityEvents, listTeacherFunnelRows } from "@/lib/db";

function formatDateTime(timestamp: number | null) {
  if (!timestamp) return "No activity yet";
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatEventLabel(eventType: string) {
  switch (eventType) {
    case "user_signed_in":
      return "Signed in";
    case "teacher_upgraded":
      return "Upgraded to teacher";
    case "class_created":
      return "Created class";
    case "assignment_created":
      return "Created assignment";
    default:
      return eventType;
  }
}

export default async function AdminPage() {
  const { allowed } = await requireAdminEmail();

  if (!allowed) {
    return (
      <main className="page-wrap">
        <PageTitle title="Admin" />
        <BrandBar label="Admin" />
        <section className="card">
          <h1 className="surface-title">Access denied</h1>
          <p className="empty">This internal tracking page is only available to the founder account.</p>
          <div className="actions">
            <Link className="btn btn-ghost" href="/">
              Back home
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const [summary, recentEvents, funnelRows] = await Promise.all([
    getTrackingSummary(),
    listRecentTeacherActivityEvents(30),
    listTeacherFunnelRows(),
  ]);

  return (
    <main className="page-wrap">
      <PageTitle title="Admin Dashboard" />
      <BrandBar label="Admin Dashboard" />
      <p className="meta page-intent">Founder-only tracking for teacher signups, activation, and classroom activity.</p>

      <section className="grid cols-3 section-gap">
        <article className="card kpi-card">
          <p className="meta stat-label">Teachers</p>
          <p className="stat-value">{summary.teacherAccounts}</p>
          <p className="meta kpi-note">Teacher signups</p>
        </article>
        <article className="card kpi-card kpi-warning">
          <p className="meta stat-label">Activated</p>
          <p className="stat-value">{summary.activatedTeachers}</p>
          <p className="meta kpi-note">Teachers with at least one class</p>
        </article>
        <article className="card kpi-card kpi-success">
          <p className="meta stat-label">Teaching-ready</p>
          <p className="stat-value">{summary.teachingReadyTeachers}</p>
          <p className="meta kpi-note">Teachers with at least one assignment</p>
        </article>
      </section>

      <section className="workspace-split section-gap">
        <article className="card panel-subtle">
          <h2 className="surface-title">Recent teacher activity</h2>
          {recentEvents.length === 0 ? (
            <p className="empty">No teacher activity tracked yet.</p>
          ) : (
            <div className="grid section-gap">
              {recentEvents.map((event) => (
                <div key={event.id} className="card panel-subtle">
                  <p className="label" style={{ marginBottom: 4 }}>{formatEventLabel(event.eventType)}</p>
                  <p className="meta">{event.email}</p>
                  <p className="meta">{formatDateTime(event.occurredAt)}</p>
                  {event.metadata ? (
                    <p className="meta">
                      {Object.entries(event.metadata)
                        .map(([key, value]) => `${key}: ${String(value)}`)
                        .join(" | ")}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="card">
          <h2 className="surface-title">Teacher funnel</h2>
          {funnelRows.length === 0 ? (
            <p className="empty">No users yet.</p>
          ) : (
            <div className="grid section-gap">
              {funnelRows.map((teacher) => (
                <div key={teacher.email} className="card panel-subtle">
                  <div className="dense-row">
                    <div>
                      <p className="label" style={{ marginBottom: 4 }}>{teacher.email}</p>
                      <p className="meta">Joined {formatDateTime(teacher.joinedAt)}</p>
                    </div>
                    <span className={`pill ${teacher.role === "teacher" ? "pill-success" : "pill-neutral"}`}>
                      {teacher.role}
                    </span>
                  </div>
                  <div className="class-link-pills">
                    <span className="pill pill-subtle">{teacher.classCount} classes</span>
                    <span className="pill pill-subtle">{teacher.assignmentCount} assignments</span>
                    <span
                      className={`pill ${
                        teacher.assignmentCount > 0
                          ? "pill-success"
                          : teacher.classCount > 0
                            ? "pill-warning"
                            : "pill-neutral"
                      }`}
                    >
                      {teacher.assignmentCount > 0
                        ? "Teaching-ready"
                        : teacher.classCount > 0
                          ? "Activated"
                          : "Signed up"}
                    </span>
                  </div>
                  <p className="meta">Latest activity: {formatDateTime(teacher.latestActivityAt)}</p>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
