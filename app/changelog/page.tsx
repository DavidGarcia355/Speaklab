import type { Metadata } from "next";
import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";

export const metadata: Metadata = {
  title: "What's New - Habla",
  description: "Recent updates and improvements to Habla.",
};

const RELEASES = [
  {
    date: "March 2026",
    items: [
      "Download student recordings directly from the review page — save as webm/mp4/ogg and drop straight into an AI grader.",
      "Expanded playback speeds: 0.5×, 1×, 1.5×, 2×, 3× in the teacher submission review.",
      "Fixed a bug where switching apps and returning would reset scroll position in the submissions list.",
      "Saved rubric templates — build a rubric once and reuse it across any assignment.",
      "Fixed select option text readability in dark mode.",
      "Admin dashboard: delete individual contact messages.",
      "Fixed a rendering bug where confirmation modals could appear behind page content.",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <main className="page-wrap">
      <BrandBar />
      <p className="meta page-intent">Recent updates and improvements to Habla.</p>

      <section className="hero">
        <p className="pill">Changelog</p>
        <h1>What&apos;s new in Habla</h1>
        <p>Updates ship regularly. Check back to see what&apos;s changed.</p>
      </section>

      <div className="grid section-gap">
        {RELEASES.map((release) => (
          <section key={release.date} className="card">
            <h2 className="surface-title">{release.date}</h2>
            <ul className="flow-list">
              {release.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="actions section-gap">
        <Link className="btn btn-ghost" href="/teacher">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
