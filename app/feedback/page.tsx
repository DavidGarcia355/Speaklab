"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import BrandBar from "@/app/components/BrandBar";

type FeedbackForm = {
  name: string;
  email: string;
  school: string;
  role: string;
  message: string;
};

type FieldErrors = Partial<Record<keyof FeedbackForm | "_form", string[]>>;

const INITIAL_FORM: FeedbackForm = {
  name: "",
  email: "",
  school: "",
  role: "",
  message: "",
};

export default function FeedbackPage() {
  const [form, setForm] = useState<FeedbackForm>(INITIAL_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function updateField<K extends keyof FeedbackForm>(key: K, value: FeedbackForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setStatus("");
    setFieldErrors({});

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await response.json()) as { error?: string; fieldErrors?: FieldErrors };

      if (!response.ok) {
        setFieldErrors(data.fieldErrors ?? {});
        throw new Error(data.error || "Unable to submit feedback right now.");
      }

      setStatus("Thanks. Your feedback was submitted successfully.");
      setForm(INITIAL_FORM);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to submit feedback right now.";
      setStatus(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page-wrap">
      <BrandBar label="Feedback" />
      <section className="hero">
        <p className="pill">Pilot request</p>
        <h1>Request access or share feedback</h1>
        <p>
          Tell us about your school and what you need. We use this to prioritize testing.
        </p>
      </section>

      <section className="card form-shell section-gap">
        <form className="grid" onSubmit={onSubmit} noValidate>
          <div>
            <label className="label" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              className="input"
              value={form.name}
              onChange={(event) => updateField("name", event.target.value)}
              maxLength={80}
              required
            />
            {fieldErrors.name?.[0] ? <p className="card-inline-error">{fieldErrors.name[0]}</p> : null}
          </div>

          <div>
            <label className="label" htmlFor="email">
              School email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              value={form.email}
              onChange={(event) => updateField("email", event.target.value)}
              maxLength={254}
              required
            />
            {fieldErrors.email?.[0] ? <p className="card-inline-error">{fieldErrors.email[0]}</p> : null}
          </div>

          <div>
            <label className="label" htmlFor="school">
              School
            </label>
            <input
              id="school"
              className="input"
              value={form.school}
              onChange={(event) => updateField("school", event.target.value)}
              maxLength={120}
              required
            />
            {fieldErrors.school?.[0] ? <p className="card-inline-error">{fieldErrors.school[0]}</p> : null}
          </div>

          <div>
            <label className="label" htmlFor="role">
              Role
            </label>
            <input
              id="role"
              className="input"
              value={form.role}
              onChange={(event) => updateField("role", event.target.value)}
              maxLength={80}
              required
            />
            {fieldErrors.role?.[0] ? <p className="card-inline-error">{fieldErrors.role[0]}</p> : null}
          </div>

          <div>
            <label className="label" htmlFor="message">
              Message
            </label>
            <textarea
              id="message"
              className="textarea"
              value={form.message}
              onChange={(event) => updateField("message", event.target.value)}
              maxLength={1000}
              required
            />
            {fieldErrors.message?.[0] ? <p className="card-inline-error">{fieldErrors.message[0]}</p> : null}
          </div>

          {fieldErrors._form?.[0] ? <p className="card-inline-error">{fieldErrors._form[0]}</p> : null}
          {status ? (
            <p className={status.startsWith("Thanks") ? "notice success" : "notice danger"}>{status}</p>
          ) : null}

          <div className="actions form-actions">
            <button className="btn btn-primary" type="submit" disabled={submitting}>
              {submitting ? "Sending..." : "Send feedback"}
            </button>
            <Link className="btn btn-ghost" href="/faq">
              View FAQ
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}
