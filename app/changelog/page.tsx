import type { Metadata } from "next";
import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";

export const metadata: Metadata = {
  title: "What's New - Habla",
  description: "Recent updates, bug fixes, and improvements to Habla.",
};

const RELEASES = [
  {
    date: "March 31, 2026",
    items: [
      {
        type: "new" as const,
        text: "Download student recordings directly from the review page. Files save with the student's name and correct audio format (webm, mp4, etc.).",
      },
      {
        type: "new" as const,
        text: "Expanded playback speeds on all recordings: 0.5×, 1×, 1.5×, 2×, and 3×.",
      },
      {
        type: "fix" as const,
        text: "Fixed: playing a recording, scrolling to the next student, and hitting play would hard-refresh the page and send you back to the top — forcing you to scroll all the way down again.",
      },
    ],
  },
  {
    date: "March 30, 2026",
    items: [
      {
        type: "new" as const,
        text: "Saved rubric templates — build a rubric once and reuse it across any assignment.",
      },
      {
        type: "fix" as const,
        text: "Fixed: pasting an assignment into a new class would sometimes carry over the original title instead of prompting for a new one.",
      },
      {
        type: "fix" as const,
        text: "Fixed: dropdown menus were hard to read in dark mode.",
      },
    ],
  },
  {
    date: "March 24, 2026",
    items: [
      {
        type: "fix" as const,
        text: "Fixed: confirmation dialogs (delete class, delete assignment, etc.) could appear invisible or unclickable on some pages.",
      },
    ],
  },
  {
    date: "March 23, 2026",
    items: [
      {
        type: "fix" as const,
        text: "Fixed: attaching a file to a new assignment sometimes failed silently — the file would appear to upload but not actually save.",
      },
      {
        type: "fix" as const,
        text: "Fixed: assignment descriptions couldn't be edited after the assignment was created.",
      },
      {
        type: "fix" as const,
        text: "Fixed: signing in from the Facebook or Instagram app would fail or get stuck.",
      },
      {
        type: "new" as const,
        text: "Assignments now appear above the class roster on the class page for faster access.",
      },
      {
        type: "new" as const,
        text: "Students now have their own dashboard showing all classes and assignments they've submitted to.",
      },
      {
        type: "new" as const,
        text: "Roster feature: import your class list via CSV to pre-populate student names.",
      },
    ],
  },
  {
    date: "March 20, 2026",
    items: [
      {
        type: "fix" as const,
        text: "Fixed: modal backgrounds appeared transparent in dark mode.",
      },
      {
        type: "fix" as const,
        text: "Fixed: the delete confirmation dialog caused the page to scroll unexpectedly.",
      },
      {
        type: "fix" as const,
        text: "Fixed: dark mode lost its color accents after a recent style update.",
      },
      {
        type: "new" as const,
        text: "Students can now see their previous submissions and are blocked from submitting twice to the same assignment.",
      },
      {
        type: "new" as const,
        text: "Assignment limits: set a max number of submissions per assignment and a max recording length.",
      },
    ],
  },
  {
    date: "March 19, 2026",
    items: [
      {
        type: "fix" as const,
        text: "Fixed: Google sign-in would fail when opened inside the Facebook or Instagram in-app browser.",
      },
    ],
  },
];

const BADGE: Record<"new" | "fix", { label: string; className: string }> = {
  new: { label: "New", className: "pill" },
  fix: { label: "Fix", className: "pill pill-warning" },
};

export default function ChangelogPage() {
  return (
    <main className="page-wrap">
      <BrandBar />
      <p className="meta page-intent">Recent updates and bug fixes — if something was bothering you, it might already be solved.</p>

      <section className="hero">
        <p className="pill">Changelog</p>
        <h1>What&apos;s new in Habla</h1>
        <p>Updates ship regularly. New features and bug fixes are listed here as they land.</p>
        <div className="actions hero-actions">
          <a
            className="btn btn-primary"
            href="mailto:davidsgarcia325@gmail.com?subject=Habla%20bug%20report&body=Hi%20David%2C%0A%0AHere%27s%20a%20bug%20I%20ran%20into%3A%0A%0A"
          >
            Report a bug
          </a>
          <Link className="btn btn-ghost" href="/teacher">
            Back to dashboard
          </Link>
        </div>
      </section>

      <div className="grid section-gap">
        {RELEASES.map((release) => (
          <section key={release.date} className="card">
            <h2 className="surface-title">{release.date}</h2>
            <div className="grid" style={{ gap: "0.6rem", marginTop: "0.75rem" }}>
              {release.items.map((item) => {
                const badge = BADGE[item.type];
                return (
                  <div key={item.text} style={{ display: "flex", gap: "0.6rem", alignItems: "baseline" }}>
                    <span className={badge.className} style={{ flexShrink: 0, fontSize: "0.7rem" }}>
                      {badge.label}
                    </span>
                    <p className="meta" style={{ margin: 0 }}>{item.text}</p>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="actions section-gap" style={{ justifyContent: "center" }}>
        <a
          className="btn btn-ghost"
          href="mailto:davidsgarcia325@gmail.com?subject=Habla%20bug%20report&body=Hi%20David%2C%0A%0AHere%27s%20a%20bug%20I%20ran%20into%3A%0A%0A"
        >
          Report a bug
        </a>
      </div>
    </main>
  );
}
