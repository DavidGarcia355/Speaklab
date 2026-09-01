"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Search, UserRound, UsersRound } from "lucide-react";
import BrandBar from "@/app/components/BrandBar";
import PageTitle from "@/app/components/PageTitle";
import WorkspaceLoading from "@/app/components/WorkspaceLoading";

type ClassSummary = {
  id: string;
  name: string;
  createdAt: number;
};

type RosterEntry = {
  id: string;
  classId: string;
  studentEmail: string;
  studentName: string;
  addedAt: number;
  addedBy: "submission" | "teacher";
};

type ClassRoster = ClassSummary & {
  students: RosterEntry[];
  unavailable: boolean;
};

export default function TeacherRostersPage() {
  const [rosters, setRosters] = useState<ClassRoster[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const classResponse = await fetch("/api/classes", { cache: "no-store" });
        if (!classResponse.ok) throw new Error("Could not load my classes.");
        const classData = (await classResponse.json()) as { items: ClassSummary[] };
        const rows = await Promise.all(
          classData.items.map(async (item) => {
            try {
              const response = await fetch(`/api/classes/${item.id}/roster`, { cache: "no-store" });
              if (!response.ok) throw new Error("roster-unavailable");
              const data = (await response.json()) as { items: RosterEntry[] };
              return { ...item, students: data.items, unavailable: false };
            } catch {
              return { ...item, students: [], unavailable: true };
            }
          }),
        );
        if (active) setRosters(rows);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load rosters.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleRosters = useMemo(() => {
    if (!normalizedQuery) return rosters;
    return rosters
      .map((roster) => ({
        ...roster,
        students: roster.students.filter((student) =>
          `${student.studentName} ${student.studentEmail}`.toLowerCase().includes(normalizedQuery),
        ),
      }))
      .filter((roster) =>
        roster.name.toLowerCase().includes(normalizedQuery) || roster.students.length > 0,
      );
  }, [normalizedQuery, rosters]);

  const totalStudents = useMemo(
    () => new Set(rosters.flatMap((roster) => roster.students.map((student) => student.studentEmail.toLowerCase()))).size,
    [rosters],
  );

  return (
    <main className="page-wrap teacher-rosters-page">
      <PageTitle title="Class Rosters" />
      <BrandBar label="Teacher Studio" />

      <header className="rosters-header">
        <div>
          <Link className="teacher-back-link" href="/teacher">
            <ArrowLeft size={15} aria-hidden="true" /> Back to dashboard
          </Link>
          <p className="teacher-section-label">Roster hub</p>
          <h1>All class rosters</h1>
          <p className="meta">Find a student once, then jump directly to the right class.</p>
        </div>
        <div className="rosters-summary" aria-label="Roster summary">
          <span><UsersRound size={16} aria-hidden="true" /> {rosters.length} {rosters.length === 1 ? "class" : "classes"}</span>
          <span><UserRound size={16} aria-hidden="true" /> {totalStudents} unique students</span>
        </div>
      </header>

      <div className="rosters-search">
        <Search size={17} aria-hidden="true" />
        <label className="sr-only" htmlFor="roster-search">Search all rosters</label>
        <input
          id="roster-search"
          className="input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by student, email, or class"
        />
      </div>

      {loading ? <WorkspaceLoading compact label="Loading class rosters" /> : null}
      {error ? <p className="notice danger">{error}</p> : null}
      {!loading && !error && visibleRosters.length === 0 ? (
        <div className="card rosters-empty">
          <h2 className="surface-title">No matching rosters</h2>
          <p className="meta">Try a different student name, email, or class.</p>
        </div>
      ) : null}

      <section className="roster-class-grid" aria-label="Class rosters">
        {visibleRosters.map((roster) => (
          <article className="card roster-class-card" key={roster.id}>
            <div className="roster-class-head">
              <div>
                <h2>{roster.name}</h2>
                <p className="meta">{roster.unavailable ? "Roster unavailable" : `${roster.students.length} students`}</p>
              </div>
              <Link
                className="btn btn-ghost btn-sm"
                href={`/teacher/class/${roster.id}#roster`}
                aria-label={`Manage roster for ${roster.name}`}
              >
                Manage roster <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
            {!roster.unavailable && roster.students.length === 0 ? (
              <p className="roster-class-empty">No students yet.</p>
            ) : (
              <ul className="roster-student-list">
                {roster.students.map((student) => (
                  <li key={student.id}>
                    <span className="roster-student-avatar" aria-hidden="true">
                      {(student.studentName || student.studentEmail).slice(0, 1).toUpperCase()}
                    </span>
                    <span>
                      <strong>{student.studentName || "Unnamed student"}</strong>
                      <small>{student.studentEmail}</small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
