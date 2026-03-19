import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";
import PageTitle from "@/app/components/PageTitle";
import { requireAdminEmail } from "@/lib/admin";
import { getTrackingSummary, listRecentActivityEvents, listTeacherFunnelRows } from "@/lib/db";

function formatDateTime(timestamp: number | null) {
  if (!timestamp) return "No activity yet";
  return new Date(timestamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimeAgo(timestamp: number) {
  const deltaMs = Math.max(0, Date.now() - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (deltaMs < minute) return "just now";
  if (deltaMs < hour) {
    const minutes = Math.floor(deltaMs / minute);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (deltaMs < day) {
    const hours = Math.floor(deltaMs / hour);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(deltaMs / day);
  return `${days} day${days === 1 ? "" : "s"} ago`;
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
    listRecentActivityEvents(30),
    listTeacherFunnelRows(),
  ]);

  return (
    <main className="page-wrap">
      <PageTitle title="Admin Dashboard" />
      <BrandBar label="Admin Dashboard" />
      <p className="meta page-intent">Founder-only tracking for teacher signups, activation, and classroom activity.</p>

      <section className="grid cols-2 section-gap admin-metrics-grid">
        <article className="card kpi-card">
          <p className="meta stat-label">Total users</p>
          <p className="stat-value">{summary.totalUsers}</p>
          <p className="meta kpi-note">All signed-in accounts</p>
        </article>
        <article className="card kpi-card">
          <p className="meta stat-label">Teacher accounts</p>
          <p className="stat-value">{summary.teacherAccounts}</p>
          <p className="meta kpi-note">Teacher signups</p>
        </article>
        <article className="card kpi-card kpi-warning">
          <p className="meta stat-label">Teachers with classes</p>
          <p className="stat-value">{summary.activatedTeachers}</p>
          <p className="meta kpi-note">Teachers with at least one class</p>
        </article>
        <article className="card kpi-card kpi-success">
          <p className="meta stat-label">Teachers with assignments</p>
          <p className="stat-value">{summary.teachingReadyTeachers}</p>
          <p className="meta kpi-note">Teachers with at least one assignment</p>
        </article>
      </section>

      <section className="workspace-split section-gap">
        <article className="card panel-subtle">
          <h2 className="surface-title">Recent activity</h2>
          {recentEvents.length === 0 ? (
            <p className="empty">No activity tracked yet.</p>
          ) : (
            <div className="grid section-gap activity-feed">
              {recentEvents.map((event) => (
                <div key={event.id} className="card panel-subtle activity-feed-item">
                  <div className="dense-row">
                    <div>
                      <p className="label activity-feed-title">{event.email}</p>
                      <p className="meta">{formatEventLabel(event.eventType)}</p>
                    </div>
                    <p className="meta" title={formatDateTime(event.occurredAt)}>
                      {formatTimeAgo(event.occurredAt)}
                    </p>
                  </div>
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
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Joined</th>
                    <th>Role</th>
                    <th>Classes</th>
                    <th>Assignments</th>
                    <th>Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {funnelRows.map((teacher) => (
                    <tr key={teacher.email}>
                      <td>{teacher.email}</td>
                      <td>{formatDateTime(teacher.joinedAt)}</td>
                      <td>
                        <span
                          className={`pill ${
                            teacher.role === "teacher" ? "pill-success" : "pill-neutral"
                          }`}
                        >
                          {teacher.role}
                        </span>
                      </td>
                      <td>{teacher.classCount}</td>
                      <td>{teacher.assignmentCount}</td>
                      <td>
                        {teacher.latestActivityAt
                          ? formatTimeAgo(teacher.latestActivityAt)
                          : "No activity yet"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
