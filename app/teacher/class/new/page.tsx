"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import BrandBar from "@/app/components/BrandBar";

export default function NewClassPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [hintMsg, setHintMsg] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) {
      setErrorMsg("Class name is required.");
      return;
    }

    setSaving(true);
    setErrorMsg("");
    setHintMsg("");
    try {
      const response = await fetch("/api/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: clean }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to create class.");
      }
      const data = (await response.json()) as { item: { id: string } };
      setHintMsg("Class created. Opening class workspace...");
      router.push(`/teacher/class/${data.item.id}?created=class`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create class.";
      setErrorMsg(message);
      setSaving(false);
    }
  }

  return (
    <main className="page-wrap">
      <BrandBar label="Create Class" />
      <p className="meta page-intent">Create a class in seconds and move directly into assignment setup.</p>

      <div className="actions topbar">
        <Link className="btn btn-ghost" href="/teacher">
          Back to Teacher
        </Link>
      </div>

      <section className="card form-shell panel-subtle">
        <h1 className="surface-title">Create a class</h1>
        <p className="meta">Name your class and jump straight into assignment setup.</p>

        <form onSubmit={handleSubmit}>
          <label className="label" htmlFor="class-name">
            Class name
          </label>
          <input
            id="class-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Spanish 1 - Block A"
            autoFocus
            maxLength={120}
          />
          <p className="meta field-meta">{name.length}/120</p>

          <div className="actions form-actions">
            <button
              className="btn btn-primary"
              type="submit"
              disabled={saving || name.trim().length === 0}
            >
              {saving ? "Creating..." : "Create Class"}
            </button>
          </div>

          {hintMsg ? <p className="notice success">{hintMsg}</p> : null}
          {errorMsg ? <p className="notice danger">{errorMsg}</p> : null}
        </form>
      </section>
    </main>
  );
}
