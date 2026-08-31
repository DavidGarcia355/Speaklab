import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";
import PageTitle from "@/app/components/PageTitle";
import { requireAdminEmail } from "@/lib/admin";
import DeleteFeedbackButton from "./DeleteFeedbackButton";
import TeacherPaidToggle from "./TeacherPaidToggle";
import {
  isAdminAlertDeliveryEnabled,
  resolveAdminAlertsEnvironment,
} from "@/lib/admin-alerts/config";
import {
  getAdminAlertOutboxHealthForEnvironment,
  getTrackingSummary,
  listClasses,
  listFeedbackMessages,
  listRecentActivityEvents,
  listRecentTeacherActivityEvents,
  listTeacherFunnelRows,
} from "@/lib/db";

function getCurrentTimestamp() {
  return Date.now();
}

function formatDateTime(timestamp: number | null) {
  if (!timestamp) return "No activity yet";
  return new Date(timestamp).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
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
    return `${minutes}m ago`;
  }
  if (deltaMs < day) {
    const hours = Math.floor(deltaMs / hour);
    return `${hours}h ago`;
  }
  const days = Math.floor(deltaMs / day);
  return `${days}d ago`;
}

function formatEventIcon(eventType: string) {
  switch (eventType) {
    case "user_signed_in":
      return "\u25CF";
    case "teacher_upgraded":
      return "\u25B2";
    case "class_created":
      return "\u25A0";
    case "assignment_created":
      return "\u25C6";
    default:
      return "\u25CB";
  }
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

function eventTone(eventType: string) {
  switch (eventType) {
    case "teacher_upgraded":
      return "event-upgrade";
    case "class_created":
      return "event-class";
    case "assignment_created":
      return "event-assignment";
    default:
      return "event-signin";
  }
}

function funnelStage(teacher: {
  classCount: number;
  assignmentCount: number;
}) {
  if (teacher.assignmentCount > 0) return { label: "Teaching", tone: "pill-success" };
  if (teacher.classCount > 0) return { label: "Activated", tone: "pill-warning" };
  return { label: "Signed up", tone: "pill-neutral" };
}

function percent(part: number, whole: number) {
  if (whole === 0) return "0";
  return Math.round((part / whole) * 100).toString();
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

  const alertEnvironment = resolveAdminAlertsEnvironment();

  const [
    summary,
    allEvents,
    teacherEvents,
    funnelRows,
    allClasses,
    feedbackMessages,
    alertHealth,
  ] = await Promise.all([
    getTrackingSummary(),
    listRecentActivityEvents(50),
    listRecentTeacherActivityEvents(30),
    listTeacherFunnelRows(),
    listClasses(),
    listFeedbackMessages(),
    getAdminAlertOutboxHealthForEnvironment(alertEnvironment),
  ]);

  const totalSubmissions = allClasses.reduce((sum, c) => sum + c.submissionCount, 0);
  const totalAssignments = allClasses.reduce((sum, c) => sum + c.assignmentCount, 0);
  const alertDeliveryEnabled = isAdminAlertDeliveryEnabled();

  const activationRate = percent(summary.activatedTeachers, summary.teacherAccounts);
  const teachingRate = percent(summary.teachingReadyTeachers, summary.teacherAccounts);

  const now = getCurrentTimestamp();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const signInsToday = allEvents.filter(
    (e) => e.eventType === "user_signed_in" && e.occurredAt > oneDayAgo
  ).length;
  const signIns7d = allEvents.filter(
    (e) => e.eventType === "user_signed_in" && e.occurredAt > sevenDaysAgo
  ).length;

  return (
    <main className="page-wrap">
      <PageTitle title="Admin Dashboard" />
      <BrandBar label="Admin" />

      <section className="admin-header">
        <div className="admin-header-copy">
          <h1 className="admin-headline">Dashboard</h1>
          <p className="meta">Founder analytics for TryHabla. Real-time teacher funnel, activity, and platform health.</p>
        </div>
        <div className="actions">
          <Link className="btn btn-ghost" href="/">Back home</Link>
        </div>
      </section>

      <section className="grid cols-4 section-gap admin-kpi-strip">
        <article className="card kpi-card kpi-hero">
          <p className="meta stat-label">Total users</p>
          <p className="stat-value">{summary.totalUsers}</p>
          <p className="meta kpi-note">All accounts</p>
        </article>
        <article className="card kpi-card">
          <p className="meta stat-label">Teacher accounts</p>
          <p className="stat-value">{summary.teacherAccounts}</p>
          <p className="meta kpi-note">{percent(summary.teacherAccounts, summary.totalUsers)}% of users</p>
        </article>
        <article className="card kpi-card kpi-warning">
          <p className="meta stat-label">With classes</p>
          <p className="stat-value">{summary.activatedTeachers}</p>
          <p className="meta kpi-note">{activationRate}% activation</p>
        </article>
        <article className="card kpi-card kpi-success">
          <p className="meta stat-label">Teaching</p>
          <p className="stat-value">{summary.teachingReadyTeachers}</p>
          <p className="meta kpi-note">{teachingRate}% teaching</p>
        </article>
      </section>

      <section className="grid cols-3 section-gap">
        <article className="card kpi-card">
          <p className="meta stat-label">Total classes</p>
          <p className="stat-value">{allClasses.length}</p>
          <p className="meta kpi-note">Active classes</p>
        </article>
        <article className="card kpi-card">
          <p className="meta stat-label">Assignments</p>
          <p className="stat-value">{totalAssignments}</p>
          <p className="meta kpi-note">Published tasks</p>
        </article>
        <article className="card kpi-card">
          <p className="meta stat-label">Submissions</p>
          <p className="stat-value">{totalSubmissions}</p>
          <p className="meta kpi-note">Student recordings</p>
        </article>
      </section>

      <section className="grid cols-2 section-gap">
        <article className="card kpi-card">
          <p className="meta stat-label">Sign-ins today</p>
          <p className="stat-value">{signInsToday}</p>
          <p className="meta kpi-note">Last 24 hours</p>
        </article>
        <article className="card kpi-card">
          <p className="meta stat-label">Sign-ins (7d)</p>
          <p className="stat-value">{signIns7d}</p>
          <p className="meta kpi-note">Last 7 days</p>
        </article>
      </section>

      <section className="card section-gap">
        <div className="admin-panel-head">
          <div>
            <h2 className="surface-title">Habla Pulse delivery health</h2>
            <p className="meta">
              Private {alertEnvironment} admin-alert outbox only. No alert payloads are shown here.
            </p>
          </div>
          <span className={`pill ${!alertDeliveryEnabled || alertHealth.dead > 0 || alertHealth.stale > 0 ? "pill-warning" : "pill-success"}`}>
            {!alertDeliveryEnabled
              ? "Delivery disabled"
              : alertHealth.dead > 0 || alertHealth.stale > 0
                ? "Needs attention"
                : "Healthy"}
          </span>
        </div>
        <div className="grid cols-4 section-gap admin-kpi-strip">
          <div className="kpi-card">
            <p className="meta stat-label">Pending</p>
            <p className="stat-value">{alertHealth.pending}</p>
          </div>
          <div className="kpi-card">
            <p className="meta stat-label">Stale over 10m</p>
            <p className="stat-value">{alertHealth.stale}</p>
          </div>
          <div className="kpi-card">
            <p className="meta stat-label">Dead-lettered</p>
            <p className="stat-value">{alertHealth.dead}</p>
          </div>
          <div className="kpi-card">
            <p className="meta stat-label">Delivered</p>
            <p className="stat-value">{alertHealth.delivered}</p>
          </div>
        </div>
        <p className="meta">
          Oldest pending: {alertHealth.oldestPendingAt
            ? formatDateTime(alertHealth.oldestPendingAt)
            : "none"}
        </p>
      </section>

      <section className="admin-funnel-visual section-gap">
        <h2 className="surface-title">Teacher funnel</h2>
        <div className="funnel-bars">
          <div className="funnel-stage">
            <div className="funnel-bar funnel-bar-full" />
            <div className="funnel-stage-info">
              <span className="funnel-stage-value">{summary.teacherAccounts}</span>
              <span className="funnel-stage-label">Signed up</span>
            </div>
          </div>
          <div className="funnel-stage">
            <div
              className="funnel-bar funnel-bar-activated"
              style={{
                width: summary.teacherAccounts > 0
                  ? `${Math.max(8, (summary.activatedTeachers / summary.teacherAccounts) * 100)}%`
                  : "8%",
              }}
            />
            <div className="funnel-stage-info">
              <span className="funnel-stage-value">{summary.activatedTeachers}</span>
              <span className="funnel-stage-label">Created class ({activationRate}%)</span>
            </div>
          </div>
          <div className="funnel-stage">
            <div
              className="funnel-bar funnel-bar-teaching"
              style={{
                width: summary.teacherAccounts > 0
                  ? `${Math.max(8, (summary.teachingReadyTeachers / summary.teacherAccounts) * 100)}%`
                  : "8%",
              }}
            />
            <div className="funnel-stage-info">
              <span className="funnel-stage-value">{summary.teachingReadyTeachers}</span>
              <span className="funnel-stage-label">Created assignment ({teachingRate}%)</span>
            </div>
          </div>
        </div>
      </section>

      <section className="workspace-split section-gap">
        <article className="card panel-subtle admin-activity-panel">
          <div className="admin-panel-head">
            <h2 className="surface-title">Live activity</h2>
            <span className="pill pill-subtle">{allEvents.length} events</span>
          </div>
          {allEvents.length === 0 ? (
            <p className="empty">No activity tracked yet.</p>
          ) : (
            <div className="admin-activity-feed">
              {allEvents.map((event) => (
                <div key={event.id} className={`admin-event-row ${eventTone(event.eventType)}`}>
                  <span className="admin-event-icon">{formatEventIcon(event.eventType)}</span>
                  <div className="admin-event-body">
                    <p className="admin-event-title">{event.email}</p>
                    <p className="admin-event-action">{formatEventLabel(event.eventType)}</p>
                    {event.metadata ? (
                      <p className="admin-event-meta">
                        {Object.entries(event.metadata)
                          .filter(([key]) => key !== "isFirstClass" && key !== "isFirstAssignment")
                          .map(([key, value]) => `${key}: ${String(value)}`)
                          .join(" \u00B7 ")}
                      </p>
                    ) : null}
                  </div>
                  <span className="admin-event-time" title={formatDateTime(event.occurredAt)}>
                    {formatTimeAgo(event.occurredAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>

        <div className="admin-right-stack">
          <article className="card admin-teacher-actions-panel">
            <div className="admin-panel-head">
              <h2 className="surface-title">Teacher actions</h2>
              <span className="pill pill-subtle">{teacherEvents.length} events</span>
            </div>
            {teacherEvents.length === 0 ? (
              <p className="empty">No teacher actions yet.</p>
            ) : (
              <div className="admin-activity-feed admin-activity-feed-compact">
                {teacherEvents.slice(0, 15).map((event) => (
                  <div key={event.id} className={`admin-event-row admin-event-row-compact ${eventTone(event.eventType)}`}>
                    <span className="admin-event-icon">{formatEventIcon(event.eventType)}</span>
                    <div className="admin-event-body">
                      <p className="admin-event-title">{event.email}</p>
                      <p className="admin-event-action">{formatEventLabel(event.eventType)}</p>
                    </div>
                    <span className="admin-event-time" title={formatDateTime(event.occurredAt)}>
                      {formatTimeAgo(event.occurredAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="card panel-subtle">
            <div className="admin-panel-head">
              <h2 className="surface-title">Top classes</h2>
              <span className="pill pill-subtle">{allClasses.length} total</span>
            </div>
            {allClasses.length === 0 ? (
              <p className="empty">No classes yet.</p>
            ) : (
              <div className="admin-class-list">
                {allClasses.slice(0, 8).map((cls) => (
                  <div key={cls.id} className="admin-class-item">
                    <div className="admin-class-info">
                      <p className="admin-class-name">{cls.name}</p>
                      <p className="admin-class-owner">{cls.ownerEmail || "No owner"}</p>
                    </div>
                    <div className="admin-class-stats">
                      <span className="pill pill-subtle">{cls.assignmentCount} assign.</span>
                      <span className={`pill ${cls.submissionCount > 0 ? "pill-success" : "pill-neutral"}`}>
                        {cls.submissionCount} subs
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>
      </section>

      <section className="card section-gap">
        <div className="admin-panel-head">
          <h2 className="surface-title">Contact messages</h2>
          <span className="pill pill-subtle">{feedbackMessages.length} messages</span>
        </div>
        {feedbackMessages.length === 0 ? (
          <p className="empty">No messages yet.</p>
        ) : (
          <div className="admin-feedback-list">
            {feedbackMessages.map((msg) => (
              <div key={msg.id} className="admin-feedback-item">
                <div className="admin-feedback-header">
                  <div>
                    <p className="admin-event-title">{msg.name || "(no name)"}</p>
                    <p className="meta">{msg.email}{msg.school ? ` · ${msg.school}` : ""}{msg.role ? ` · ${msg.role}` : ""}</p>
                  </div>
                  <div className="actions">
                    <span className="admin-event-time">{formatDateTime(msg.createdAt)}</span>
                    <DeleteFeedbackButton messageId={msg.id} />
                  </div>
                </div>
                <p className="admin-feedback-body">{msg.message}</p>
                {msg.context ? (
                  <p className="meta">
                    Access context: {msg.context.source} · {msg.context.authErrorCode || "no error code"}
                    {" · "}
                    {msg.context.browserCategory} · {msg.context.route}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card section-gap">
        <div className="admin-panel-head">
          <h2 className="surface-title">Teacher roster</h2>
          <span className="pill pill-subtle">{funnelRows.length} teachers</span>
        </div>
        {funnelRows.length === 0 ? (
          <p className="empty">No teachers yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table admin-roster-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Stage</th>
                  <th>Joined</th>
                  <th>Classes</th>
                  <th>Assignments</th>
                  <th>Submissions</th>
                  <th>Last active</th>
                  <th>AI grading</th>
                </tr>
              </thead>
              <tbody>
                {funnelRows.map((teacher) => {
                  const stage = funnelStage(teacher);
                  return (
                    <tr key={teacher.email} className="admin-roster-row">
                      <td className="admin-roster-email">{teacher.email}</td>
                      <td>
                        <span className={`pill ${stage.tone}`}>{stage.label}</span>
                      </td>
                      <td className="admin-roster-date">{formatDateTime(teacher.joinedAt)}</td>
                      <td className="admin-roster-num">{teacher.classCount}</td>
                      <td className="admin-roster-num">{teacher.assignmentCount}</td>
                      <td className="admin-roster-num">{teacher.submissionCount}</td>
                      <td className="admin-roster-date">
                        {teacher.latestActivityAt
                          ? formatTimeAgo(teacher.latestActivityAt)
                          : "Never"}
                      </td>
                      <td>
                        <TeacherPaidToggle email={teacher.email} isPaid={teacher.isPaid} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
