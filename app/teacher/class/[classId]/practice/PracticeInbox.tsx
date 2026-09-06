"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import BrandBar from "@/app/components/BrandBar";
import PageTitle from "@/app/components/PageTitle";
import AudioPlayer from "@/app/components/AudioPlayer";
import SubmissionTranscript from "@/app/components/SubmissionTranscript";
import { buildSubmissionDownloadFilenameBase } from "@/app/components/submission-download-filenames";
import type { PracticeSubmissionRow } from "@/lib/db";
import mediaStyles from "@/app/components/RecordingMedia.module.css";
import styles from "./PracticeInbox.module.css";

function PracticeReview({ item, transcriptionEnabled, onSaved }: { item: PracticeSubmissionRow; transcriptionEnabled: boolean; onSaved: (item: PracticeSubmissionRow) => void }) {
  const [feedback, setFeedback] = useState(item.feedback);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [transcriptReady, setTranscriptReady] = useState(item.transcriptAvailable);
  const markTranscriptReady = useCallback(() => setTranscriptReady(true), []);
  const filename = buildSubmissionDownloadFilenameBase({ studentName: item.studentName, assignmentTitle: item.practiceTitle || "Open Mic", submittedAt: item.submittedAt, submissionId: item.id });
  async function save(reviewed: boolean) {
    if (saving) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch(`/api/submissions/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedback, reviewed }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn't save feedback.");
      onSaved({ ...item, ...data.item });
      setMessage(reviewed ? "Feedback saved. Marked reviewed." : "Feedback saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Couldn't save feedback."); }
    finally { setSaving(false); }
  }
  return <article className={`${mediaStyles.item} ${styles.recording}`} data-reviewed={Boolean(item.reviewedAt)}>
    <div className={mediaStyles.identity}>
      <h2 className={mediaStyles.title}>{item.practiceTitle || "Open Mic practice"}</h2>
      <div className={mediaStyles.meta}><strong>{item.studentName}</strong><span className={`pill ${item.reviewedAt ? "pill-success" : "pill-warning"}`}>{item.reviewedAt ? "Reviewed" : "Awaiting review"}</span></div>
      <p className={mediaStyles.meta}>{item.studentEmail} · {item.className} · {new Date(item.submittedAt).toLocaleString()}</p>
    </div>
    <div className={mediaStyles.player}><AudioPlayer variant="row" src={item.audioData} durationSeconds={item.durationSeconds} downloadFilename={filename} /></div>
    {item.practiceNote ? <p className={mediaStyles.note}><strong>Student note:</strong> {item.practiceNote}</p> : null}
    <details className={styles.review}>
      <summary>Transcript and teacher feedback<span className={styles.transcriptState}>{transcriptReady ? "Transcript saved" : "Not transcribed"}</span></summary>
      <div className={styles.reviewGrid}>
        <div className={styles.transcript}>
          {transcriptionEnabled || item.transcriptAvailable ? <SubmissionTranscript submissionId={item.id} studentName={item.studentName} downloadFilenameBase={filename} durationSeconds={item.durationSeconds} practice onReady={markTranscriptReady} /> : <p className="meta">Transcription is unavailable. You can listen and leave feedback below.</p>}
        </div>
        <div className={styles.feedback}>
          <label className="label" htmlFor={`feedback-${item.id}`}>Teacher feedback</label>
          <textarea id={`feedback-${item.id}`} className="input" rows={4} maxLength={1000} value={feedback} onChange={e => setFeedback(e.target.value)} />
          <div className={`actions ${styles.feedbackActions}`}>
            <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => void save(true)}>{saving ? "Saving..." : "Save feedback & mark reviewed"}</button>
            <button className="btn btn-ghost btn-sm" disabled={saving} onClick={() => void save(Boolean(item.reviewedAt))}>Save feedback</button>
          </div>
          <p className="meta" role="status">{message}</p>
        </div>
      </div>
    </details>
  </article>;
}

export default function PracticeInbox({ classId }: { classId: string }) {
  const [items, setItems] = useState<PracticeSubmissionRow[]>([]);
  const [className, setClassName] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/classes/${classId}/practice`, { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn't open this Practice Inbox.");
      setItems(data.items); setClassName(data.class.name); setEnabled(data.transcriptionEnabled);
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : "Couldn't load practice recordings."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [classId]);
  useEffect(() => { const abort = new AbortController(); void load(abort.signal); return () => abort.abort(); }, [load]);
  return <main className={`page-wrap ${styles.page}`}>
    <PageTitle title="Practice Inbox" /><BrandBar label="Teacher" />
    <div className={`workspace-header teacher-class-header ${styles.header}`}><div className="teacher-class-header-main"><div>
      <Link className="teacher-back-link" href={`/teacher/class/${classId}`}>← {className || "Class"}</Link>
      <h1>Practice Inbox</h1><p className="meta">Student-led speaking practice. Listen, transcribe if useful, and leave feedback.</p>
    </div><button className="btn btn-ghost btn-sm" disabled={loading} onClick={() => void load()}>Refresh</button></div></div>
    {error ? <p className="notice danger" role="alert">{error}</p> : loading ? <p className="meta">Loading practice recordings...</p> : <>
      <div className={styles.inboxMeta}><p className="meta"><strong>{items.length}</strong> recordings · <strong>{items.filter(i => !i.reviewedAt).length}</strong> awaiting review</p><span>Newest first</span></div>
      {!items.length ? <section className="card"><h2 className="surface-title">Ready for their next idea</h2><p className="empty">Students can open this class, choose Open Mic, and send a recording without an assignment.</p></section> : null}
      <div className={styles.list}>{items.map(item => <PracticeReview key={item.id} item={item} transcriptionEnabled={enabled} onSaved={saved => setItems(rows => rows.map(row => row.id === saved.id ? saved : row))} />)}</div>
    </>}
  </main>;
}
