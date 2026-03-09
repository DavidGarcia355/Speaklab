"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import BrandBar from "@/app/components/BrandBar";

type ClassLookup = {
  item: {
    id: string;
    name: string;
    createdAt: number;
  };
};

export default function NewAssignmentPage() {
  const params = useParams<{ classId?: string }>();
  const classId = params?.classId;
  const router = useRouter();

  const [classData, setClassData] = useState<ClassLookup | null>(null);
  const [loadingClass, setLoadingClass] = useState(true);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [hintMsg, setHintMsg] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!classId) {
      setLoadingClass(false);
      setErrorMsg("Missing class id.");
      return;
    }

    async function load() {
      setLoadingClass(true);
      try {
        const response = await fetch(`/api/classes/${classId}`, { cache: "no-store" });
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error || "Class not found.");
        }
        const data = (await response.json()) as ClassLookup;
        setClassData(data);
        setErrorMsg("");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Class not found.";
        setErrorMsg(message);
      } finally {
        setLoadingClass(false);
      }
    }

    load();
  }, [classId]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!classId) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setErrorMsg("Title is required.");
      return;
    }
    if (!instructions.trim()) {
      setErrorMsg("Instructions are required so students know exactly what to do.");
      return;
    }

    setSaving(true);
    setErrorMsg("");
    setHintMsg("");
    try {
      const response = await fetch(`/api/classes/${classId}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: cleanTitle,
          description,
          instructions,
        }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to create assignment.");
      }
      setHintMsg("Assignment created. Returning to class...");
      router.push(`/teacher/class/${classId}?created=assignment`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create assignment.";
      setErrorMsg(message);
      setSaving(false);
    }
  }

  if (loadingClass) {
    return (
      <main className="page-wrap">
        <p className="meta">Loading class...</p>
      </main>
    );
  }

  if (!classData) {
    return (
      <main className="page-wrap">
        <section className="card">
          <h1 style={{ marginTop: 0 }}>Class unavailable</h1>
          <p className="status-danger">{errorMsg || "Class not found."}</p>
          <div className="actions">
            <Link className="btn btn-ghost" href="/teacher">
              Back to Teacher
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page-wrap">
      <BrandBar label="Create Assignment" />
      <p className="meta page-intent">Write a clear prompt so students can record without confusion.</p>

      <div className="actions topbar">
        <Link className="btn btn-ghost" href={`/teacher/class/${classData.item.id}`}>
          Back to Class
        </Link>
      </div>

      <section className="card form-shell form-shell-wide panel-subtle">
        <h1 className="surface-title">Create assignment</h1>
        <p className="meta">Class: {classData.item.name}</p>

        <form onSubmit={handleSubmit}>
          <label className="label" htmlFor="assignment-title">
            Title
          </label>
          <input
            id="assignment-title"
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Daily speaking check"
            maxLength={160}
          />
          <p className="meta field-meta">{title.length}/160</p>

          <label className="label form-label-top" htmlFor="assignment-description">
            Description (optional)
          </label>
          <input
            id="assignment-description"
            className="input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="One minute response."
            maxLength={500}
          />
          <p className="meta field-meta">{description.length}/500</p>

          <label className="label form-label-top" htmlFor="assignment-instructions">
            Instructions
          </label>
          <textarea
            id="assignment-instructions"
            className="textarea"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="Explain what students should include in their recording."
            maxLength={4000}
          />
          <p className="meta field-meta">{instructions.length}/4000</p>

          <div className="actions form-actions">
            <button
              className="btn btn-primary"
              type="submit"
              disabled={saving || title.trim().length === 0 || instructions.trim().length === 0}
            >
              {saving ? "Creating..." : "Create Assignment"}
            </button>
          </div>

          {hintMsg ? <p className="notice success">{hintMsg}</p> : null}
          {errorMsg ? <p className="notice danger">{errorMsg}</p> : null}
        </form>
      </section>
    </main>
  );
}
