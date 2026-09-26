"use client";
import { useEffect, useState } from "react";

export default function VideoAccommodations({ assignmentId }: { assignmentId: string }) {
  const [emails, setEmails] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/assignments/${assignmentId}/video-accommodations`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("Could not load accommodations."); return response.json(); })
      .then(data => setEmails(data.emails ?? []))
      .catch(error => { if (!controller.signal.aborted) setMessage(String(error)); });
    return () => controller.abort();
  }, [assignmentId]);
  async function update(studentEmail: string, allowed: boolean) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/assignments/${assignmentId}/video-accommodations`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentEmail, allowed }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save accommodation.");
      setEmails(data.emails); setEmail(""); setMessage("Accommodation saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save."); }
    finally { setBusy(false); }
  }
  return <section aria-label="Video accommodations">
    <h4>Allow an audio alternative</h4>
    <p className="meta">Allow an individual student to submit audio when video is required—for accessibility, camera access, privacy, or an exhausted video allowance. Changes here save immediately.</p>
    <label className="label" htmlFor="video-accommodation-email">Student email</label>
    <input id="video-accommodation-email" className="input" type="email" value={email} onChange={event => setEmail(event.target.value)} />
    <button type="button" className="btn btn-ghost" disabled={busy || !email.trim()} onClick={() => void update(email.trim(), true)}>Allow audio</button>
    <ul>{emails.map(item => <li key={item}>{item} <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void update(item, false)} aria-label={`Remove audio alternative for ${item}`}>Remove</button></li>)}</ul>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
