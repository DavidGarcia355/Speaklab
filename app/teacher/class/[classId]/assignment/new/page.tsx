"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import BrandBar from "@/app/components/BrandBar";
import PageTitle from "@/app/components/PageTitle";
import WorkspaceLoading from "@/app/components/WorkspaceLoading";
import RubricBuilder, { type RubricCriterionDraft } from "@/app/components/RubricBuilder";
import { MAX_ASSIGNMENT_ATTACHMENT_BYTES } from "@/lib/attachment-policy";

type ClassLookup = {
  item: {
    id: string;
    name: string;
    createdAt: number;
  };
  teacherDefaultLanguage: string | null;
};

const LANGUAGE_OPTIONS = [
  "Spanish",
  "French",
  "English",
  "German",
  "Italian",
  "Portuguese",
  "Mandarin Chinese",
  "Cantonese",
  "Japanese",
  "Korean",
  "Arabic",
  "Hindi",
  "Russian",
  "Ukrainian",
  "Vietnamese",
];

type AttachmentDraft = {
  fileName: string;
  dataUrl: string;
};

function createCriterionDraft(): RubricCriterionDraft {
  return {
    id: `criterion_${crypto.randomUUID()}`,
    name: "",
    description: "",
    maxPoints: "10",
  };
}

function parseRubricCriteria(criteria: RubricCriterionDraft[]) {
  return criteria.map((criterion) => ({
    id: criterion.id,
    name: criterion.name.trim(),
    description: criterion.description.trim(),
    maxPoints: Number(criterion.maxPoints),
  }));
}

async function fileToDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read attachment."));
    reader.readAsDataURL(file);
  });
}

