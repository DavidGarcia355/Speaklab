"use client";
import { useEffect, useState } from "react";
import AudioPlayer from "./AudioPlayer";
import type { StudentSubmissionRow } from "@/lib/db";
import { buildSubmissionDownloadFilenameBase } from "./submission-download-filenames";
import styles from "./RecordingMedia.module.css";

export default function PracticeHistory({ classId, refreshKey }: { classId: string; refreshKey: number }) {
  const [items, setItems] = useState<StudentSubmissionRow[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/student/classes/${classId}/practice`, { signal: abort.signal, cache: "no-store" }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn't load your practice history.");
      setItems(data.items); setError("");
    }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [classId, refreshKey]);
  return <section className={styles.history} aria-label="My Open Mic recordings">
    <div className={styles.sectionHeading}><h2>My Open Mic recordings</h2><p className="meta">Shared with your teacher. Other students cannot see these recordings.</p></div>
    {error ? <p className="notice danger" role="alert">{error}</p> : !items.length ? <p className="empty">Your practice recordings will appear here.</p> : null}
    <div className={styles.list}>{items.map(item => <article className={styles.item} data-reviewed={Boolean(item.reviewedAt)} key={item.id}>
      <div className={styles.identity}>
        <h3 className={styles.title}>{item.practiceTitle || "Open Mic practice"}</h3>
        <div className={styles.meta}><span>{new Date(item.submittedAt).toLocaleString()}</span><span className={`pill ${item.reviewedAt ? "pill-success" : "pill-warning"}`}>{item.reviewedAt ? "Reviewed" : "Awaiting review"}</span></div>
      </div>
      <div className={styles.player}><AudioPlayer variant="row" src={item.audioData} durationSeconds={item.durationSeconds} downloadFilename={buildSubmissionDownloadFilenameBase({ studentName: item.studentName, assignmentTitle: item.practiceTitle || "Open Mic", submittedAt: item.submittedAt, submissionId: item.id })} /></div>
      {item.practiceNote ? <p className={styles.note}>{item.practiceNote}</p> : null}
      {item.feedback ? <div className={styles.feedback}><strong>Teacher feedback:</strong><p>{item.feedback}</p></div> : null}
    </article>)}</div>
  </section>;
}
