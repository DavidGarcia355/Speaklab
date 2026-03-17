"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import BrandBar from "@/app/components/BrandBar";
import PageTitle from "@/app/components/PageTitle";
import RubricBuilder, { type RubricCriterionDraft } from "@/app/components/RubricBuilder";

type ClassLookup = {
  item: {
    id: string;
    name: string;
    createdAt: number;
  };
};

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
  const [maxPoints, setMaxPoints] = useState("100");
  const [rubricEnabled, setRubricEnabled] = useState(false);
  const [rubricTitle, setRubricTitle] = useState("");
  const [rubricCriteria, setRubricCriteria] = useState<RubricCriterionDraft[]>([]);
  const [attachment, setAttachment] = useState<AttachmentDraft | null>(null);
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
    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg("Attachment is too large. Maximum size is 10MB.");
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
          maxPoints: rubricEnabled ? rubricTotal : parsedMaxPoints,
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
      <PageTitle title={classData ? `New Assignment for ${classData.item.name}` : "Create Assignment"} />
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
            maxLength={100}
          />
          <p className="meta field-meta">{title.length}/100</p>

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
            maxLength={500}
          />
          <p className="meta field-meta">{instructions.length}/500</p>

          <label className="label form-label-top" htmlFor="assignment-max-points">
            {rubricEnabled ? "Points possible" : "Points possible"}
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
          <p className="meta field-meta">Add a PDF or image students can open alongside the prompt.</p>
          {attachment ? (
            <div className="notice info assignment-attachment-notice">
              Attached: <strong>{attachment.fileName}</strong>
              <button
                className="text-link"
                type="button"
                onClick={() => setAttachment(null)}
              >
                Remove
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