export default function NewAssignmentPage() {
  const params = useParams<{ classId?: string }>();
  const classId = params?.classId;
  const router = useRouter();

  const [classData, setClassData] = useState<ClassLookup | null>(null);
  const [loadingClass, setLoadingClass] = useState(true);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("Spanish");
  const [useCustomLanguage, setUseCustomLanguage] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [setAsDefaultLanguage, setSetAsDefaultLanguage] = useState(true);
  const [maxPoints, setMaxPoints] = useState("100");
  const [rubricEnabled, setRubricEnabled] = useState(false);
  const [rubricTitle, setRubricTitle] = useState("");
  const [rubricCriteria, setRubricCriteria] = useState<RubricCriterionDraft[]>([]);
  const [maxSubmissions, setMaxSubmissions] = useState("");
  const [maxRecordingSeconds, setMaxRecordingSeconds] = useState("180");
  const [autoTranscribe, setAutoTranscribe] = useState(false);
  const [aiTranscriptionEnabled, setAiTranscriptionEnabled] = useState(false);
  const [attachment, setAttachment] = useState<AttachmentDraft | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [hintMsg, setHintMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const languagePickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeLanguageMenu(event: PointerEvent) {
      if (!languagePickerRef.current?.contains(event.target as Node)) {
        setLanguageMenuOpen(false);
      }
    }

    function closeLanguageMenuWithKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setLanguageMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeLanguageMenu);
    document.addEventListener("keydown", closeLanguageMenuWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeLanguageMenu);
      document.removeEventListener("keydown", closeLanguageMenuWithKeyboard);
    };
  }, []);

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
        const savedLanguage = data.teacherDefaultLanguage?.trim();
        setTargetLanguage(savedLanguage || "Spanish");
        setUseCustomLanguage(Boolean(savedLanguage && !LANGUAGE_OPTIONS.includes(savedLanguage)));
        setSetAsDefaultLanguage(!savedLanguage);
        try {
          const featureResponse = await fetch("/api/features", { cache: "no-store" });
          if (featureResponse.ok) {
            const features = (await featureResponse.json()) as { aiGradingEnabled?: boolean };
            setAiTranscriptionEnabled(features.aiGradingEnabled === true);
          }
        } catch {
          setAiTranscriptionEnabled(false);
        }
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

  async function handleAttachmentChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      setAttachment(null);
      return;
    }
    if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type)) {
      setErrorMsg("Attachment must be a PDF, PNG, or JPG file.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_ASSIGNMENT_ATTACHMENT_BYTES) {
      setErrorMsg("Attachment is too large. Maximum size is 3 MB.");
      event.target.value = "";
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      setAttachment({ fileName: file.name, dataUrl });
      setErrorMsg("");
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Unable to read attachment.");
      event.target.value = "";
    }
  }

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
    const cleanTargetLanguage = targetLanguage.trim();
    if (!cleanTargetLanguage) {
      setErrorMsg("Choose the language students should use.");
      return;
    }
    const parsedMaxPoints = Number(maxPoints);
    const parsedRubricCriteria = parseRubricCriteria(rubricCriteria);
    const rubricTotal = parsedRubricCriteria.reduce((sum, criterion) => sum + (Number.isFinite(criterion.maxPoints) ? criterion.maxPoints : 0), 0);
    if (rubricEnabled) {
      if (!rubricTitle.trim()) {
        setErrorMsg("Rubric title is required.");
        return;
      }
      if (parsedRubricCriteria.length === 0) {
        setErrorMsg("Add at least one rubric criterion.");
        return;
      }
      if (parsedRubricCriteria.length > 8) {
        setErrorMsg("Rubrics can include up to 8 criteria.");
        return;
      }
      for (const criterion of parsedRubricCriteria) {
        if (!criterion.name) {
          setErrorMsg("Each rubric criterion needs a name.");
          return;
        }
        if (!Number.isInteger(criterion.maxPoints) || criterion.maxPoints < 1) {
          setErrorMsg("Each rubric criterion must have at least 1 point.");
          return;
        }
      }
      if (rubricTotal < 1 || rubricTotal > 1000) {
        setErrorMsg("Rubric total must be between 1 and 1000 points.");
        return;
      }
    } else if (!Number.isInteger(parsedMaxPoints) || parsedMaxPoints < 1 || parsedMaxPoints > 1000) {
      setErrorMsg("Points possible must be a whole number from 1 to 1000.");
      return;
    }
    const parsedMaxSubmissions = maxSubmissions.trim() === "" ? 0 : Number(maxSubmissions);
    if (!Number.isInteger(parsedMaxSubmissions) || parsedMaxSubmissions < 0 || parsedMaxSubmissions > 50) {
      setErrorMsg("Max submissions must be a whole number from 0 to 50 (0 = unlimited).");
      return;
    }
    const parsedMaxRecordingSeconds = Number(maxRecordingSeconds);
    if (!Number.isInteger(parsedMaxRecordingSeconds) || parsedMaxRecordingSeconds < 10 || parsedMaxRecordingSeconds > 300) {
      setErrorMsg("Recording length must be a whole number from 10 to 300 seconds.");
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
          targetLanguage: cleanTargetLanguage,
          setAsDefaultLanguage,
          maxPoints: rubricEnabled ? rubricTotal : parsedMaxPoints,
          maxSubmissions: parsedMaxSubmissions,
          maxRecordingSeconds: parsedMaxRecordingSeconds,
          autoTranscribe,
          ...(rubricEnabled
            ? {
                rubric: {
                  title: rubricTitle.trim(),
                  criteria: parsedRubricCriteria,
                },
              }
            : {}),
          ...(attachment ? { attachment } : {}),
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
        <PageTitle title="Create Assignment" />
        <BrandBar label="Create Assignment" />
        <WorkspaceLoading label="Preparing assignment setup" />
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
      <PageTitle title={classData ? `New Assignment for ${classData.item.name}` : "Create Assignment"} />
      <BrandBar label="Create Assignment" />
      <p className="meta page-intent">Write clear instructions so students know exactly what to record.</p>

      <div className="actions topbar">
        <Link className="btn btn-ghost" href={`/teacher/class/${classData.item.id}`}>
          Back to Workspace
        </Link>
      </div>

      <section className="card form-shell form-shell-wide panel-subtle">
        <h1 className="surface-title">Create assignment</h1>
        <p className="meta">Class: {classData.item.name}</p>

        <form onSubmit={handleSubmit}>
          <label className="label" htmlFor="assignment-title">
            Assignment title
          </label>
          <input
            id="assignment-title"
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Daily speaking check"
            maxLength={100}
          />
          <p className="meta field-meta">{title.length}/100</p>

          <label className="label form-label-top" htmlFor="assignment-description">
            Student directions (optional)
          </label>
          <input
            id="assignment-description"
            className="input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Add a short summary students will see before they record."
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
            placeholder="Write the exact prompt or speaking directions students should follow."
            maxLength={500}
          />
          <p className="meta field-meta">{instructions.length}/500</p>

          <label className="label form-label-top" htmlFor="assignment-language">
            Student response language
          </label>
          <div className="language-picker" ref={languagePickerRef}>
            <button
              id="assignment-language"
              className="language-picker-trigger"
              type="button"
              aria-haspopup="listbox"
              aria-expanded={languageMenuOpen}
              onClick={() => setLanguageMenuOpen((open) => !open)}
            >
              <span>{useCustomLanguage ? targetLanguage || "Other language" : targetLanguage}</span>
              <span className="language-picker-chevron" aria-hidden="true" />
            </button>
            {languageMenuOpen ? (
              <div className="language-picker-menu" role="listbox" aria-label="Student response language">
                {LANGUAGE_OPTIONS.map((language) => {
                  const selected = !useCustomLanguage && targetLanguage === language;
                  return (
                    <button
                      className="language-picker-option"
                      type="button"
                      role="option"
                      aria-selected={selected}
                      key={language}
                      onClick={() => {
                        setUseCustomLanguage(false);
                        setTargetLanguage(language);
                        setSetAsDefaultLanguage(!classData.teacherDefaultLanguage);
                        setLanguageMenuOpen(false);
                      }}
                    >
                      <span>{language}</span>
                      {selected ? <span aria-hidden="true">✓</span> : null}
                    </button>
                  );
                })}
                <button
                  className="language-picker-option language-picker-option-custom"
                  type="button"
                  role="option"
                  aria-selected={useCustomLanguage}
                  onClick={() => {
                    setUseCustomLanguage(true);
                    setTargetLanguage("");
                    setSetAsDefaultLanguage(!classData.teacherDefaultLanguage);
                    setLanguageMenuOpen(false);
                  }}
                >
                  <span>Other language…</span>
                  {useCustomLanguage ? <span aria-hidden="true">✓</span> : null}
                </button>
              </div>
            ) : null}
          </div>
          {useCustomLanguage ? (
            <input
              className="input form-label-top"
              value={targetLanguage}
              onChange={(event) => {
                setTargetLanguage(event.target.value);
                setSetAsDefaultLanguage(!classData.teacherDefaultLanguage);
              }}
              placeholder="Enter a language"
              aria-label="Other student response language"
              maxLength={80}
              autoFocus
            />
          ) : null}
          <p className="meta field-meta">
            Choose the language students will speak. AI grading will evaluate the response in this language.
          </p>
          {classData.teacherDefaultLanguage &&
          targetLanguage.trim().toLocaleLowerCase() !==
            classData.teacherDefaultLanguage.trim().toLocaleLowerCase() ? (
            <label className="checkbox-row form-label-top">
              <input
                type="checkbox"
                checked={setAsDefaultLanguage}
                onChange={(event) => setSetAsDefaultLanguage(event.target.checked)}
              />
              Make {targetLanguage.trim() || "this language"} my default for future assignments
            </label>
          ) : !classData.teacherDefaultLanguage ? (
            <p className="notice info">
              {targetLanguage.trim() || "This language"} will become my default for future assignments.
            </p>
          ) : null}

          <label className="label form-label-top" htmlFor="assignment-max-points">
            {rubricEnabled ? "Points (from rubric)" : "Points possible"}
          </label>
          {rubricEnabled ? (
            <div className="notice info assignment-attachment-notice">
              Points possible: <strong>{parseRubricCriteria(rubricCriteria).reduce((sum, criterion) => sum + (Number.isFinite(criterion.maxPoints) ? criterion.maxPoints : 0), 0)}</strong>
            </div>
          ) : (
            <>
              <input
                id="assignment-max-points"
                className="input"
                type="number"
                min={1}
                max={1000}
                step={1}
                inputMode="numeric"
                value={maxPoints}
                onChange={(event) => setMaxPoints(event.target.value)}
              />
              <p className="meta field-meta">Students will be graded out of this number of points.</p>
            </>
          )}

          <label className="label form-label-top" htmlFor="assignment-max-submissions">
            Max submissions per student
          </label>
          <input
            id="assignment-max-submissions"
            className="input"
            type="number"
            min={0}
            max={50}
            step={1}
            inputMode="numeric"
            value={maxSubmissions}
            onChange={(event) => setMaxSubmissions(event.target.value)}
            placeholder="Unlimited"
          />
          <p className="meta field-meta">Leave blank or 0 for unlimited. Students can delete and resubmit.</p>

          <label className="label form-label-top" htmlFor="assignment-max-recording">
            Max recording length (seconds)
          </label>
          <input
            id="assignment-max-recording"
            className="input"
            type="number"
            min={10}
            max={300}
            step={1}
            inputMode="numeric"
            value={maxRecordingSeconds}
            onChange={(event) => setMaxRecordingSeconds(event.target.value)}
          />
          <p className="meta field-meta">Between 10 and 300 seconds. Default is 180 (3 minutes).</p>

          {aiTranscriptionEnabled ? (
            <>
              <label className="checkbox-row form-label-top">
                <input
                  type="checkbox"
                  checked={autoTranscribe}
                  onChange={(event) => setAutoTranscribe(event.target.checked)}
                />
                Automatically transcribe new submissions
              </label>
              <p className="meta field-meta">
                Future recordings will be transcribed after students submit. Each usable new transcript
                uses one AI-assisted recording unit; grading that same recording later is included and
                still remains optional. Processing pauses at the allowance limit, with no overages.
              </p>
            </>
          ) : null}

          <RubricBuilder
            enabled={rubricEnabled}
            title={rubricTitle}
            criteria={rubricCriteria}
            totalPoints={parseRubricCriteria(rubricCriteria).reduce(
              (sum, criterion) => sum + (Number.isFinite(criterion.maxPoints) ? criterion.maxPoints : 0),
              0
            )}
            onToggle={(enabled) => {
              setRubricEnabled(enabled);
              if (enabled && rubricCriteria.length === 0) {
                setRubricCriteria([createCriterionDraft()]);
              }
            }}
            onTitleChange={setRubricTitle}
            onCriterionChange={(index, update) =>
              setRubricCriteria((prev) =>
                prev.map((criterion, criterionIndex) =>
                  criterionIndex === index ? { ...criterion, ...update } : criterion
                )
              )
            }
            onAddCriterion={() => setRubricCriteria((prev) => [...prev, createCriterionDraft()])}
            onRemoveCriterion={(index) =>
              setRubricCriteria((prev) => prev.filter((_, criterionIndex) => criterionIndex !== index))
            }
            onLoadTemplate={(templateTitle, templateCriteria) => {
              setRubricTitle(templateTitle);
              setRubricCriteria(templateCriteria);
            }}
          />

          <label className="label form-label-top" htmlFor="assignment-attachment">
            Attachment (optional)
          </label>
          <input
            id="assignment-attachment"
            className="input"
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={(event) => void handleAttachmentChange(event)}
          />
          <p className="meta field-meta">Add a PDF or image students can open alongside the prompt. Maximum 3 MB.</p>
          {attachment ? (
            <div className="notice info assignment-attachment-notice">
              Attached: <strong>{attachment.fileName}</strong>
              <button
                className="text-link"
                type="button"
                aria-label={`Remove attachment ${attachment.fileName}`}
                onClick={() => setAttachment(null)}
              >
                Remove attachment
              </button>
            </div>
          ) : null}

          <div className="actions form-actions">
            <button
              className="btn btn-primary"
              type="submit"
              disabled={
                saving ||
                title.trim().length === 0 ||
                instructions.trim().length === 0 ||
                targetLanguage.trim().length === 0 ||
                (!rubricEnabled && maxPoints.trim().length === 0)
              }
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
