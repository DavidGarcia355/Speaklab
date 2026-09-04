"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock3, Pencil, Sparkles, Trash2, X } from "lucide-react";
import AiGradeReviewBadge from "@/app/components/AiGradeReviewBadge";
import AudioPlayer from "@/app/components/AudioPlayer";
import BatchAiReviewWorkspace from "@/app/components/BatchAiReviewWorkspace";
import BrandBar from "@/app/components/BrandBar";
import {
  BULK_AI_CANCEL_LABEL,
  BULK_AI_CONFIRM_LABEL,
  BULK_AI_QUEUE_CLEAR_COPY,
  BULK_AI_REVIEW_DISCLOSURE,
  BULK_AI_SUPPORT_COPY,
  INDIVIDUAL_AI_ACTION_LABEL,
  INDIVIDUAL_AI_SUPPORT_COPY,
  bulkAiConfirmationTitle,
  bulkAiPrimaryLabel,
} from "@/app/components/bulk-ai-grading-presentation";
import {
  applyBatchSavedGrades,
  cleanBatchSavedDraftIds,
  gradingDraftIsDirty,
  mergeGradingDraftsFromServer,
  type GradingDraftState,
} from "@/app/components/grading-draft-reconciliation";
import ConfirmModal from "@/app/components/ConfirmModal";
import GoogleDriveExportButton from "@/app/components/GoogleDriveExportButton";
import PageTitle from "@/app/components/PageTitle";
import WorkspaceLoading from "@/app/components/WorkspaceLoading";
import RubricBuilder, { type RubricCriterionDraft } from "@/app/components/RubricBuilder";
import SubmissionTranscript from "@/app/components/SubmissionTranscript";
import StudentOralPortfolio from "@/app/components/StudentOralPortfolio";
import UndoToast from "@/app/components/UndoToast";
import {
  BulkAiBatchRequestError,
  bulkAiPreflightFromScopeError,
  closeBulkAiBatch,
  createOrResumeBulkAiBatch,
  runBulkAiBatch,
  saveBulkAiBatch,
  type BulkAiAttempt,
  type BulkAiBatch,
  type BulkAiBatchSaveItem,
} from "@/app/components/bulk-ai-grade-runner";
import { prepareBulkTranscriptDownload } from "@/app/components/bulk-transcript-download";
import {
  preflightBulkTranscripts,
  runBulkTranscriptRequests,
  type BulkTranscriptPreflight,
} from "@/app/components/bulk-transcript-runner";
import { buildSubmissionDownloadFilenameBase } from "@/app/components/submission-download-filenames";
import { MAX_ASSIGNMENT_ATTACHMENT_BYTES } from "@/lib/attachment-policy";
import { parseCsvRows } from "@/lib/csv";
import styles from "./ClassWorkspace.module.css";

type AssignmentSummary = {
  id: string;
  classId: string;
  title: string;
  description: string;
  instructions: string;
  targetLanguage: string;
  maxPoints: number;
  maxSubmissions: number;
  maxRecordingSeconds: number;
  autoTranscribe: boolean;
  rubric: {
    title: string;
    criteria: {
      id: string;
      name: string;
      description: string;
      maxPoints: number;
    }[];
  } | null;
  attachmentName: string;
  attachmentUrl: string;
  attachmentContentType: string;
  createdAt: number;
  submissionCount: number;
};

type SubmissionItem = {
  id: string;
  assignmentId: string;
  assignmentTitle: string;
  studentName: string;
  studentEmail: string;
  audioData: string;
  submittedAt: number;
  feedback: string;
  grade: number | null;
  gradeSource: "teacher" | "ai";
  rubricScores: {
    criterionId: string;
    criterionName: string;
    maxPoints: number;
    awarded: number;
  }[] | null;
};

type ClassPayload = {
  item: { id: string; name: string; createdAt: number };
  assignments: AssignmentSummary[];
  submissions: SubmissionItem[];
  stats: { assignmentCount: number; submissionCount: number };
};

type DraftState = GradingDraftState;
type AiAttempt = BulkAiAttempt;
type AiReviewAllowance = {
  status:
    | "free_lifetime"
    | "manual_lifetime"
    | "teacher_period"
    | "subscription_unavailable";
  limit: number;
  reserved: number;
  consumed: number;
  used: number;
  remaining: number;
  periodStart: number | null;
  periodEnd: number | null;
};
type BulkAiPreflight = {
  assignmentId: string;
  confirmationToken: string;
  confirmationScope: {
    assignmentId: string;
    assignmentFingerprint: string;
    submissionIds: string[];
    eligibleCount: number;
    newUnitsRequired: number;
    transcriptsRequired: number;
  };
  ungradedCount: number;
  submissionIds: string[];
  newUnitsRequired: number;
  remaining: number;
  fits: boolean;
  estimatedSeconds: number;
  cooldownSeconds: number;
  allowance: AiReviewAllowance | null;
  transcriptsRequired: number;
  savedTranscripts: number;
  activeBatch: BulkAiBatch | null;
};
type BulkTranscriptResult = {
  total: number;
  included: number;
  unavailable: number;
  needsReview: number;
  generated: number;
  reused: number;
  failed: number;
  uncertain: number;
  notProcessed: number;
  terminalError: string;
  downloadUrl: string | null;
  archiveFilename: string | null;
};
type Tone = "warning" | "success" | "neutral";
type AssignmentView = AssignmentSummary & {
  totalSubmissions: number;
  ungradedCount: number;
  tone: Tone;
  label: string;
};
type UndoState = { message: string; expiresAt: number };
type RosterEntry = {
  id: string;
  classId: string;
  studentEmail: string;
  studentName: string;
  addedAt: number;
  addedBy: "submission" | "teacher";
};
type StudentDetailPayload = {
  studentEmail: string;
  assignments: {
    assignmentId: string;
    assignmentTitle: string;
    maxPoints: number;
    createdAt: number;
    submissionId: string | null;
    audioData: string | null;
    submittedAt: number | null;
    grade: number | null;
    feedback: string;
  }[];
};
type AttachmentDraft = { fileName: string; dataUrl: string } | null;
type DeleteTarget =
  | { type: "assignment"; assignment: AssignmentView }
  | { type: "submission"; submission: SubmissionItem }
  | null;

const DIALOG_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type AssignmentClipboard = {
  sourceAssignmentId: string;
  title: string;
  description: string;
  instructions: string;
  maxPoints: number;
  maxSubmissions: number;
  maxRecordingSeconds: number;
  rubric: AssignmentSummary["rubric"];
  hasAttachment: boolean;
  copiedAt: number;
};

const ASSIGNMENT_CLIPBOARD_KEY = "habla.assignmentClipboard";

const ASSIGNMENT_LANGUAGE_OPTIONS = [
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
] as const;

const CUSTOM_ASSIGNMENT_LANGUAGE_VALUE = "__custom__";

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(ts: number) {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function pluralize(count: number, singular: string, plural?: string) {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural ?? `${singular}s`}`;
}

function handleAssignmentTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;

  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const currentIndex = tabs.findIndex((tab) => tab === document.activeElement);
  if (currentIndex < 0) return;

  event.preventDefault();
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : event.key === "ArrowRight"
        ? (currentIndex + 1) % tabs.length
        : (currentIndex - 1 + tabs.length) % tabs.length;
  tabs[nextIndex]?.focus();
  tabs[nextIndex]?.click();
}

function bulkAiLimitTitle(preflight: BulkAiPreflight) {
  if (preflight.ungradedCount === 0) {
    return "No eligible submissions";
  }
  if (preflight.allowance?.status === "subscription_unavailable") {
    return "AI billing needs attention";
  }
  if (
    preflight.allowance &&
    preflight.newUnitsRequired > preflight.allowance.remaining
  ) {
    return "Not enough AI-assisted recording units";
  }
  return "Not enough AI grading left today";
}

function bulkAiLimitDescription(preflight: BulkAiPreflight) {
  const allowance = preflight.allowance;
  if (preflight.ungradedCount === 0) {
    return "There are no ungraded submissions with audio available for this run.";
  }
  if (allowance?.status === "subscription_unavailable") {
    return "The billing period could not be verified. Refresh billing or contact support before using another AI-assisted recording unit. Recording, playback, and manual grading remain available.";
  }
  if (allowance && preflight.newUnitsRequired > allowance.remaining) {
    const nextStep =
      allowance.status === "teacher_period"
        ? "Need more? Explore TryHabla for Schools."
        : allowance.status === "free_lifetime"
          ? "Choose Teacher for 300 AI-assisted recordings per Stripe billing period."
          : "Contact TryHabla for Schools to discuss larger or custom needs.";
    return `This run will grade ${pluralize(preflight.ungradedCount, "submission")} and needs ${pluralize(preflight.newUnitsRequired, "new AI-assisted recording unit")}, but ${allowance.remaining} remain in the current allowance. Recordings already transcribed for this assignment do not use another unit. ${nextStep} Recording, playback, and manual grading remain available.`;
  }
  return `This run includes ${pluralize(preflight.ungradedCount, "submission")}, but only ${preflight.remaining} AI grading generations remain today. Saved transcripts do not use another allowance unit, but grading still needs generation capacity. Grade some by hand, or try again tomorrow when the limit resets.`;
}

function bulkAiRunDescription(preflight: BulkAiPreflight) {
  const usage = preflight.newUnitsRequired === 0
    ? "Every eligible recording already has a saved transcript, so this run uses no new AI-assisted recording units."
    : `${pluralize(preflight.newUnitsRequired, "new AI-assisted recording unit")} will be used. Recordings already transcribed for this assignment are not counted again.`;
  return `${usage} ${BULK_AI_REVIEW_DISCLOSURE} You can review and edit every suggestion before saving any scores.`;
}

function autoResizeTextarea(element: HTMLTextAreaElement) {
  element.style.height = "0px";
  element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
}

function createCriterionDraft(): RubricCriterionDraft {
  return {
    id: `criterion_${crypto.randomUUID()}`,
    name: "",
    description: "",
    maxPoints: "10",
  };
}

function rubricDraftsFromAssignment(assignment: AssignmentSummary | AssignmentView | null) {
  if (!assignment?.rubric) return [];
  return assignment.rubric.criteria.map((criterion) => ({
    id: criterion.id,
    name: criterion.name,
    description: criterion.description,
    maxPoints: String(criterion.maxPoints),
  }));
}

function parseRubricCriteria(criteria: RubricCriterionDraft[]) {
  return criteria.map((criterion) => ({
    id: criterion.id,
    name: criterion.name.trim(),
    description: criterion.description.trim(),
    maxPoints: Number(criterion.maxPoints),
  }));
}

function rubricInputsFromSubmission(
  submission: SubmissionItem,
  assignment: AssignmentSummary | AssignmentView | null
) {
  const inputs: Record<string, string> = {};
  if (!assignment?.rubric) return inputs;
  for (const criterion of assignment.rubric.criteria) {
    const existing = submission.rubricScores?.find((score) => score.criterionId === criterion.id);
    inputs[criterion.id] = existing ? String(existing.awarded) : "";
  }
  return inputs;
}

async function fileToDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read attachment."));
    reader.readAsDataURL(file);
  });
}

function readAssignmentClipboard() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ASSIGNMENT_CLIPBOARD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AssignmentClipboard;
    if (!parsed?.title || !parsed?.instructions) return null;
    return {
      ...parsed,
      sourceAssignmentId:
        typeof parsed.sourceAssignmentId === "string" ? parsed.sourceAssignmentId : "",
      hasAttachment: parsed.hasAttachment === true,
      maxSubmissions: Number.isInteger(parsed.maxSubmissions) ? parsed.maxSubmissions : 0,
      maxRecordingSeconds: Number.isInteger(parsed.maxRecordingSeconds) ? parsed.maxRecordingSeconds : 180,
    };
  } catch {
    return null;
  }
}

export default function ClassDetailPage() {
  const params = useParams<{ classId?: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const classId = params?.classId;
  const workspaceView = searchParams.get("view") === "roster" ? "roster" : "classwork";
  const requestedAssignmentId = searchParams.get("assignment")?.trim() ?? "";
  const requestedSubmissionId = searchParams.get("submission")?.trim() ?? "";

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [infoMsg, setInfoMsg] = useState("");
  const [payload, setPayload] = useState<ClassPayload | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [studentFilter, setStudentFilter] = useState("");
  const [showUngradedOnly, setShowUngradedOnly] = useState(false);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState("");
  const [assignmentView, setAssignmentView] = useState<"review" | "details" | "share">("review");
  const [copiedId, setCopiedId] = useState("");
  const [hasAssignmentClipboard, setHasAssignmentClipboard] = useState(false);

  const [assignmentEditOpen, setAssignmentEditOpen] = useState(false);
  const [assignmentTitleDraft, setAssignmentTitleDraft] = useState("");
  const [assignmentDescriptionDraft, setAssignmentDescriptionDraft] = useState("");
  const [assignmentInstructionsDraft, setAssignmentInstructionsDraft] = useState("");
  const [assignmentTargetLanguageDraft, setAssignmentTargetLanguageDraft] = useState("Spanish");
  const [assignmentUsesCustomLanguage, setAssignmentUsesCustomLanguage] = useState(false);
  const [assignmentMaxPointsDraft, setAssignmentMaxPointsDraft] = useState("100");
  const [assignmentRubricEnabled, setAssignmentRubricEnabled] = useState(false);
  const [assignmentRubricTitleDraft, setAssignmentRubricTitleDraft] = useState("");
  const [assignmentRubricCriteriaDraft, setAssignmentRubricCriteriaDraft] = useState<RubricCriterionDraft[]>([]);
  const [assignmentMaxSubmissionsDraft, setAssignmentMaxSubmissionsDraft] = useState("");
  const [assignmentMaxRecordingSecondsDraft, setAssignmentMaxRecordingSecondsDraft] = useState("180");
  const [assignmentAutoTranscribeDraft, setAssignmentAutoTranscribeDraft] = useState(false);
  const [assignmentAttachmentDraft, setAssignmentAttachmentDraft] = useState<AttachmentDraft>(null);
  const [assignmentAttachmentRemoved, setAssignmentAttachmentRemoved] = useState(false);
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");

  const [editingSubmissionId, setEditingSubmissionId] = useState("");
  const [editingSubmissionName, setEditingSubmissionName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [submissionErrors, setSubmissionErrors] = useState<Record<string, string>>({});
  const [aiGrading, setAiGrading] = useState<Record<string, boolean>>({});
  const [aiGradeErrors, setAiGradeErrors] = useState<Record<string, string>>({});
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, AiAttempt | null>>({});
  const [aiGradingEnabled, setAiGradingEnabled] = useState(false);
  const [aiBulkGradingEnabled, setAiBulkGradingEnabled] = useState(false);
  const [localAiTestMode, setLocalAiTestMode] = useState(false);

  const [bulkAiPreflight, setBulkAiPreflight] = useState<BulkAiPreflight | null>(null);
  const [bulkAiConfirmOpen, setBulkAiConfirmOpen] = useState(false);
  const [bulkAiChecking, setBulkAiChecking] = useState(false);
  const [bulkAiRunning, setBulkAiRunning] = useState(false);
  const [bulkAiBatch, setBulkAiBatch] = useState<BulkAiBatch | null>(null);
  const [bulkAiReviewOpen, setBulkAiReviewOpen] = useState(false);
  const [bulkAiSaving, setBulkAiSaving] = useState(false);
  const [bulkAiProgress, setBulkAiProgress] = useState<{ processed: number; total: number } | null>(null);
  const [bulkAiError, setBulkAiError] = useState("");
  const [bulkTranscriptDownloading, setBulkTranscriptDownloading] = useState(false);
  const [bulkTranscriptChecking, setBulkTranscriptChecking] = useState(false);
  const [bulkTranscriptPreflight, setBulkTranscriptPreflight] = useState<BulkTranscriptPreflight | null>(null);
  const [bulkTranscriptProgress, setBulkTranscriptProgress] = useState<{ processed: number; total: number } | null>(null);
  const [bulkTranscriptResult, setBulkTranscriptResult] = useState<BulkTranscriptResult | null>(null);
  const [bulkTranscriptError, setBulkTranscriptError] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState("");
  const [addStudentName, setAddStudentName] = useState("");
  const [addStudentEmail, setAddStudentEmail] = useState("");
  const [addStudentSaving, setAddStudentSaving] = useState(false);
  const [selectedStudentEmail, setSelectedStudentEmail] = useState<string | null>(null);
  const [studentDetail, setStudentDetail] = useState<StudentDetailPayload | null>(null);
  const [studentDetailLoading, setStudentDetailLoading] = useState(false);
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvResult, setCsvResult] = useState<{ added: number; skipped: number } | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const assignmentDialogRef = useRef<HTMLDivElement>(null);
  const assignmentTitleInputRef = useRef<HTMLInputElement>(null);
  const assignmentSavingRef = useRef(false);
  const bulkAiRunRef = useRef(false);
  const bulkAiAbortRef = useRef<AbortController | null>(null);
  const bulkAiIdempotencyKeyRef = useRef("");
  const hydratedAiAttemptRef = useRef(new Set<string>());
  const selectedAssignmentIdRef = useRef("");
  const bulkTranscriptUrlRef = useRef<string | null>(null);
  const bulkTranscriptAbortRef = useRef<AbortController | null>(null);
  const submissionQueueListRef = useRef<HTMLDivElement>(null);
  const manualGradingRef = useRef<HTMLDivElement>(null);
  const pendingDeleteRef = useRef<{
    key: string;
    rollback: () => void;
    commit: () => Promise<void>;
    onError: (message: string) => void;
    timerId: number;
  } | null>(null);

  const updateWorkspaceUrl = useCallback((
    updates: Record<string, string | null>,
    historyMode: "push" | "replace" = "push",
  ) => {
    if (typeof window === "undefined") return;
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const query = next.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl === currentUrl) return;
    window.history[historyMode === "replace" ? "replaceState" : "pushState"](null, "", nextUrl);
  }, []);

  const loadRoster = useCallback(async (targetClassId: string) => {
    setRosterLoading(true);
    setRosterError("");
    try {
      const response = await fetch(`/api/classes/${targetClassId}/roster`, { cache: "no-store" });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to load roster.");
      }
      const data = (await response.json()) as { items: RosterEntry[] };
      setRoster(data.items);
    } catch (error) {
      setRosterError(error instanceof Error ? error.message : "Failed to load roster.");
    } finally {
      setRosterLoading(false);
    }
  }, []);

  const loadStudentDetail = useCallback(async (targetClassId: string, email: string) => {
    setStudentDetailLoading(true);
    try {
      const response = await fetch(
        `/api/classes/${targetClassId}/students/${encodeURIComponent(email)}`,
        { cache: "no-store" }
      );
      if (!response.ok) throw new Error("Failed to load student detail.");
      const data = (await response.json()) as StudentDetailPayload;
      setStudentDetail(data);
    } catch {
      setStudentDetail(null);
    } finally {
      setStudentDetailLoading(false);
    }
  }, []);

  async function handleAddStudent() {
    const name = addStudentName.trim();
    const email = addStudentEmail.trim().toLowerCase();
    if (!name || !email || !classId) {
      setRosterError("Student name and email are required.");
      return;
    }
    setAddStudentSaving(true);
    setRosterError("");
    try {
      const response = await fetch(`/api/classes/${classId}/roster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to add student.");
      }
      const data = (await response.json()) as { items: RosterEntry[] };
      setRoster(data.items);
      setAddStudentName("");
      setAddStudentEmail("");
    } catch (error) {
      setRosterError(error instanceof Error ? error.message : "Failed to add student.");
    } finally {
      setAddStudentSaving(false);
    }
  }

  async function handleRemoveStudent(studentEmail: string) {
    if (!classId) return;
    const entry = roster.find((r) => r.studentEmail === studentEmail);
    const label = entry?.studentName ? `${entry.studentName} (${studentEmail})` : studentEmail;
    if (!confirm(`Remove ${label} from the roster?`)) return;
    setRoster((prev) => prev.filter((entry) => entry.studentEmail !== studentEmail));
    if (selectedStudentEmail === studentEmail) {
      setSelectedStudentEmail(null);
      setStudentDetail(null);
    }
    try {
      const response = await fetch(
        `/api/classes/${classId}/roster/${encodeURIComponent(studentEmail)}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        await loadRoster(classId);
      }
    } catch {
      await loadRoster(classId);
    }
  }

  async function handleCsvUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !classId) return;
    if (csvInputRef.current) csvInputRef.current.value = "";
    setCsvUploading(true);
    setCsvResult(null);
    setRosterError("");
    try {
      const text = await file.text();
      const rows = parseCsvRows(text)
        .map((row) => row.map((cell) => cell.trim()))
        .filter((row) => row.some(Boolean));
      if (rows.length === 0) throw new Error("CSV file is empty.");

      // Detect header row — supports: name, first name/last name, first_name/last_name, email
      let nameIdx = 0;
      let firstNameIdx = -1;
      let lastNameIdx = -1;
      let emailIdx = 1;
      let dataStart = 0;
      const firstCols = rows[0].map((cell) => cell.toLowerCase());
      const headerEmailIdx = firstCols.findIndex((c) => c === "email" || c === "email address");
      const headerNameIdx = firstCols.findIndex((c) => c === "name" || c === "full name" || c === "student name");
      const headerFirstIdx = firstCols.findIndex((c) => c === "first name" || c === "first_name" || c === "firstname");
      const headerLastIdx = firstCols.findIndex((c) => c === "last name" || c === "last_name" || c === "lastname");
      if (headerEmailIdx !== -1) {
        emailIdx = headerEmailIdx;
        if (headerNameIdx !== -1) {
          nameIdx = headerNameIdx;
        } else if (headerFirstIdx !== -1) {
          firstNameIdx = headerFirstIdx;
          lastNameIdx = headerLastIdx;
        } else {
          nameIdx = emailIdx === 0 ? 1 : 0;
        }
        dataStart = 1;
      }

      const students: { name: string; email: string }[] = [];
      const parseErrors: string[] = [];
      for (let i = dataStart; i < rows.length; i++) {
        const cols = rows[i];
        const name = firstNameIdx !== -1
          ? [cols[firstNameIdx] ?? "", lastNameIdx !== -1 ? (cols[lastNameIdx] ?? "") : ""].filter(Boolean).join(" ")
          : (cols[nameIdx] ?? "");
        const email = (cols[emailIdx] ?? "").toLowerCase();
        if (!name && !email) continue;
        if (!name) { parseErrors.push(`Row ${i + 1}: missing name.`); continue; }
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { parseErrors.push(`Row ${i + 1}: invalid email "${email}".`); continue; }
        students.push({ name, email });
      }
      if (parseErrors.length > 0) throw new Error(parseErrors.slice(0, 3).join(" ") + (parseErrors.length > 3 ? ` (+${parseErrors.length - 3} more)` : ""));
      if (students.length === 0) throw new Error("No valid students found in CSV.");

      const response = await fetch(`/api/classes/${classId}/roster/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ students }),
      });
      const data = (await response.json()) as { items?: RosterEntry[]; added?: number; skipped?: number; error?: string };
      if (!response.ok) throw new Error(data.error || "Failed to import roster.");
      setRoster(data.items ?? []);
      setCsvResult({ added: data.added ?? 0, skipped: data.skipped ?? 0 });
    } catch (error) {
      setRosterError(error instanceof Error ? error.message : "Failed to import CSV.");
    } finally {
      setCsvUploading(false);
    }
  }

  const loadData = useCallback(async (
    targetClassId: string,
    options?: { background?: boolean; resetDraftSubmissionIds?: ReadonlySet<string> },
  ) => {
    const background = options?.background ?? false;
    if (!background) {
      setLoading(true);
      setErrorMsg("");
    }
    try {
      const response = await fetch(`/api/classes/${targetClassId}`, { cache: "no-store" });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to load class.");
      }
      const data = (await response.json()) as ClassPayload;
      setPayload(data);
      setDrafts((prev) => mergeGradingDraftsFromServer({
        previousDrafts: prev,
        submissions: data.submissions,
        assignments: data.assignments,
        resetSubmissionIds: options?.resetDraftSubmissionIds,
      }));
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Failed to load class.");
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!classId) {
      setLoading(false);
      setErrorMsg("Missing class id.");
      return;
    }
    setHasAssignmentClipboard(Boolean(readAssignmentClipboard()));
    void loadData(classId);
    const onFocus = () => {
      setHasAssignmentClipboard(Boolean(readAssignmentClipboard()));
      void loadData(classId, { background: true });
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === ASSIGNMENT_CLIPBOARD_KEY) {
        setHasAssignmentClipboard(Boolean(readAssignmentClipboard()));
      }
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
  }, [classId, loadData]);

  useEffect(() => {
    if (!classId || workspaceView !== "roster") return;
    void loadRoster(classId);
  }, [classId, loadRoster, workspaceView]);

  useEffect(() => {
    let active = true;
    async function loadFeatures() {
      try {
        const response = await fetch("/api/features", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as {
          aiGradingEnabled?: boolean;
          aiBulkGradingEnabled?: boolean;
          localAiTestMode?: boolean;
        };
        if (active) setAiGradingEnabled(data.aiGradingEnabled === true);
        if (active) setAiBulkGradingEnabled(data.aiBulkGradingEnabled === true);
        if (active) setLocalAiTestMode(data.localAiTestMode === true);
      } catch {
        if (active) setAiGradingEnabled(false);
        if (active && process.env.NODE_ENV !== "production") {
          setAiGradeErrors((prev) => ({ ...prev, _feature: "Could not load local AI feature state." }));
        }
      }
    }
    void loadFeatures();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const created = searchParams.get("created");
    if (created === "class") setInfoMsg("Class created. Next step: create the first assignment.");
    else if (created === "assignment") setInfoMsg("Assignment created. Share the student link when ready.");
    else setInfoMsg("");
  }, [searchParams]);

  useEffect(() => {
    return () => {
      const pending = pendingDeleteRef.current;
      if (pending) {
        window.clearTimeout(pending.timerId);
        pendingDeleteRef.current = null;
        void pending.commit().catch(() => undefined);
      }
      bulkAiAbortRef.current?.abort();
      bulkTranscriptAbortRef.current?.abort();
      if (bulkTranscriptUrlRef.current) URL.revokeObjectURL(bulkTranscriptUrlRef.current);
    };
  }, []);

  useEffect(() => {
    assignmentSavingRef.current = assignmentSaving;
  }, [assignmentSaving]);

  useEffect(() => {
    if (!assignmentEditOpen) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusFrame = window.requestAnimationFrame(() => {
      assignmentTitleInputRef.current?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !assignmentSavingRef.current) {
        event.preventDefault();
        setAssignmentEditOpen(false);
        return;
      }

      if (event.key !== "Tab") return;
      const dialog = assignmentDialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR)
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [assignmentEditOpen]);

  useEffect(() => {
    selectedAssignmentIdRef.current = selectedAssignmentId;
    setBulkAiPreflight(null);
    setBulkAiConfirmOpen(false);
    setBulkAiBatch(null);
    setBulkAiReviewOpen(false);
    setBulkAiProgress(null);
    setBulkAiSaving(false);
    bulkAiIdempotencyKeyRef.current = "";
    if (!bulkAiRunRef.current) {
      setBulkAiError("");
    }
    bulkTranscriptAbortRef.current?.abort();
    bulkTranscriptAbortRef.current = null;
    if (bulkTranscriptUrlRef.current) {
      URL.revokeObjectURL(bulkTranscriptUrlRef.current);
      bulkTranscriptUrlRef.current = null;
    }
    setBulkTranscriptChecking(false);
    setBulkTranscriptDownloading(false);
    setBulkTranscriptPreflight(null);
    setBulkTranscriptProgress(null);
    setBulkTranscriptResult(null);
    setBulkTranscriptError("");
  }, [selectedAssignmentId]);

  const submissionsByAssignment = useMemo(() => {
    const grouped: Record<string, SubmissionItem[]> = {};
    if (!payload) return grouped;
    for (const sub of payload.submissions) {
      if (!grouped[sub.assignmentId]) grouped[sub.assignmentId] = [];
      grouped[sub.assignmentId].push(sub);
    }
    return grouped;
  }, [payload]);

  const filteredByAssignment = useMemo(() => {
    const grouped: Record<string, SubmissionItem[]> = {};
    for (const [assignmentId, submissions] of Object.entries(submissionsByAssignment)) {
      grouped[assignmentId] = submissions.filter((item) => {
        const matchesStudent = item.studentName.toLowerCase().includes(studentFilter.trim().toLowerCase());
        const matchesGrade = showUngradedOnly ? item.grade === null : true;
        return matchesStudent && matchesGrade;
      });
    }
    return grouped;
  }, [showUngradedOnly, studentFilter, submissionsByAssignment]);

  const workspaceStats = useMemo(() => {
    if (!payload) return { pending: 0, graded: 0 };
    const pending = payload.submissions.filter((item) => item.grade === null).length;
    return { pending, graded: payload.submissions.length - pending };
  }, [payload]);

  const assignmentViews = useMemo<AssignmentView[]>(() => {
    if (!payload) return [];
    return payload.assignments.map((assignment) => {
      const all = submissionsByAssignment[assignment.id] ?? [];
      const ungradedCount = all.filter((s) => s.grade === null).length;
      const tone: Tone = all.length === 0 ? "neutral" : ungradedCount > 0 ? "warning" : "success";
      const label = all.length === 0 ? "No submissions" : ungradedCount > 0 ? "Needs grading" : "Grading complete";
      return { ...assignment, totalSubmissions: all.length, ungradedCount, tone, label };
    });
  }, [payload, submissionsByAssignment]);

  useEffect(() => {
    if (assignmentViews.length === 0) {
      setSelectedAssignmentId("");
      return;
    }
    const requestedAssignment = assignmentViews.find((assignment) => assignment.id === requestedAssignmentId);
    const nextAssignmentId = requestedAssignment?.id ?? assignmentViews[0].id;
    if (nextAssignmentId !== selectedAssignmentId) {
      setSelectedAssignmentId(nextAssignmentId);
    }
    if (requestedAssignmentId && !requestedAssignment) {
      updateWorkspaceUrl({ assignment: nextAssignmentId, submission: null }, "replace");
    }
  }, [assignmentViews, requestedAssignmentId, selectedAssignmentId, updateWorkspaceUrl]);

  const activeAssignment = assignmentViews.find((assignment) => assignment.id === selectedAssignmentId) ?? assignmentViews[0] ?? null;
  const activeAssignmentId = activeAssignment?.id ?? "";
  const activeAllSubmissions = activeAssignment ? submissionsByAssignment[activeAssignment.id] ?? [] : [];
  const activeFilteredSubmissions = activeAssignment ? filteredByAssignment[activeAssignment.id] ?? [] : [];
  const focusedSubmission = activeFilteredSubmissions.find((submission) => submission.id === requestedSubmissionId)
    ?? activeFilteredSubmissions[0]
    ?? null;
  const focusedSubmissionIndex = focusedSubmission
    ? activeFilteredSubmissions.findIndex((submission) => submission.id === focusedSubmission.id)
    : -1;
  const previousSubmission = focusedSubmissionIndex > 0
    ? activeFilteredSubmissions[focusedSubmissionIndex - 1]
    : null;
  const nextSubmission = focusedSubmissionIndex >= 0 && focusedSubmissionIndex < activeFilteredSubmissions.length - 1
    ? activeFilteredSubmissions[focusedSubmissionIndex + 1]
    : null;

  useEffect(() => {
    if (!aiBulkGradingEnabled || !activeAssignmentId || assignmentView !== "review") return;
    const assignmentId = activeAssignmentId;
    const controller = new AbortController();
    setBulkAiChecking(true);

    void (async () => {
      try {
        const response = await fetch(
          `/api/assignments/${encodeURIComponent(assignmentId)}/ai-grade-all`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = (await response.json()) as BulkAiPreflight & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Could not check AI grading.");
        if (controller.signal.aborted || selectedAssignmentIdRef.current !== assignmentId) return;
        setBulkAiPreflight({ ...data, activeBatch: data.activeBatch ?? null });
        setBulkAiBatch(data.activeBatch ?? null);
      } catch (error) {
        if (!controller.signal.aborted) {
          setBulkAiError(error instanceof Error ? error.message : "Could not check AI grading.");
        }
      } finally {
        if (!controller.signal.aborted) setBulkAiChecking(false);
      }
    })();

    return () => controller.abort();
  }, [activeAssignmentId, aiBulkGradingEnabled, assignmentView]);

  useEffect(() => {
    if (!aiGradingEnabled || !focusedSubmission || focusedSubmission.grade !== null) return;
    const submissionId = focusedSubmission.id;
    if (aiSuggestions[submissionId] || hydratedAiAttemptRef.current.has(submissionId)) return;
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(
          `/api/submissions/${encodeURIComponent(submissionId)}/ai-grade`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) return;
        const data = (await response.json()) as { latest?: AiAttempt | null };
        const attempt = data.latest;
        if (
          controller.signal.aborted ||
          !attempt ||
          attempt.status !== "completed" ||
          attempt.suggestedScore === null ||
          attempt.teacherAttention === "unable_to_grade"
        ) return;

        hydratedAiAttemptRef.current.add(submissionId);
        const stagedAttempt = { ...attempt, gradeApplied: false };
        setAiSuggestions((previous) => ({ ...previous, [submissionId]: stagedAttempt }));
        setDrafts((previous) => ({
          ...previous,
          [submissionId]: {
            gradeInput: String(attempt.suggestedScore),
            feedback: attempt.feedback,
            saving: previous[submissionId]?.saving ?? false,
            rubricScoreInputs: Object.fromEntries(
              attempt.rubricScores.map((score) => [score.criterionId, String(score.awarded)]),
            ),
          },
        }));
      } catch {
        // Loading a saved suggestion is a convenience. Manual grading remains available.
      }
    })();

    return () => controller.abort();
  }, [aiGradingEnabled, aiSuggestions, focusedSubmission]);

  useEffect(() => {
    const queue = submissionQueueListRef.current;
    if (!queue || !focusedSubmission) return;

    const activeItem = Array.from(
      queue.querySelectorAll<HTMLElement>("[data-submission-id]")
    ).find((item) => item.dataset.submissionId === focusedSubmission.id);
    if (!activeItem) return;

    const queueRect = queue.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();
    let nextLeft = queue.scrollLeft;
    let nextTop = queue.scrollTop;

    if (itemRect.left < queueRect.left) nextLeft -= queueRect.left - itemRect.left + 8;
    else if (itemRect.right > queueRect.right) nextLeft += itemRect.right - queueRect.right + 8;

    if (itemRect.top < queueRect.top) nextTop -= queueRect.top - itemRect.top + 8;
    else if (itemRect.bottom > queueRect.bottom) nextTop += itemRect.bottom - queueRect.bottom + 8;

    if (nextLeft === queue.scrollLeft && nextTop === queue.scrollTop) return;
    queue.scrollTo({
      left: Math.max(0, nextLeft),
      top: Math.max(0, nextTop),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [focusedSubmission]);

  const bulkAiWorkflowActive =
    bulkAiRunning ||
    bulkAiSaving ||
    bulkTranscriptChecking ||
    bulkTranscriptDownloading ||
    bulkTranscriptPreflight !== null;
  const bulkAiBatchNeedsReview = Boolean(
    bulkAiBatch &&
    ["review_ready", "partial_failure"].includes(bulkAiBatch.status) &&
    bulkAiBatch.counts.reviewReady > 0,
  );
  const bulkAiBatchNeedsAttention = Boolean(
    bulkAiBatch &&
    bulkAiBatch.status === "partial_failure" &&
    bulkAiBatch.counts.reviewReady === 0 &&
    bulkAiBatch.counts.failed + bulkAiBatch.counts.skipped + bulkAiBatch.counts.conflict > 0,
  );
  const bulkAiEligibleCount = bulkAiBatch?.eligibleCount ?? bulkAiPreflight?.ungradedCount ?? 0;
  const bulkAiTranscriptsRequired =
    bulkAiPreflight?.transcriptsRequired ?? bulkAiPreflight?.newUnitsRequired ?? 0;
  const bulkAiProcessed = bulkAiProgress?.processed ?? (
    bulkAiBatch
      ? bulkAiBatch.counts.total - bulkAiBatch.counts.queued - bulkAiBatch.counts.processing
      : 0
  );
  const bulkAiTotal = bulkAiProgress?.total ?? bulkAiBatch?.counts.total ?? bulkAiEligibleCount;
  const bulkAiProcessingItem = bulkAiBatch?.items.find((item) => item.status === "processing") ?? null;

  function updatePayloadSubmissions(updater: (items: SubmissionItem[]) => SubmissionItem[]) {
    setPayload((prev) => (prev ? { ...prev, submissions: updater(prev.submissions) } : prev));
  }

  function updatePayloadAssignments(updater: (items: AssignmentSummary[]) => AssignmentSummary[]) {
    setPayload((prev) => (prev ? { ...prev, assignments: updater(prev.assignments) } : prev));
  }

  function setDraft(submissionId: string, update: Partial<DraftState>) {
    setDrafts((prev) => ({
      ...prev,
      [submissionId]: {
        gradeInput: prev[submissionId]?.gradeInput ?? "",
        feedback: prev[submissionId]?.feedback ?? "",
        saving: prev[submissionId]?.saving ?? false,
        rubricScoreInputs: prev[submissionId]?.rubricScoreInputs ?? {},
        ...update,
      },
    }));
  }

  function isSubmissionDraftDirty(
    submission: SubmissionItem,
    assignment: AssignmentSummary | AssignmentView,
  ) {
    return gradingDraftIsDirty(drafts[submission.id], submission, assignment);
  }

  function dirtyDraftCountForAssignment(assignmentId: string) {
    const assignment = assignmentViews.find((item) => item.id === assignmentId);
    if (!assignment) return 0;
    return (submissionsByAssignment[assignmentId] ?? []).filter(
      (submission) =>
        submission.grade === null &&
        !(submission.feedback ?? "").trim() &&
        submission.rubricScores === null &&
        isSubmissionDraftDirty(submission, assignment),
    ).length;
  }

  function unsavedDraftCountForAssignment(assignmentId: string) {
    const assignment = assignmentViews.find((item) => item.id === assignmentId);
    if (!assignment) return 0;
    return (submissionsByAssignment[assignmentId] ?? []).filter((submission) =>
      isSubmissionDraftDirty(submission, assignment)
    ).length;
  }

  const hasUnsavedDrafts = assignmentViews.some(
    (assignment) => unsavedDraftCountForAssignment(assignment.id) > 0,
  );

  useEffect(() => {
    if (!hasUnsavedDrafts) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasUnsavedDrafts]);

  async function saveSubmission(submissionId: string) {
    const draft = drafts[submissionId];
    const existing = payload?.submissions.find((item) => item.id === submissionId);
    if (!draft || !existing) return;
    const maxPoints = activeAssignment?.maxPoints ?? 100;
    const rubric = activeAssignment?.rubric ?? null;
    let parsedGrade: number | null = null;
    let rubricScores:
      | {
          criterionId: string;
          criterionName: string;
          maxPoints: number;
          awarded: number;
        }[]
      | null = null;

    if (rubric) {
      rubricScores = [];
      for (const criterion of rubric.criteria) {
        const value = draft.rubricScoreInputs[criterion.id]?.trim() ?? "";
        if (value === "") {
          setSubmissionErrors((prev) => ({
            ...prev,
            [submissionId]: `Enter a score for ${criterion.name}.`,
          }));
          return;
        }
        const awarded = Number(value);
        if (!Number.isInteger(awarded) || awarded < 0 || awarded > criterion.maxPoints) {
          setSubmissionErrors((prev) => ({
            ...prev,
            [submissionId]: `${criterion.name} must be a whole number from 0 to ${criterion.maxPoints}.`,
          }));
          return;
        }
        rubricScores.push({
          criterionId: criterion.id,
          criterionName: criterion.name,
          maxPoints: criterion.maxPoints,
          awarded,
        });
      }
      parsedGrade = rubricScores.reduce((sum, item) => sum + item.awarded, 0);
    } else {
      const clean = draft.gradeInput.trim();
      if (clean !== "") {
        const numericGrade = Number(clean);
        if (!Number.isFinite(numericGrade) || numericGrade < 0 || numericGrade > maxPoints) {
          setSubmissionErrors((prev) => ({ ...prev, [submissionId]: `Score must be a number from 0 to ${maxPoints}.` }));
          return;
        }
        parsedGrade = numericGrade;
      }
    }

    setDraft(submissionId, { saving: true });
    setSubmissionErrors((prev) => ({ ...prev, [submissionId]: "" }));
    updatePayloadSubmissions((items) =>
      items.map((row) =>
        row.id === submissionId
          ? {
              ...row,
              grade: parsedGrade,
              feedback: draft.feedback,
              gradeSource: "teacher",
              rubricScores,
            }
          : row
      )
    );

    try {
      const response = await fetch(`/api/submissions/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          rubric
            ? { rubricScores, feedback: draft.feedback }
            : { grade: parsedGrade, feedback: draft.feedback }
        ),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to save grade.");
      }
      const updated = (await response.json()) as { item?: SubmissionItem | null };
      if (updated.item) {
        updatePayloadSubmissions((items) => items.map((row) => (row.id === submissionId ? updated.item! : row)));
      }
      setInfoMsg("Grade saved.");
      window.setTimeout(() => setInfoMsg(""), 1300);
    } catch (error) {
      updatePayloadSubmissions((items) =>
        items.map((row) =>
          row.id === submissionId
            ? {
                ...row,
                grade: existing.grade,
                feedback: existing.feedback,
                gradeSource: existing.gradeSource,
                rubricScores: existing.rubricScores,
              }
            : row
        )
      );
      setSubmissionErrors((prev) => ({ ...prev, [submissionId]: error instanceof Error ? error.message : "Failed to save grade." }));
    } finally {
      setDraft(submissionId, { saving: false });
    }
  }

  async function saveSubmissionName(submission: SubmissionItem) {
    const name = editingSubmissionName.trim();
    if (!name) {
      setSubmissionErrors((prev) => ({ ...prev, [submission.id]: "Student name is required." }));
      return;
    }
    setNameSaving(true);
    setSubmissionErrors((prev) => ({ ...prev, [submission.id]: "" }));
    updatePayloadSubmissions((items) => items.map((row) => (row.id === submission.id ? { ...row, studentName: name } : row)));
    setEditingSubmissionId("");
    setEditingSubmissionName("");

    try {
      const response = await fetch(`/api/submissions/${submission.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentName: name }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Unable to update student name.");
      }
    } catch (error) {
      updatePayloadSubmissions((items) => items.map((row) => (row.id === submission.id ? { ...row, studentName: submission.studentName } : row)));
      setSubmissionErrors((prev) => ({ ...prev, [submission.id]: error instanceof Error ? error.message : "Unable to update student name." }));
    } finally {
      setNameSaving(false);
    }
  }

  function applySavedAiAttempt(submissionId: string, attempt: AiAttempt) {
    setAiSuggestions((prev) => ({ ...prev, [submissionId]: attempt }));
    if (attempt.suggestedScore === null) return;

    const rubricScoreInputs = Object.fromEntries(
      attempt.rubricScores.map((score) => [score.criterionId, String(score.awarded)]),
    );
    setDraft(submissionId, {
      gradeInput: String(attempt.suggestedScore),
      feedback: attempt.feedback,
      rubricScoreInputs,
    });
    if (!attempt.gradeApplied) return;

    updatePayloadSubmissions((items) =>
      items.map((row) =>
        row.id === submissionId
          ? {
              ...row,
              grade: attempt.suggestedScore,
              feedback: attempt.feedback,
              gradeSource: "ai",
              rubricScores: attempt.rubricScores.length > 0 ? attempt.rubricScores : null,
            }
          : row,
      ),
    );
  }

  async function aiGradeSubmission(submissionId: string) {
    setAiGrading((prev) => ({ ...prev, [submissionId]: true }));
    setAiGradeErrors((prev) => ({ ...prev, [submissionId]: "" }));
    try {
      const response = await fetch(`/api/submissions/${submissionId}/ai-grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewOnly: true }),
      });
      const data = (await response.json()) as {
        attempt?: AiAttempt;
        gradeApplied?: boolean;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "AI grading failed.");
      }
      const attempt = data.attempt
        ? { ...data.attempt, gradeApplied: data.gradeApplied === true }
        : null;
      if (attempt) applySavedAiAttempt(submissionId, attempt);
      else setAiSuggestions((prev) => ({ ...prev, [submissionId]: null }));
      if (data.attempt?.status === "failed") {
        setAiGradeErrors((prev) => ({ ...prev, [submissionId]: "AI could not prepare a suggestion for this submission." }));
      }
    } catch (error) {
      setAiGradeErrors((prev) => ({
        ...prev,
        [submissionId]: error instanceof Error ? error.message : "AI grading failed.",
      }));
    } finally {
      setAiGrading((prev) => ({ ...prev, [submissionId]: false }));
    }
  }

  async function fetchBulkAiSummary(assignmentId: string, signal?: AbortSignal) {
    const response = await fetch(
      `/api/assignments/${assignmentId}/ai-grade-all`,
      { cache: "no-store", signal },
    );
    const data = (await response.json()) as BulkAiPreflight & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Could not check AI grading.");
    return { ...data, activeBatch: data.activeBatch ?? null };
  }

  // Refresh immediately before opening a paid workflow so the count, allowance,
  // and durable active batch always come from the server rather than page state.
  async function openBulkAiConfirm(assignmentId: string) {
    if (bulkAiRunRef.current) return;
    if (Object.values(aiGrading).some(Boolean)) {
      setBulkAiError("Wait for the current AI suggestion to finish before grading the assignment.");
      return;
    }
    if (bulkAiBatch?.assignmentId === assignmentId) {
      if (["review_ready", "partial_failure"].includes(bulkAiBatch.status)) {
        setBulkAiReviewOpen(true);
        return;
      }
      if (["queued", "processing"].includes(bulkAiBatch.status)) {
        const summary = bulkAiPreflight ?? {
          assignmentId,
          confirmationToken: "",
          ungradedCount: bulkAiBatch.eligibleCount,
          submissionIds: bulkAiBatch.items.map((item) => item.submissionId),
          newUnitsRequired: bulkAiBatch.newUnitsRequired,
          remaining: 0,
          fits: true,
          estimatedSeconds: 0,
          cooldownSeconds: 0,
          allowance: null,
          transcriptsRequired: bulkAiBatch.transcriptsRequired,
          savedTranscripts: bulkAiBatch.savedTranscripts,
          activeBatch: bulkAiBatch,
          confirmationScope: {
            assignmentId,
            assignmentFingerprint: bulkAiBatch.assignmentFingerprint,
            submissionIds: bulkAiBatch.items.map((item) => item.submissionId),
            eligibleCount: bulkAiBatch.eligibleCount,
            newUnitsRequired: bulkAiBatch.newUnitsRequired,
            transcriptsRequired: bulkAiBatch.transcriptsRequired,
          },
        };
        void runBulkAiGrade({ ...summary, activeBatch: bulkAiBatch });
        return;
      }
    }

    const dirtyBeforeCheck = dirtyDraftCountForAssignment(assignmentId);
    if (dirtyBeforeCheck > 0) {
      setBulkAiError(
        `Save or clear unsaved grading changes for ${pluralize(dirtyBeforeCheck, "submission")} before starting AI grading.`,
      );
      manualGradingRef.current?.scrollIntoView({ block: "start" });
      return;
    }
    setBulkAiChecking(true);
    setBulkAiError("");
    try {
      const data = await fetchBulkAiSummary(assignmentId);
      if (selectedAssignmentIdRef.current !== assignmentId) {
        throw new Error("The selected assignment changed. Check AI grading again.");
      }
      setBulkAiPreflight(data);
      setBulkAiBatch(data.activeBatch);
      if (data.activeBatch && ["review_ready", "partial_failure"].includes(data.activeBatch.status)) {
        setBulkAiReviewOpen(true);
      } else if (data.activeBatch && ["queued", "processing"].includes(data.activeBatch.status)) {
        void runBulkAiGrade(data);
      } else {
        setBulkAiConfirmOpen(true);
      }
    } catch (error) {
      setBulkAiError(error instanceof Error ? error.message : "Could not check AI grading.");
    } finally {
      setBulkAiChecking(false);
    }
  }

  async function runBulkAiGrade(preflight: BulkAiPreflight) {
    if (bulkAiRunRef.current) return;
    setBulkAiConfirmOpen(false);
    if (activeAssignment?.id !== preflight.assignmentId) {
      setBulkAiError("The selected assignment changed. Check the AI grading run again.");
      return;
    }
    if (Object.values(aiGrading).some(Boolean)) {
      setBulkAiError("Wait for the current AI suggestion to finish before grading the assignment.");
      return;
    }
    const dirtyCount = dirtyDraftCountForAssignment(preflight.assignmentId);
    if (dirtyCount > 0) {
      setBulkAiError(
        `Save or clear unsaved grading changes for ${pluralize(dirtyCount, "submission")} before starting AI grading.`,
      );
      return;
    }

    const controller = new AbortController();
    bulkAiAbortRef.current?.abort();
    bulkAiAbortRef.current = controller;
    bulkAiRunRef.current = true;
    setBulkAiRunning(true);
    setBulkAiError("");
    try {
      let batch = preflight.activeBatch;
      if (!batch) {
        if (!bulkAiIdempotencyKeyRef.current) {
          bulkAiIdempotencyKeyRef.current = `assignment-${preflight.assignmentId}-${crypto.randomUUID()}`;
        }
        const created = await createOrResumeBulkAiBatch({
          assignmentId: preflight.assignmentId,
          idempotencyKey: bulkAiIdempotencyKeyRef.current,
          confirmationToken: preflight.confirmationToken,
          signal: controller.signal,
        });
        batch = created.batch;
        setBulkAiBatch(batch);
      }

      setBulkAiProgress({
        processed: batch.counts.total - batch.counts.queued - batch.counts.processing,
        total: batch.counts.total,
      });
      const result = await runBulkAiBatch({
        batch,
        signal: controller.signal,
        onProgress: (progressBatch) => {
          setBulkAiBatch(progressBatch);
          setBulkAiProgress({
            processed:
              progressBatch.counts.total -
              progressBatch.counts.queued -
              progressBatch.counts.processing,
            total: progressBatch.counts.total,
          });
        },
      });
      setBulkAiBatch(result);
      setBulkAiPreflight((previous) => previous ? { ...previous, activeBatch: result } : previous);
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof BulkAiBatchRequestError) {
          const serverBatch = error.payload?.batch as BulkAiBatch | undefined;
          if (serverBatch) setBulkAiBatch(serverBatch);
          if (error.code === "confirmation_scope_changed") {
            const freshPreflight = bulkAiPreflightFromScopeError<BulkAiPreflight>(
              error,
              preflight.assignmentId,
            );
            if (freshPreflight) {
              setBulkAiPreflight({
                ...freshPreflight,
                activeBatch: freshPreflight.activeBatch ?? null,
              });
              setBulkAiBatch(freshPreflight.activeBatch ?? null);
              bulkAiIdempotencyKeyRef.current = "";
            }
          } else if (error.code === "assignment_changed") {
            try {
              const freshPreflight = await fetchBulkAiSummary(preflight.assignmentId);
              setBulkAiPreflight(freshPreflight);
              setBulkAiBatch(freshPreflight.activeBatch);
              bulkAiIdempotencyKeyRef.current = "";
            } catch {
              // Preserve the actionable server error if the follow-up refresh fails.
            }
          }
        }
        setBulkAiError(error instanceof Error ? error.message : "Bulk AI grading failed.");
      }
    } finally {
      if (bulkAiAbortRef.current === controller) bulkAiAbortRef.current = null;
      bulkAiRunRef.current = false;
      if (!controller.signal.aborted) {
        setBulkAiRunning(false);
        setBulkAiProgress(null);
      }
    }
  }

  async function retryBulkAiFailures(latestBatch?: BulkAiBatch) {
    const batchToRetry = latestBatch ?? bulkAiBatch;
    if (!batchToRetry || bulkAiRunRef.current) return;
    const controller = new AbortController();
    bulkAiAbortRef.current?.abort();
    bulkAiAbortRef.current = controller;
    bulkAiRunRef.current = true;
    setBulkAiRunning(true);
    setBulkAiReviewOpen(false);
    setBulkAiError("");
    try {
      const result = await runBulkAiBatch({
        batch: batchToRetry,
        retryFailed: true,
        signal: controller.signal,
        onProgress: (progressBatch) => {
          setBulkAiBatch(progressBatch);
          setBulkAiProgress({
            processed: progressBatch.counts.total - progressBatch.counts.queued - progressBatch.counts.processing,
            total: progressBatch.counts.total,
          });
        },
      });
      setBulkAiBatch(result);
      setBulkAiReviewOpen(["review_ready", "partial_failure"].includes(result.status));
    } catch (error) {
      if (!controller.signal.aborted) {
        setBulkAiError(error instanceof Error ? error.message : "Could not retry AI grading.");
        setBulkAiReviewOpen(true);
      }
    } finally {
      if (bulkAiAbortRef.current === controller) bulkAiAbortRef.current = null;
      bulkAiRunRef.current = false;
      if (!controller.signal.aborted) {
        setBulkAiRunning(false);
        setBulkAiProgress(null);
      }
    }
  }

  async function dismissTerminalBulkAiBatch() {
    const batchToDismiss = bulkAiBatch;
    if (
      !batchToDismiss ||
      bulkAiSaving ||
      batchToDismiss.counts.reviewReady > 0 ||
      batchToDismiss.counts.queued > 0 ||
      batchToDismiss.counts.processing > 0
    ) return;
    if (!window.confirm(
      "Dismiss this finished AI batch? Its failed or skipped submissions will stay ungraded so you can grade them manually or start a new AI run.",
    )) return;

    setBulkAiSaving(true);
    setBulkAiError("");
    try {
      const result = await closeBulkAiBatch({ batchId: batchToDismiss.id });
      bulkAiIdempotencyKeyRef.current = "";
      setBulkAiBatch(result.batch);
      setBulkAiReviewOpen(false);
      setInfoMsg("The finished AI batch was dismissed. Unscored submissions are still waiting for you.");
      try {
        const summary = await fetchBulkAiSummary(batchToDismiss.assignmentId);
        setBulkAiPreflight(summary);
        setBulkAiBatch(summary.activeBatch);
      } catch {
        setBulkAiError("The batch was dismissed, but the refreshed grading queue could not load. Reload before starting another AI run.");
      }
    } catch (error) {
      if (error instanceof BulkAiBatchRequestError) {
        const serverBatch = error.payload?.batch as BulkAiBatch | undefined;
        if (serverBatch) setBulkAiBatch(serverBatch);
      }
      setBulkAiError(error instanceof Error ? error.message : "Could not dismiss this AI grading batch.");
    } finally {
      setBulkAiSaving(false);
    }
  }

  async function saveReviewedBulkAiGrades(items: BulkAiBatchSaveItem[]) {
    if (!bulkAiBatch || bulkAiSaving) return;
    setBulkAiSaving(true);
    setBulkAiError("");
    try {
      const result = await saveBulkAiBatch({ batchId: bulkAiBatch.id, items });
      const resetDraftSubmissionIds = cleanBatchSavedDraftIds({
        batchItems: result.batch.items,
        drafts,
        submissions: payload?.submissions ?? [],
        assignments: payload?.assignments ?? [],
      });
      const synchronizedSubmissions = applyBatchSavedGrades({
        submissions: payload?.submissions ?? [],
        batchItems: result.batch.items,
      });
      setBulkAiBatch(result.batch);
      setBulkAiReviewOpen(false);
      if (payload) {
        setPayload((previous) => previous ? {
          ...previous,
          submissions: applyBatchSavedGrades({
            submissions: previous.submissions,
            batchItems: result.batch.items,
          }),
        } : previous);
        setDrafts((previous) => mergeGradingDraftsFromServer({
          previousDrafts: previous,
          submissions: synchronizedSubmissions,
          assignments: payload.assignments,
          resetSubmissionIds: resetDraftSubmissionIds,
        }));
      }
      setInfoMsg(result.saved ? "All reviewed AI scores were saved." : "These reviewed scores were already saved.");
      try {
        if (classId) {
          await loadData(classId, {
            background: true,
            resetDraftSubmissionIds,
          });
        }
        const summary = await fetchBulkAiSummary(bulkAiBatch.assignmentId);
        setBulkAiPreflight(summary);
        setBulkAiBatch(summary.activeBatch);
      } catch {
        setBulkAiError("The scores were saved, but the refreshed queue could not load. Reload to see the latest grading status.");
      }
    } catch (error) {
      if (error instanceof BulkAiBatchRequestError) {
        const serverBatch = error.payload?.batch as BulkAiBatch | undefined;
        if (serverBatch) setBulkAiBatch(serverBatch);
      }
      setBulkAiError(error instanceof Error ? error.message : "Could not save the reviewed scores.");
    } finally {
      setBulkAiSaving(false);
    }
  }

  async function downloadAllSavedTranscripts() {
    if (!activeAssignment || activeAllSubmissions.length === 0) return;
    const assignmentTitle = activeAssignment.title;
    const submissions = activeAllSubmissions.map((submission) => ({
      id: submission.id,
      studentName: submission.studentName,
      submittedAt: submission.submittedAt,
    }));

    bulkTranscriptAbortRef.current?.abort();
    if (bulkTranscriptUrlRef.current) {
      URL.revokeObjectURL(bulkTranscriptUrlRef.current);
      bulkTranscriptUrlRef.current = null;
    }
    const controller = new AbortController();
    bulkTranscriptAbortRef.current = controller;
    setBulkTranscriptDownloading(true);
    setBulkTranscriptResult(null);
    setBulkTranscriptError("");
    try {
      const result = await prepareBulkTranscriptDownload({
        assignmentTitle,
        submissions,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      const downloadUrl = result.archive ? URL.createObjectURL(result.archive) : null;
      bulkTranscriptUrlRef.current = downloadUrl;
      setBulkTranscriptResult({
        total: result.total,
        included: result.included,
        unavailable: result.unavailable,
        needsReview: result.needsReview,
        generated: 0,
        reused: result.included,
        failed: 0,
        uncertain: 0,
        notProcessed: 0,
        terminalError: "",
        downloadUrl,
        archiveFilename: result.archiveFilename,
      });

      if (downloadUrl && result.archiveFilename) {
        const anchor = document.createElement("a");
        anchor.href = downloadUrl;
        anchor.download = result.archiveFilename;
        anchor.rel = "noopener";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setBulkTranscriptError(
          error instanceof Error ? error.message : "Could not prepare transcript downloads.",
        );
      }
    } finally {
      if (bulkTranscriptAbortRef.current === controller) {
        bulkTranscriptAbortRef.current = null;
      }
      if (!controller.signal.aborted) setBulkTranscriptDownloading(false);
    }
  }

  async function openBulkTranscriptConfirm() {
    if (!activeAssignment || activeAllSubmissions.length === 0) return;
    const submissions = activeAllSubmissions.map((submission) => ({
      id: submission.id,
      studentName: submission.studentName,
      submittedAt: submission.submittedAt,
    }));

    bulkTranscriptAbortRef.current?.abort();
    const controller = new AbortController();
    bulkTranscriptAbortRef.current = controller;
    setBulkTranscriptChecking(true);
    setBulkTranscriptResult(null);
    setBulkTranscriptError("");
    try {
      const preflight = await preflightBulkTranscripts({
        submissions,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setBulkTranscriptPreflight(preflight);
    } catch (error) {
      if (!controller.signal.aborted) {
        setBulkTranscriptError(
          error instanceof Error ? error.message : "Could not check transcript status.",
        );
      }
    } finally {
      if (bulkTranscriptAbortRef.current === controller) bulkTranscriptAbortRef.current = null;
      if (!controller.signal.aborted) setBulkTranscriptChecking(false);
    }
  }

  async function generateAndDownloadTranscripts() {
    if (!activeAssignment || !bulkTranscriptPreflight || activeAllSubmissions.length === 0) return;
    const assignmentTitle = activeAssignment.title;
    const preflight = bulkTranscriptPreflight;
    const submissions = activeAllSubmissions.map((submission) => ({
      id: submission.id,
      studentName: submission.studentName,
      submittedAt: submission.submittedAt,
    }));

    setBulkTranscriptPreflight(null);
    bulkTranscriptAbortRef.current?.abort();
    if (bulkTranscriptUrlRef.current) {
      URL.revokeObjectURL(bulkTranscriptUrlRef.current);
      bulkTranscriptUrlRef.current = null;
    }
    const controller = new AbortController();
    bulkTranscriptAbortRef.current = controller;
    setBulkTranscriptDownloading(true);
    setBulkTranscriptProgress({
      processed: preflight.reusedSubmissionIds.length + preflight.unreadableSubmissionIds.length,
      total: preflight.total,
    });
    setBulkTranscriptResult(null);
    setBulkTranscriptError("");
    try {
      const result = await runBulkTranscriptRequests({
        assignmentTitle,
        submissions,
        preflight,
        signal: controller.signal,
        onProgress: (_summary, processed) => {
          setBulkTranscriptProgress({ processed, total: preflight.total });
        },
      });
      if (controller.signal.aborted) return;

      const downloadUrl = result.archive.archive
        ? URL.createObjectURL(result.archive.archive)
        : null;
      bulkTranscriptUrlRef.current = downloadUrl;
      setBulkTranscriptResult({
        total: result.total,
        included: result.archive.included,
        unavailable: result.archive.unavailable,
        needsReview: result.archive.needsReview,
        generated: result.generated,
        reused: result.reused,
        failed: result.failed,
        uncertain: result.uncertain,
        notProcessed: result.notProcessed,
        terminalError: result.terminalError,
        downloadUrl,
        archiveFilename: result.archive.archiveFilename,
      });

      if (downloadUrl && result.archive.archiveFilename) {
        const anchor = document.createElement("a");
        anchor.href = downloadUrl;
        anchor.download = result.archive.archiveFilename;
        anchor.rel = "noopener";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setBulkTranscriptError(
          error instanceof Error ? error.message : "Could not generate transcript downloads.",
        );
      }
    } finally {
      if (bulkTranscriptAbortRef.current === controller) bulkTranscriptAbortRef.current = null;
      if (!controller.signal.aborted) {
        setBulkTranscriptDownloading(false);
        setBulkTranscriptProgress(null);
      }
    }
  }

  function applyAiSuggestion(submissionId: string, attempt: AiAttempt) {
    const rubricInputs: Record<string, string> = {};
    if (activeAssignment?.rubric) {
      for (const score of attempt.rubricScores) {
        rubricInputs[score.criterionId] = String(score.awarded);
      }
    }
    setDraft(submissionId, {
      ...(activeAssignment?.rubric
        ? { rubricScoreInputs: rubricInputs }
        : { gradeInput: attempt.suggestedScore === null ? "" : String(attempt.suggestedScore) }),
      feedback: attempt.feedback,
    });
    setAiGradeErrors((prev) => ({
      ...prev,
      [submissionId]: "Suggestion copied into the unsaved draft. Select Save grade to finalize.",
    }));
  }

  function openAssignmentEditModal() {
    if (!activeAssignment) return;
    const targetLanguage = activeAssignment.targetLanguage?.trim() || "Spanish";
    setAssignmentTitleDraft(activeAssignment.title);
    setAssignmentDescriptionDraft(activeAssignment.description);
    setAssignmentInstructionsDraft(activeAssignment.instructions);
    setAssignmentTargetLanguageDraft(targetLanguage);
    setAssignmentUsesCustomLanguage(
      !ASSIGNMENT_LANGUAGE_OPTIONS.some((language) => language === targetLanguage)
    );
    setAssignmentMaxPointsDraft(String(activeAssignment.maxPoints));
    setAssignmentRubricEnabled(Boolean(activeAssignment.rubric));
    setAssignmentRubricTitleDraft(activeAssignment.rubric?.title ?? "");
    setAssignmentRubricCriteriaDraft(
      activeAssignment.rubric ? rubricDraftsFromAssignment(activeAssignment) : []
    );
    setAssignmentMaxSubmissionsDraft(String(activeAssignment.maxSubmissions || ""));
    setAssignmentMaxRecordingSecondsDraft(String(activeAssignment.maxRecordingSeconds || 180));
    setAssignmentAutoTranscribeDraft(activeAssignment.autoTranscribe === true);
    setAssignmentAttachmentDraft(null);
    setAssignmentAttachmentRemoved(false);
    setAssignmentError("");
    setAssignmentEditOpen(true);
  }

  async function handleAssignmentAttachmentChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      setAssignmentAttachmentDraft(null);
      return;
    }
    if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type)) {
      setAssignmentError("Attachment must be a PDF, PNG, or JPG file.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_ASSIGNMENT_ATTACHMENT_BYTES) {
      setAssignmentError("Attachment is too large. Maximum size is 3 MB.");
      event.target.value = "";
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      setAssignmentAttachmentDraft({ fileName: file.name, dataUrl });
      setAssignmentAttachmentRemoved(false);
      setAssignmentError("");
    } catch (error) {
      setAssignmentError(error instanceof Error ? error.message : "Unable to read attachment.");
      event.target.value = "";
    }
  }

  async function saveAssignmentEdit() {
    if (!activeAssignment) return;
    const title = assignmentTitleDraft.trim();
    const description = assignmentDescriptionDraft.trim();
    const instructions = assignmentInstructionsDraft.trim();
    const targetLanguage = assignmentTargetLanguageDraft.trim();
    const parsedMaxPoints = Number(assignmentMaxPointsDraft);
    const parsedRubricCriteria = parseRubricCriteria(assignmentRubricCriteriaDraft);
    const rubricTotal = parsedRubricCriteria.reduce(
      (sum, criterion) => sum + (Number.isFinite(criterion.maxPoints) ? criterion.maxPoints : 0),
      0
    );
    if (!title || !instructions) {
      setAssignmentError("Assignment name and instructions are required.");
      return;
    }
    if (!targetLanguage) {
      setAssignmentError("Choose the language students should use.");
      return;
    }
    if (assignmentRubricEnabled) {
      if (!assignmentRubricTitleDraft.trim()) {
        setAssignmentError("Rubric title is required.");
        return;
      }
      if (parsedRubricCriteria.length === 0) {
        setAssignmentError("Add at least one rubric criterion.");
        return;
      }
      if (parsedRubricCriteria.length > 8) {
        setAssignmentError("Rubrics can include up to 8 criteria.");
        return;
      }
      for (const criterion of parsedRubricCriteria) {
        if (!criterion.name) {
          setAssignmentError("Each rubric criterion needs a name.");
          return;
        }
        if (!Number.isInteger(criterion.maxPoints) || criterion.maxPoints < 1) {
          setAssignmentError("Each rubric criterion must have at least 1 point.");
          return;
        }
      }
      if (rubricTotal < 1 || rubricTotal > 1000) {
        setAssignmentError("Rubric total must be between 1 and 1000 points.");
        return;
      }
    } else if (!Number.isInteger(parsedMaxPoints) || parsedMaxPoints < 1 || parsedMaxPoints > 1000) {
      setAssignmentError("Points possible must be a whole number from 1 to 1000.");
      return;
    }

    const rollback = {
      title: activeAssignment.title,
      description: activeAssignment.description,
      instructions: activeAssignment.instructions,
      targetLanguage: activeAssignment.targetLanguage,
      maxPoints: activeAssignment.maxPoints,
      maxSubmissions: activeAssignment.maxSubmissions,
      maxRecordingSeconds: activeAssignment.maxRecordingSeconds,
      autoTranscribe: activeAssignment.autoTranscribe,
      rubric: activeAssignment.rubric,
      attachmentName: activeAssignment.attachmentName,
      attachmentUrl: activeAssignment.attachmentUrl,
      attachmentContentType: activeAssignment.attachmentContentType,
    };
    const rubricPayload = assignmentRubricEnabled
      ? {
          title: assignmentRubricTitleDraft.trim(),
          criteria: parsedRubricCriteria,
        }
      : null;
    const attachmentPayload =
      assignmentAttachmentDraft ? assignmentAttachmentDraft : assignmentAttachmentRemoved ? null : undefined;
    setAssignmentSaving(true);
    setAssignmentError("");
    updatePayloadAssignments((items) =>
      items.map((row) =>
        row.id === activeAssignment.id
          ? {
              ...row,
              title,
              description,
              instructions,
              targetLanguage,
              maxPoints: assignmentRubricEnabled ? rubricTotal : parsedMaxPoints,
              maxSubmissions: assignmentMaxSubmissionsDraft.trim() === "" ? 0 : Number(assignmentMaxSubmissionsDraft),
              maxRecordingSeconds: Number(assignmentMaxRecordingSecondsDraft) || 180,
              autoTranscribe: assignmentAutoTranscribeDraft,
              rubric: rubricPayload,
              attachmentName: assignmentAttachmentDraft?.fileName ?? (assignmentAttachmentRemoved ? "" : row.attachmentName),
              attachmentUrl: assignmentAttachmentRemoved ? "" : row.attachmentUrl,
              attachmentContentType: assignmentAttachmentRemoved ? "" : row.attachmentContentType,
            }
          : row
      )
    );

    try {
      const response = await fetch(`/api/assignments/${activeAssignment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          instructions,
          targetLanguage,
          maxPoints: assignmentRubricEnabled ? rubricTotal : parsedMaxPoints,
          maxSubmissions: assignmentMaxSubmissionsDraft.trim() === "" ? 0 : Number(assignmentMaxSubmissionsDraft),
          maxRecordingSeconds: Number(assignmentMaxRecordingSecondsDraft) || 180,
          autoTranscribe: assignmentAutoTranscribeDraft,
          rubric: rubricPayload,
          attachment: attachmentPayload,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        item?: {
          id: string;
          title: string;
          description: string;
          instructions: string;
          targetLanguage: string;
          maxPoints: number;
          maxSubmissions: number;
          maxRecordingSeconds: number;
          autoTranscribe: boolean;
          rubric: AssignmentSummary["rubric"];
          attachmentName: string;
          attachmentUrl: string;
          attachmentContentType: string;
        } | null;
      };
      if (!response.ok) {
        throw new Error(data.error || "Unable to update assignment.");
      }
      if (data.item) {
        updatePayloadAssignments((items) =>
          items.map((row) =>
            row.id === activeAssignment.id
              ? {
                ...row,
                title: data.item!.title,
                description: data.item!.description,
                instructions: data.item!.instructions,
                targetLanguage: data.item!.targetLanguage,
                maxPoints: data.item!.maxPoints,
                maxSubmissions: data.item!.maxSubmissions,
                maxRecordingSeconds: data.item!.maxRecordingSeconds,
                autoTranscribe: data.item!.autoTranscribe,
                rubric: data.item!.rubric,
                attachmentName: data.item!.attachmentName,
                attachmentUrl: data.item!.attachmentUrl,
                attachmentContentType: data.item!.attachmentContentType,
              }
            : row
          )
        );
      }
      setAssignmentEditOpen(false);
    } catch (error) {
      updatePayloadAssignments((items) => items.map((row) => (row.id === activeAssignment.id ? { ...row, ...rollback } : row)));
      setAssignmentError(error instanceof Error ? error.message : "Unable to update assignment.");
    } finally {
      setAssignmentSaving(false);
    }
  }

  async function copyStudentLink(assignmentId: string) {
    const url = `${window.location.origin}/a/${assignmentId}`;
    try {
      await navigator.clipboard.writeText(url);
      setErrorMsg("");
      setCopiedId(assignmentId);
      window.setTimeout(() => setCopiedId(""), 1400);
    } catch {
      setErrorMsg(`Copy failed. Open the student page at ${url}, then copy that page's address.`);
    }
  }

  function copyAssignment(assignment: AssignmentView) {
    try {
      const clipboard: AssignmentClipboard = {
        sourceAssignmentId: assignment.id,
        title: assignment.title,
        description: assignment.description,
        instructions: assignment.instructions,
        maxPoints: assignment.maxPoints,
        maxSubmissions: assignment.maxSubmissions,
        maxRecordingSeconds: assignment.maxRecordingSeconds,
        rubric: assignment.rubric,
        hasAttachment: Boolean(assignment.attachmentUrl),
        copiedAt: Date.now(),
      };
      window.localStorage.setItem(ASSIGNMENT_CLIPBOARD_KEY, JSON.stringify(clipboard));
      setHasAssignmentClipboard(true);
      setInfoMsg(`Assignment "${assignment.title}" copied. Open another class and paste it there.`);
    } catch {
      setErrorMsg("Unable to copy assignment right now.");
    }
  }

  async function pasteAssignment() {
    if (!classId) return;
    const clipboard = readAssignmentClipboard();
    if (!clipboard) {
      setErrorMsg("Copy an assignment first, then paste it into this class.");
      setHasAssignmentClipboard(false);
      return;
    }

    setErrorMsg("");
    setInfoMsg("Pasting assignment...");
    try {
      const response = await fetch(`/api/classes/${classId}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: clipboard.title + " (Copy)",
          description: clipboard.description,
          instructions: clipboard.instructions,
          maxPoints: clipboard.maxPoints,
          maxSubmissions: clipboard.maxSubmissions,
          maxRecordingSeconds: clipboard.maxRecordingSeconds,
          rubric: clipboard.rubric,
          ...(clipboard.hasAttachment && clipboard.sourceAssignmentId
            ? { sourceAssignmentId: clipboard.sourceAssignmentId }
            : {}),
        }),
      });
      const data = (await response.json()) as { error?: string; item?: AssignmentSummary };
      if (!response.ok || !data.item) {
        throw new Error(data.error || "Unable to paste assignment.");
      }
      await loadData(classId);
      setSelectedAssignmentId(data.item.id);
      updateWorkspaceUrl({ view: null, assignment: data.item.id, submission: null });
      setInfoMsg(`Assignment "${data.item.title}" pasted into this class.`);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Unable to paste assignment.");
      setInfoMsg("");
    }
  }

  function scheduleDelete(config: {
    key: string;
    message: string;
    rollback: () => void;
    commit: () => Promise<void>;
    onError: (message: string) => void;
  }) {
    if (pendingDeleteRef.current) {
      window.clearTimeout(pendingDeleteRef.current.timerId);
      const pending = pendingDeleteRef.current;
      pendingDeleteRef.current = null;
      void pending.commit().catch((error) => {
        pending.rollback();
        pending.onError(error instanceof Error ? error.message : "Delete failed.");
      });
    }

    const timerId = window.setTimeout(async () => {
      const pending = pendingDeleteRef.current;
      if (!pending || pending.key !== config.key) return;
      pendingDeleteRef.current = null;
      setUndoState(null);
      try {
        await pending.commit();
      } catch (error) {
        pending.rollback();
        pending.onError(error instanceof Error ? error.message : "Delete failed.");
      }
    }, 5000);

    pendingDeleteRef.current = { ...config, timerId };
    setUndoState({ message: config.message, expiresAt: Date.now() + 5000 });
  }

  function undoDelete() {
    const pending = pendingDeleteRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timerId);
    pending.rollback();
    pendingDeleteRef.current = null;
    setUndoState(null);
  }

  function deleteAssignment(assignment: AssignmentView) {
    const assignmentSnapshot = payload?.assignments.find((row) => row.id === assignment.id);
    if (!assignmentSnapshot) return;
    const submissionSnapshots = payload?.submissions.filter((row) => row.assignmentId === assignment.id) ?? [];
    updatePayloadAssignments((items) => items.filter((row) => row.id !== assignment.id));
    updatePayloadSubmissions((items) => items.filter((row) => row.assignmentId !== assignment.id));
    setDeleteTarget(null);
    setAssignmentError("");

    scheduleDelete({
      key: `assignment:${assignment.id}`,
      message: `Assignment "${assignment.title}" removed.`,
      rollback: () => {
        updatePayloadAssignments((items) => [...items, assignmentSnapshot].sort((a, b) => b.createdAt - a.createdAt));
        updatePayloadSubmissions((items) => [...items, ...submissionSnapshots].sort((a, b) => b.submittedAt - a.submittedAt));
      },
      commit: async () => {
        const response = await fetch(`/api/assignments/${assignment.id}`, {
          method: "DELETE",
          keepalive: true,
        });
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error || "Unable to delete assignment.");
        }
      },
      onError: (message) => setAssignmentError(message),
    });
  }

  function deleteSubmission(submission: SubmissionItem) {
    updatePayloadSubmissions((items) => items.filter((row) => row.id !== submission.id));
    setDeleteTarget(null);
    if (editingSubmissionId === submission.id) {
      setEditingSubmissionId("");
      setEditingSubmissionName("");
    }

    scheduleDelete({
      key: `submission:${submission.id}`,
      message: `Submission from "${submission.studentName}" removed.`,
      rollback: () => {
        updatePayloadSubmissions((items) => [...items, submission].sort((a, b) => b.submittedAt - a.submittedAt));
      },
      commit: async () => {
        const response = await fetch(`/api/submissions/${submission.id}`, {
          method: "DELETE",
          keepalive: true,
        });
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error || "Unable to delete submission.");
        }
      },
      onError: (message) => setSubmissionErrors((prev) => ({ ...prev, [submission.id]: message })),
    });
  }

  if (loading) {
    return (
      <main className="page-wrap">
        <PageTitle title="Class Workspace" />
        <BrandBar label="Grading Workspace" />
        <WorkspaceLoading label="Opening the class workspace" />
      </main>
    );
  }
  if (errorMsg && !payload) {
    return (
      <main className="page-wrap">
        <section className="card">
          <h1 className="surface-title">Class unavailable</h1>
          <p className="status-danger">{errorMsg}</p>
          <div className="actions"><Link className="btn btn-ghost" href="/teacher">Back to classes</Link></div>
        </section>
      </main>
    );
  }
  if (!payload) return null;

  return (
    <main className="page-wrap">
      <PageTitle title={payload ? `${payload.item.name} Workspace` : "Class Workspace"} />
      <BrandBar label="Grading Workspace" />
      {aiGradeErrors._feature ? <p className="card-inline-error">{aiGradeErrors._feature}</p> : null}

      <div className="workspace-header teacher-class-header">
        <div className="teacher-class-header-main">
          <div>
            <Link className="teacher-back-link" href="/teacher">← All classes</Link>
            <h1>{payload.item.name}</h1>
            <div className="class-stat-strip" aria-label="Class summary">
              <span><BookOpen size={14} aria-hidden="true" /> {pluralize(payload.stats.assignmentCount, "assignment")}</span>
              <span className={workspaceStats.pending > 0 ? "is-warning" : ""}><Clock3 size={14} aria-hidden="true" /> {workspaceStats.pending} to grade</span>
              <span><CheckCircle2 size={14} aria-hidden="true" /> {workspaceStats.graded} graded</span>
            </div>
          </div>
          <div className={`actions teacher-class-primary-actions ${styles.headerActions}`}>
            <nav className={styles.viewNav} aria-label="Class workspace sections">
              <button
                type="button"
                className={`${styles.viewTab} ${workspaceView === "classwork" ? styles.viewTabActive : ""}`}
                aria-current={workspaceView === "classwork" ? "page" : undefined}
                onClick={() => updateWorkspaceUrl({ view: null })}
              >
                Classwork
              </button>
              <button
                type="button"
                className={`${styles.viewTab} ${workspaceView === "roster" ? styles.viewTabActive : ""}`}
                aria-current={workspaceView === "roster" ? "page" : undefined}
                onClick={() => updateWorkspaceUrl({ view: "roster" })}
              >
                Roster
              </button>
            </nav>
            {workspaceView === "classwork" ? (
            <details className="workspace-more-menu" name="teacher-class-menu">
              <summary className="btn btn-ghost workspace-more-trigger">
                <span>More actions</span>
                <span className="workspace-more-chevron" aria-hidden="true">
                  <ChevronDown size={17} />
                </span>
              </summary>
              <div className="workspace-more-popover">
                <button
                  type="button"
                  onClick={() => void pasteAssignment()}
                  disabled={!hasAssignmentClipboard}
                >
                  Paste assignment
                </button>
                <a href={`/api/classes/${payload.item.id}/gradebook.csv`}>Export gradebook CSV</a>
              </div>
            </details>
            ) : null}
            {workspaceView === "classwork" ? (
              <Link className="btn btn-primary" href={`/teacher/class/${payload.item.id}/assignment/new`}>New assignment</Link>
            ) : null}
          </div>
        </div>
      </div>

      {errorMsg ? <p className="notice danger" role="alert">{errorMsg}</p> : null}
      {infoMsg ? <p className="notice success" role="status" aria-live="polite">{infoMsg}</p> : null}

      {workspaceView === "classwork" ? (assignmentViews.length === 0 ? (
        <section className="card section-gap"><h2 className="surface-title">Assignments</h2><p className="empty">No assignments yet. Create one to start collecting recordings.</p></section>
      ) : (
        <section className={`section-gap ${styles.classworkShell}`}>
          <div className={styles.assignmentPicker}>
            <div className={styles.assignmentPickerCopy}>
              <label htmlFor="assignment-selector">Assignment</label>
              <span>{pluralize(assignmentViews.length, "assignment")}</span>
            </div>
            <select
              id="assignment-selector"
              className={styles.assignmentSelect}
              value={activeAssignment?.id ?? ""}
              onChange={(event) => {
                setSelectedAssignmentId(event.target.value);
                setAssignmentView("review");
                setStudentFilter("");
                setShowUngradedOnly(false);
                updateWorkspaceUrl({ view: null, assignment: event.target.value, submission: null });
              }}
              disabled={bulkAiWorkflowActive}
            >
              {assignmentViews.map((assignment) => {
                const unsavedCount = unsavedDraftCountForAssignment(assignment.id);
                return (
                  <option key={assignment.id} value={assignment.id}>
                    {assignment.title} — {assignment.totalSubmissions === 0 ? "No activity" : assignment.ungradedCount > 0 ? `${assignment.ungradedCount} to grade` : "Complete"}
                    {unsavedCount > 0 ? ` · ${unsavedCount} unsaved` : ""}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="card assignment-main">
            {!activeAssignment ? null : (
              <>
                <div className="dense-row assignment-main-header">
                  <div><h2 className="assignment-title">{activeAssignment.title}</h2>{activeAssignment.description ? <p className="meta assignment-description">{activeAssignment.description}</p> : null}<p className="meta assignment-meta">Created {formatDate(activeAssignment.createdAt)}</p></div>
                  <div className="assignment-header-actions">
                    <span className={`status-badge status-${activeAssignment.tone}`}>{activeAssignment.label}</span>
                    <span className="assignment-header-count">{pluralize(activeAssignment.totalSubmissions, "submission")}</span>
                  </div>
                </div>

                <div className="assignment-view-tabs" role="tablist" aria-label="Assignment workspace" onKeyDown={handleAssignmentTabKeyDown}>
                  <button id="assignment-review-tab" type="button" role="tab" aria-controls="assignment-review-panel" aria-selected={assignmentView === "review"} tabIndex={assignmentView === "review" ? 0 : -1} className={assignmentView === "review" ? "is-active" : ""} onClick={() => setAssignmentView("review")}>Submissions</button>
                  <button id="assignment-details-tab" type="button" role="tab" aria-controls="assignment-details-panel" aria-selected={assignmentView === "details"} tabIndex={assignmentView === "details" ? 0 : -1} className={assignmentView === "details" ? "is-active" : ""} onClick={() => setAssignmentView("details")}>Assignment</button>
                  <button id="assignment-share-tab" type="button" role="tab" aria-controls="assignment-share-panel" aria-selected={assignmentView === "share"} tabIndex={assignmentView === "share" ? 0 : -1} className={assignmentView === "share" ? "is-active" : ""} onClick={() => setAssignmentView("share")}>Share</button>
                </div>

                {assignmentError ? <p className="card-inline-error">{assignmentError}</p> : null}
                {assignmentView === "share" ? (
                  <section id="assignment-share-panel" className="assignment-tab-panel assignment-share-panel" role="tabpanel" aria-labelledby="assignment-share-tab">
                    <div>
                      <h3>Student access</h3>
                      <p className="meta">Preview the student experience or copy the class link.</p>
                    </div>
                    <div className="actions assignment-actions">
                      <Link className="btn btn-primary" href={`/a/${activeAssignment.id}`}>Open student page</Link>
                      <button type="button" className="btn btn-ghost" onClick={() => void copyStudentLink(activeAssignment.id)}>{copiedId === activeAssignment.id ? "Copied" : "Copy student link"}</button>
                      <button type="button" className="btn btn-ghost" onClick={() => copyAssignment(activeAssignment)}>Copy assignment</button>
                    </div>
                  </section>
                ) : null}

                {assignmentView === "details" ? (
                  <section id="assignment-details-panel" className="assignment-tab-panel assignment-details-panel" role="tabpanel" aria-labelledby="assignment-details-tab">
                    <div className="assignment-detail-grid">
                      <div><span>Instructions</span><p>{activeAssignment.instructions?.trim() || "No instructions provided."}</p></div>
                      <div><span>Points</span><p>{activeAssignment.maxPoints}</p></div>
                      <div><span>Transcription</span><p>{activeAssignment.autoTranscribe ? "Automatic" : "Manual"}</p></div>
                      <div><span>Rubric</span><p>{activeAssignment.rubric ? `${activeAssignment.rubric.title} · ${pluralize(activeAssignment.rubric.criteria.length, "criterion", "criteria")}` : "No rubric"}</p></div>
                      {activeAssignment.attachmentUrl ? <div><span>Attachment</span><p><a className="text-link" href={`/api/assignments/${encodeURIComponent(activeAssignment.id)}/attachment`} target="_blank" rel="noreferrer">{activeAssignment.attachmentName || "Open directions file"}</a></p></div> : null}
                    </div>
                    <div className="actions assignment-management-actions">
                      <button type="button" className="btn btn-ghost" onClick={openAssignmentEditModal} disabled={bulkAiWorkflowActive}><Pencil size={15} aria-hidden="true" /> Edit assignment</button>
                      <button type="button" className="btn btn-danger" onClick={() => setDeleteTarget({ type: "assignment", assignment: activeAssignment })} disabled={bulkAiWorkflowActive}><Trash2 size={15} aria-hidden="true" /> Delete assignment</button>
                    </div>
                  </section>
                ) : null}

                {assignmentView === "review" ? (
                <section id="assignment-review-panel" className="assignment-tab-panel assignment-review-panel" role="tabpanel" aria-labelledby="assignment-review-tab">
                {aiBulkGradingEnabled ? (
                  <section
                    className={styles.bulkAiActionPanel}
                    data-state={
                      bulkAiRunning
                        ? "processing"
                        : bulkAiBatchNeedsReview || bulkAiBatchNeedsAttention
                          ? "review"
                          : bulkAiPreflight && bulkAiPreflight.ungradedCount === 0
                            ? "complete"
                            : bulkAiPreflight && !bulkAiPreflight.fits
                              ? "limited"
                              : "ready"
                    }
                    aria-labelledby="bulk-ai-action-title"
                  >
                    <div className={styles.bulkAiActionCopy}>
                      <span className={styles.bulkAiEyebrow}>
                        <Sparkles size={16} aria-hidden="true" /> AI grading assistant
                      </span>
                      <h3 id="bulk-ai-action-title">
                        {bulkAiBatchNeedsReview
                          ? "Your AI suggestions are ready"
                          : bulkAiBatchNeedsAttention
                            ? "This batch needs your attention"
                          : bulkAiPreflight?.ungradedCount === 0
                            ? "This grading queue is clear"
                            : "Turn this queue into one review pass"}
                      </h3>
                      <p>{BULK_AI_SUPPORT_COPY}</p>
                      {bulkAiRunning ? (
                        <p className={styles.bulkAiLiveStatus} role="status" aria-live="polite" aria-atomic="true">
                          {bulkAiProcessingItem
                            ? `Preparing the transcript and grade for ${bulkAiProcessingItem.studentName}. `
                            : "Preparing transcripts and grades. "}
                          {bulkAiProcessed} of {bulkAiTotal} finished. You can leave and resume safely.
                        </p>
                      ) : bulkAiBatchNeedsReview ? (
                        <p className={styles.bulkAiLiveStatus} role="status">
                          {bulkAiBatch?.counts.reviewReady} suggested score{bulkAiBatch?.counts.reviewReady === 1 ? " is" : "s are"} waiting for your approval. Students cannot see them yet.
                        </p>
                      ) : bulkAiBatchNeedsAttention ? (
                        <p className={styles.bulkAiLiveStatus} role="status">
                          {bulkAiBatch?.counts.failed ?? 0} failed, {bulkAiBatch?.counts.skipped ?? 0} skipped, and {bulkAiBatch?.counts.conflict ?? 0} changed. No scores were saved.
                        </p>
                      ) : bulkAiPreflight?.ungradedCount === 0 ? (
                        <p className={styles.bulkAiCelebration} role="status">
                          <CheckCircle2 size={17} aria-hidden="true" /> No ungraded recordings are waiting for AI review.
                        </p>
                      ) : bulkAiPreflight && bulkAiTranscriptsRequired > 0 ? (
                        <p className={styles.bulkAiTranscriptNote}>
                          {pluralize(bulkAiTranscriptsRequired, "recording")} need transcripts; TryHabla will prepare them during this run.
                        </p>
                      ) : null}
                    </div>

                    <div className={styles.bulkAiActionSide}>
                      <dl className={styles.bulkAiMath} aria-label="AI grading allowance">
                        <div><dt>Eligible</dt><dd>{bulkAiChecking && !bulkAiPreflight ? "…" : bulkAiEligibleCount}</dd></div>
                        <div><dt>New units</dt><dd>{bulkAiChecking && !bulkAiPreflight ? "…" : bulkAiBatch?.newUnitsRequired ?? bulkAiPreflight?.newUnitsRequired ?? 0}</dd></div>
                        <div><dt>Available</dt><dd>{bulkAiChecking && !bulkAiPreflight ? "…" : bulkAiPreflight?.allowance?.remaining ?? bulkAiPreflight?.remaining ?? "—"}</dd></div>
                      </dl>
                      <div className={styles.bulkAiActions}>
                        <button
                          type="button"
                          className={`btn btn-primary ${styles.bulkAiPrimaryAction}`}
                          onClick={() => void openBulkAiConfirm(activeAssignment.id)}
                          disabled={
                            bulkAiChecking ||
                            bulkAiRunning ||
                            bulkAiSaving ||
                            Object.values(aiGrading).some(Boolean) ||
                            (bulkAiPreflight?.ungradedCount === 0 && !bulkAiBatchNeedsReview && !bulkAiBatchNeedsAttention)
                          }
                        >
                          <Sparkles size={18} aria-hidden="true" />
                          {bulkAiRunning
                            ? `Grading ${bulkAiProcessed} of ${bulkAiTotal}`
                            : bulkAiChecking && !bulkAiPreflight
                              ? "Checking eligible recordings…"
                              : bulkAiBatchNeedsReview
                                ? "Review AI grades"
                                : bulkAiBatchNeedsAttention
                                  ? "Review batch"
                                : bulkAiBatch && ["queued", "processing"].includes(bulkAiBatch.status)
                                  ? "Resume AI grading"
                                  : bulkAiPreflight
                                    ? bulkAiPrimaryLabel(bulkAiEligibleCount)
                                    : "Check AI grading"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            setBulkAiReviewOpen(false);
                            window.requestAnimationFrame(() => {
                              manualGradingRef.current?.scrollIntoView({ block: "start" });
                              document.getElementById("student-filter")?.focus();
                            });
                          }}
                          disabled={bulkAiRunning || bulkAiSaving}
                        >
                          Enter scores manually
                        </button>
                      </div>
                      {bulkAiBatchNeedsReview || bulkAiBatchNeedsAttention ? (
                        <p className={styles.bulkAiSafety}>Nothing is student-visible until you review and save.</p>
                      ) : bulkAiPreflight?.ungradedCount === 0 ? (
                        <p className={styles.bulkAiSafety}>{BULK_AI_QUEUE_CLEAR_COPY}</p>
                      ) : bulkAiPreflight && !bulkAiPreflight.fits ? (
                        <p className={styles.bulkAiUpgrade}>
                          Keep grading manually, or <Link href="/billing">see AI allowance options</Link>.
                        </p>
                      ) : (
                        <p className={styles.bulkAiSafety}>Nothing is student-visible until you review and save.</p>
                      )}
                    </div>
                  </section>
                ) : null}

                {bulkAiReviewOpen && bulkAiBatch ? (
                  <BatchAiReviewWorkspace
                    key={bulkAiBatch.id}
                    batch={bulkAiBatch}
                    maxPoints={activeAssignment.maxPoints}
                    rubric={activeAssignment.rubric}
                    saving={bulkAiSaving}
                    saveError={bulkAiError}
                    onSave={saveReviewedBulkAiGrades}
                    onRetryFailed={retryBulkAiFailures}
                    onDismiss={dismissTerminalBulkAiBatch}
                    onBatchUpdated={(nextBatch) => {
                      setBulkAiBatch(nextBatch);
                      setBulkAiPreflight((previous) => previous
                        ? { ...previous, activeBatch: nextBatch }
                        : previous);
                    }}
                    onBackToManual={() => {
                      setBulkAiReviewOpen(false);
                      window.requestAnimationFrame(() => manualGradingRef.current?.scrollIntoView({ block: "start" }));
                    }}
                  />
                ) : (
                <div ref={manualGradingRef} className={styles.manualGradingWorkspace}>
                <div className={`toolbar-compact grading-toolbar ${styles.gradingToolbar}`}>
                  <label className="label toolbar-label" htmlFor="student-filter">Find student in this assignment</label>
                  <input id="student-filter" className="input toolbar-input" value={studentFilter} onChange={(event) => setStudentFilter(event.target.value)} placeholder="Search by student name" />
                  <button type="button" className={`btn ${showUngradedOnly ? "btn-primary" : "btn-ghost"}`} onClick={() => setShowUngradedOnly((prev) => !prev)}>{showUngradedOnly ? "Ungraded only: on" : "Ungraded only"}</button>
                  {activeAllSubmissions.length > 0 ? (
                    <details className="workspace-more-menu grading-download-menu" name="teacher-class-menu">
                      <summary className="btn btn-ghost workspace-more-trigger">
                        <span>
                          {bulkTranscriptChecking || bulkTranscriptDownloading ? "Preparing downloads..." : "Download options"}
                        </span>
                        <span className="workspace-more-chevron" aria-hidden="true">
                          <ChevronDown size={17} />
                        </span>
                      </summary>
                      <div className="workspace-more-popover">
                        {aiGradingEnabled ? (
                        <button
                          type="button"
                          onClick={() => void openBulkTranscriptConfirm()}
                          disabled={
                            bulkTranscriptChecking ||
                            bulkTranscriptDownloading ||
                            bulkAiRunning ||
                            Object.values(aiGrading).some(Boolean)
                          }
                        >
                          {bulkTranscriptChecking
                            ? "Checking transcripts..."
                            : bulkTranscriptDownloading
                              ? bulkTranscriptProgress
                                ? `Transcribing ${bulkTranscriptProgress.processed}/${bulkTranscriptProgress.total}...`
                                : "Generating transcripts..."
                              : "Generate & download transcripts"}
                        </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void downloadAllSavedTranscripts()}
                          disabled={bulkTranscriptChecking || bulkTranscriptDownloading || bulkAiRunning}
                        >
                          Download saved transcripts
                        </button>
                      </div>
                    </details>
                  ) : null}
                </div>

                {bulkAiError ? <p className="card-inline-error">{bulkAiError}</p> : null}
                {bulkTranscriptError ? <p className="card-inline-error">{bulkTranscriptError}</p> : null}
                {bulkTranscriptResult ? (
                  <div className="notice info" role="status" aria-live="polite">
                    <strong>
                      {bulkTranscriptResult.included} of {bulkTranscriptResult.total} submissions had a saved transcript included
                      {bulkTranscriptResult.downloadUrl ? "; ZIP download started." : "."}
                    </strong>{" "}
                    {bulkTranscriptResult.generated > 0
                      ? `${bulkTranscriptResult.generated} newly generated. `
                      : ""}
                    {bulkTranscriptResult.reused > 0
                      ? `${bulkTranscriptResult.reused} already saved. `
                      : ""}
                    {bulkTranscriptResult.failed > 0
                      ? `${bulkTranscriptResult.failed} failed. `
                      : ""}
                    {bulkTranscriptResult.uncertain > 0
                      ? `${bulkTranscriptResult.uncertain} could not be confirmed; reload before retrying. `
                      : ""}
                    {bulkTranscriptResult.notProcessed > 0
                      ? `${bulkTranscriptResult.notProcessed} not processed and safe to retry. `
                      : ""}
                    {bulkTranscriptResult.unavailable > 0
                      ? `${bulkTranscriptResult.unavailable} unavailable. `
                      : ""}
                    {bulkTranscriptResult.needsReview > 0
                      ? `${bulkTranscriptResult.needsReview} included but marked for teacher review. `
                      : ""}
                    {bulkTranscriptResult.downloadUrl && bulkTranscriptResult.archiveFilename ? (
                      <a
                        className="text-link"
                        href={bulkTranscriptResult.downloadUrl}
                        download={bulkTranscriptResult.archiveFilename}
                      >
                        Download ZIP again
                      </a>
                    ) : (
                      "No saved transcripts were available. Generate transcripts first or use AI grading."
                    )}
                    {bulkTranscriptResult.terminalError ? (
                      <span className="meta"> {bulkTranscriptResult.terminalError}</span>
                    ) : null}
                    <span className="meta"> Downloads and already-saved transcripts do not use additional units.</span>
                  </div>
                ) : null}

                {activeAllSubmissions.length === 0 ? <p className="empty">No submissions yet for this assignment.</p> : activeFilteredSubmissions.length === 0 ? <p className="empty">No submissions match current filters.</p> : (
                  <div className={styles.reviewWorkspace}>
                    <aside className={styles.submissionQueue} aria-label="Submission queue">
                      <div className={styles.queueHeader}>
                        <div>
                          <strong>Students</strong>
                          <span>Choose one to grade</span>
                        </div>
                        <span className={styles.queueCount}>{activeFilteredSubmissions.length}</span>
                      </div>
                      <div ref={submissionQueueListRef} className={styles.queueList}>
                        {activeFilteredSubmissions.map((submission, index) => {
                          const isDirty = isSubmissionDraftDirty(submission, activeAssignment);
                          return (
                            <button
                              key={submission.id}
                              type="button"
                              data-submission-id={submission.id}
                              className={`${styles.queueItem} ${submission.id === focusedSubmission?.id ? styles.queueItemActive : ""}`}
                              aria-current={submission.id === focusedSubmission?.id ? "true" : undefined}
                              onClick={() => updateWorkspaceUrl({
                                view: null,
                                assignment: activeAssignment.id,
                                submission: submission.id,
                              })}
                            >
                              <span className={styles.queueName}>{submission.studentName}</span>
                              <span className={styles.queueMeta}>{index + 1} · {formatDateTime(submission.submittedAt)}</span>
                              <span className={styles.queueBadge} data-status={isDirty ? "warning" : submission.grade === null ? "warning" : "success"}>
                                {isDirty ? "Unsaved" : submission.grade === null ? "To grade" : `${submission.grade}/${activeAssignment.maxPoints}`}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </aside>

                    <div
                      className={styles.focusedSubmission}
                      role="region"
                      aria-label={focusedSubmission ? `Grade ${focusedSubmission.studentName}` : "Grade submission"}
                    >
                      <span className="sr-only" aria-live="polite" aria-atomic="true">
                        {focusedSubmission
                          ? `Now grading ${focusedSubmission.studentName}. Student ${focusedSubmissionIndex + 1} of ${activeFilteredSubmissions.length}.`
                          : ""}
                      </span>
                      <div className={styles.focusedNav}>
                        <div className={styles.focusedPosition}>
                          <span>Grading queue</span>
                          <strong>Student {focusedSubmissionIndex + 1} of {activeFilteredSubmissions.length}</strong>
                        </div>
                        <div className={styles.focusedNavActions}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={!previousSubmission}
                            onClick={() => previousSubmission && updateWorkspaceUrl({
                              view: null,
                              assignment: activeAssignment.id,
                              submission: previousSubmission.id,
                            })}
                          >
                            <ChevronLeft size={15} aria-hidden="true" /> Previous
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={!nextSubmission}
                            onClick={() => nextSubmission && updateWorkspaceUrl({
                              view: null,
                              assignment: activeAssignment.id,
                              submission: nextSubmission.id,
                            })}
                          >
                            Next <ChevronRight size={15} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      <div className="grid submission-grid assignment-submissions">
                    {focusedSubmission ? [focusedSubmission].map((submission) => {
                      const draft = drafts[submission.id] ?? {
                        gradeInput: submission.grade === null ? "" : String(submission.grade),
                        feedback: submission.feedback ?? "",
                        saving: false,
                        rubricScoreInputs: rubricInputsFromSubmission(submission, activeAssignment),
                      };
                      const isEditing = editingSubmissionId === submission.id;
                      const rubricTotal = activeAssignment.rubric
                        ? activeAssignment.rubric.criteria.reduce((sum, criterion) => {
                            const value = draft.rubricScoreInputs[criterion.id]?.trim() ?? "";
                            return sum + (value === "" ? 0 : Number(value) || 0);
                          }, 0)
                        : null;
                      const aiSuggestion = aiSuggestions[submission.id] ?? null;
                      const downloadFilenameBase = buildSubmissionDownloadFilenameBase({
                        studentName: submission.studentName,
                        assignmentTitle: activeAssignment.title,
                        submittedAt: submission.submittedAt,
                        submissionId: submission.id,
                      });
                      return (
                        <div key={submission.id} className="card submission-card">
                          <div className="dense-row">
                            <div>
                              {isEditing ? (
                                <div className="inline-edit-row">
                                  <label className="sr-only" htmlFor={`student-name-${submission.id}`}>
                                    Student name
                                  </label>
                                  <input
                                    id={`student-name-${submission.id}`}
                                    className="input inline-edit-input"
                                    value={editingSubmissionName}
                                    onChange={(event) => setEditingSubmissionName(event.target.value)}
                                    disabled={bulkAiWorkflowActive}
                                    maxLength={80}
                                    autoFocus
                                  />
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    onClick={() => void saveSubmissionName(submission)}
                                    disabled={nameSaving || bulkAiWorkflowActive}
                                    aria-label={`Save student name for ${submission.studentName}`}
                                  >
                                    <Check size={15} aria-hidden="true" />
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => { setEditingSubmissionId(""); setEditingSubmissionName(""); }}
                                    disabled={bulkAiWorkflowActive}
                                    aria-label={`Cancel editing student name for ${submission.studentName}`}
                                  >
                                    <X size={15} aria-hidden="true" />
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <div className="submission-name-row">
                                  <strong>{submission.studentName}</strong>
                                  <details className={`workspace-more-menu ${styles.studentActions}`} name="teacher-class-menu">
                                    <summary className="btn btn-ghost btn-sm workspace-more-trigger">
                                      <span>Student actions</span>
                                      <span className="workspace-more-chevron" aria-hidden="true">
                                        <ChevronDown size={15} />
                                      </span>
                                    </summary>
                                    <div className="workspace-more-popover">
                                      <button
                                        type="button"
                                        onClick={() => { setEditingSubmissionId(submission.id); setEditingSubmissionName(submission.studentName); }}
                                        disabled={bulkAiWorkflowActive}
                                        aria-label={`Edit student name for ${submission.studentName}`}
                                      >
                                        <Pencil size={14} aria-hidden="true" /> Rename student
                                      </button>
                                      <button
                                        type="button"
                                        className={styles.dangerAction}
                                        onClick={() => setDeleteTarget({ type: "submission", submission })}
                                        disabled={bulkAiWorkflowActive}
                                        aria-label={`Delete submission from ${submission.studentName}`}
                                      >
                                        <Trash2 size={14} aria-hidden="true" /> Delete submission
                                      </button>
                                    </div>
                                  </details>
                                </div>
                              )}
                              <div className="meta">{formatDateTime(submission.submittedAt)}</div>
                              <div className="meta">{submission.studentEmail || "No email captured"}</div>
                            </div>
                            {activeAssignment.rubric ? (
                              <div className="score-control">
                                <label className="meta score-label">Total</label>
                                <div className="score-field">
                                  <span className="score-suffix">
                                    {rubricTotal} / {activeAssignment.maxPoints}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div className="score-control"><label className="meta score-label" htmlFor={`grade-${submission.id}`}>Score</label><div className="score-field"><input id={`grade-${submission.id}`} className="input score-input" type="number" min={0} max={activeAssignment.maxPoints} step={1} inputMode="numeric" placeholder="0" value={draft.gradeInput} onChange={(event) => setDraft(submission.id, { gradeInput: event.target.value })} disabled={bulkAiWorkflowActive} /><span className="score-suffix">/{activeAssignment.maxPoints}</span></div></div>
                            )}
                          </div>
                          <AiGradeReviewBadge
                            grade={submission.grade}
                            gradeSource={submission.gradeSource}
                          />
                          {aiGradingEnabled && submission.grade === null ? (
                            <section className={styles.individualAiAction} aria-labelledby={`individual-ai-title-${submission.id}`}>
                              <div>
                                <span className={styles.individualAiEyebrow}><Sparkles size={15} aria-hidden="true" /> AI suggestion</span>
                                <h4 id={`individual-ai-title-${submission.id}`}>{INDIVIDUAL_AI_ACTION_LABEL}</h4>
                                <p>{INDIVIDUAL_AI_SUPPORT_COPY}</p>
                              </div>
                              <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => void aiGradeSubmission(submission.id)}
                                disabled={aiGrading[submission.id] || bulkAiWorkflowActive || draft.saving}
                              >
                                <Sparkles size={16} aria-hidden="true" />
                                {aiGrading[submission.id] ? "Preparing suggestion…" : INDIVIDUAL_AI_ACTION_LABEL}
                              </button>
                            </section>
                          ) : null}
                          <AudioPlayer
                            src={submission.audioData}
                            variant="compact"
                            downloadFilename={downloadFilenameBase}
                          />
                          <GoogleDriveExportButton
                            submissionId={submission.id}
                            studentName={submission.studentName}
                            filenameBase={downloadFilenameBase}
                            includeTranscript={false}
                          />
                          {aiGradingEnabled ? (
                            <SubmissionTranscript
                              submissionId={submission.id}
                              studentName={submission.studentName}
                              downloadFilenameBase={downloadFilenameBase}
                            />
                          ) : null}
                          {activeAssignment.rubric ? (
                            <div className="grid section-gap">
                              {activeAssignment.rubric.criteria.map((criterion) => (
                                <div key={criterion.id} className="card panel-subtle">
                                  <div className="dense-row">
                                    <div>
                                      <p className="label" style={{ marginBottom: 0 }}>{criterion.name}</p>
                                      {criterion.description ? <p className="meta">{criterion.description}</p> : null}
                                    </div>
                                    <div className="score-field">
                                      <label
                                        className="sr-only"
                                        htmlFor={`criterion-score-${submission.id}-${criterion.id}`}
                                      >
                                        {criterion.name} score for {submission.studentName}
                                      </label>
                                      <input
                                        id={`criterion-score-${submission.id}-${criterion.id}`}
                                        className="input score-input"
                                        type="number"
                                        min={0}
                                        max={criterion.maxPoints}
                                        step={1}
                                        inputMode="numeric"
                                        placeholder="0"
                                        value={draft.rubricScoreInputs[criterion.id] ?? ""}
                                        disabled={bulkAiWorkflowActive}
                                        onChange={(event) =>
                                          setDraft(submission.id, {
                                            rubricScoreInputs: {
                                              ...draft.rubricScoreInputs,
                                              [criterion.id]: event.target.value,
                                            },
                                          })
                                        }
                                      />
                                      <span className="score-suffix">/{criterion.maxPoints}</span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          <label className="label feedback-label" htmlFor={`feedback-${submission.id}`}>Feedback (optional)</label>
                          <textarea id={`feedback-${submission.id}`} className="textarea feedback-area" value={draft.feedback} onChange={(event) => setDraft(submission.id, { feedback: event.target.value })} onInput={(event) => autoResizeTextarea(event.currentTarget)} onFocus={(event) => autoResizeTextarea(event.currentTarget)} placeholder="Optional student feedback..." rows={2} disabled={bulkAiWorkflowActive} />
                          {aiSuggestion ? (
                            <div className="notice info">
                              <p className="meta" style={{ marginBottom: "0.35rem" }}>
                                <strong>{localAiTestMode ? "Local AI test mode" : "AI grade details"}</strong>{" "}
                                {localAiTestMode ? "Mock result" : "Review and edit anytime"}
                              </p>
                              <p className="meta" style={{ marginBottom: "0.35rem" }}>
                                <span className="status-badge status-warning">
                                  {aiSuggestion.teacherAttention === "unable_to_grade"
                                   ? "AI could not grade this"
                                    : aiSuggestion.gradeApplied
                                      ? "AI grade saved: teacher review needed"
                                      : "AI suggestion: review before saving"}
                                </span>{" "}
                                {aiSuggestion.confidence ? (
                                  <span className="pill pill-subtle">AI confidence: {aiSuggestion.confidence}</span>
                                ) : null}{" "}
                                {aiSuggestion.teacherAttention === "caution" ? (
                                  <span className="pill pill-subtle">Flagged: check this one closely</span>
                                ) : aiSuggestion.teacherAttention === "unable_to_grade" ? (
                                  <span className="pill pill-subtle">AI could not grade this</span>
                                ) : aiSuggestion.teacherAttention === "review" ? (
                                  <span className="pill pill-subtle">Human review required</span>
                                ) : null}
                              </p>
                              {aiSuggestion.suggestedScore !== null ? (
                                <p className="meta">Suggested score: {aiSuggestion.suggestedScore} / {activeAssignment.maxPoints}</p>
                              ) : null}
                              {aiSuggestion.rubricScores.length > 0 ? (
                                <p className="meta">
                                  Rubric: {aiSuggestion.rubricScores.map((score) => `${score.criterionName} ${score.awarded}/${score.maxPoints}`).join("; ")}
                                </p>
                              ) : null}
                              <p className="meta">Feedback: {aiSuggestion.feedback}</p>
                              {aiSuggestion.warnings.length > 0 ? <p className="meta">Warnings: {aiSuggestion.warnings.join("; ")}</p> : null}
                              <details>
                                <summary className="meta">Transcript and evidence</summary>
                                <p className="meta">{aiSuggestion.transcript}</p>
                                {aiSuggestion.evidence.length > 0 ? <p className="meta">Evidence: {aiSuggestion.evidence.join("; ")}</p> : null}
                              </details>
                              <div className="actions" style={{ marginTop: "0.5rem" }}>
                                {!aiSuggestion.gradeApplied &&
                                aiSuggestion.suggestedScore !== null &&
                                aiSuggestion.teacherAttention !== "unable_to_grade" ? (
                                  <button type="button" className="btn btn-ghost" onClick={() => applyAiSuggestion(submission.id, aiSuggestion)} disabled={bulkAiWorkflowActive}>
                                    Restore suggestion to fields
                                  </button>
                                ) : null}
                                <button type="button" className="btn btn-ghost" onClick={() => setAiSuggestions((prev) => ({ ...prev, [submission.id]: null }))}>
                                  Dismiss
                                </button>
                              </div>
                            </div>
                          ) : null}
                          <div className="actions submission-actions">
                            <button type="button" className="btn btn-primary" onClick={() => void saveSubmission(submission.id)} disabled={draft.saving || bulkAiWorkflowActive}>{draft.saving ? "Saving..." : "Save grade"}</button>
                          </div>
                          {aiGradeErrors[submission.id] ? <p className="card-inline-error">{aiGradeErrors[submission.id]}</p> : null}
                          {submissionErrors[submission.id] ? <p className="card-inline-error">{submissionErrors[submission.id]}</p> : null}
                        </div>
                      );
                    }) : null}
                  </div>
                    </div>
                  </div>
                )}
                </div>
                )}
                </section>
                ) : null}
              </>
            )}
          </div>
        </section>
      )) : null}

      {workspaceView === "roster" ? (
      <section id="roster" className={`${styles.rosterView} card section-gap`}>
        <div className="dense-row">
          <div>
            <h2 className="surface-title">Roster</h2>
            <p className="meta">Students appear here automatically when they submit. You can also add them manually.</p>
          </div>
          <span className="pill pill-subtle">{pluralize(roster.length, "student")}</span>
        </div>

        <div className="toolbar-compact">
          <label className="sr-only" htmlFor="roster-student-name">Student name</label>
          <input
            id="roster-student-name"
            className="input toolbar-input"
            placeholder="Student name"
            value={addStudentName}
            onChange={(event) => setAddStudentName(event.target.value)}
            maxLength={80}
          />
          <label className="sr-only" htmlFor="roster-student-email">Student email</label>
          <input
            id="roster-student-email"
            className="input toolbar-input"
            placeholder="student@school.edu"
            type="email"
            value={addStudentEmail}
            onChange={(event) => setAddStudentEmail(event.target.value)}
            maxLength={254}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleAddStudent()}
            disabled={addStudentSaving}
          >
            {addStudentSaving ? "Adding..." : "Add student"}
          </button>
          <label className="sr-only" htmlFor="roster-csv">Roster CSV file</label>
          <input
            id="roster-csv"
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(event) => void handleCsvUpload(event)}
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => csvInputRef.current?.click()}
            disabled={csvUploading}
            title="Upload a CSV with name and email columns"
          >
            {csvUploading ? "Importing..." : "Upload CSV"}
          </button>
        </div>

        {rosterError ? <p className="card-inline-error">{rosterError}</p> : null}
        {csvResult ? (
          <p className="meta">
            CSV imported: {csvResult.added} added{csvResult.skipped > 0 ? `, ${csvResult.skipped} already on roster (skipped)` : ""}.
          </p>
        ) : null}

        {rosterLoading ? (
          <p className="meta">Loading roster...</p>
        ) : roster.length === 0 ? (
          <p className="empty">No students yet. They appear here automatically after submitting an assignment.</p>
        ) : (
          <div className="grid submission-grid">
            {roster.map((entry) => (
              <div
                key={entry.id}
                className={`card submission-card${selectedStudentEmail === entry.studentEmail ? " is-selected" : ""}`}
              >
                <div className="dense-row">
                  <div>
                    <strong>{entry.studentName}</strong>
                    <div className="meta">{entry.studentEmail}</div>
                    <div className="meta">
                      {entry.addedBy === "teacher" ? "Added manually" : "Added via submission"} &middot;{" "}
                      {formatDate(entry.addedAt)}
                    </div>
                  </div>
                  <div className="actions">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      aria-label={`View details for ${entry.studentName}`}
                      onClick={() => {
                        if (!classId) return;
                        setSelectedStudentEmail(entry.studentEmail);
                        void loadStudentDetail(classId, entry.studentEmail);
                      }}
                    >
                      View details
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => void handleRemoveStudent(entry.studentEmail)}
                      aria-label={`Remove ${entry.studentName} from roster`}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      Remove student
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedStudentEmail ? (
          <div className="card panel-subtle section-gap">
            <div className="dense-row">
              <h3 className="surface-title">
                {roster.find((entry) => entry.studentEmail === selectedStudentEmail)?.studentName ??
                  selectedStudentEmail}
              </h3>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setSelectedStudentEmail(null);
                  setStudentDetail(null);
                }}
              >
                Close
              </button>
            </div>
            <p className="meta">{selectedStudentEmail}</p>
            {studentDetailLoading ? (
              <p className="meta">Loading...</p>
            ) : studentDetail ? (
              studentDetail.assignments.length === 0 ? (
                <p className="empty">No assignments in this class yet.</p>
              ) : (
                <StudentOralPortfolio
                  studentName={
                    roster.find((entry) => entry.studentEmail === selectedStudentEmail)?.studentName ??
                    selectedStudentEmail
                  }
                  items={studentDetail.assignments}
                  transcriptionEnabled={aiGradingEnabled}
                />
              )
            ) : (
              <p className="empty">Could not load assignment data.</p>
            )}
          </div>
        ) : null}
      </section>
      ) : null}

      <ConfirmModal
        open={deleteTarget !== null}
        title={deleteTarget?.type === "assignment" ? "Delete assignment?" : "Delete submission?"}
        description={deleteTarget?.type === "assignment" ? "This permanently removes the assignment and all of its submissions." : "This permanently removes this submission."}
        confirmLabel={deleteTarget?.type === "assignment" ? "Delete assignment" : "Delete submission"}
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          if (deleteTarget.type === "assignment") deleteAssignment(deleteTarget.assignment);
          else deleteSubmission(deleteTarget.submission);
        }}
      />

      <ConfirmModal
        open={bulkAiConfirmOpen && bulkAiPreflight !== null}
        title={
          bulkAiPreflight && !bulkAiPreflight.fits
            ? bulkAiLimitTitle(bulkAiPreflight)
            : bulkAiConfirmationTitle(bulkAiPreflight?.ungradedCount ?? 0)
        }
        description={
          bulkAiPreflight && !bulkAiPreflight.fits
            ? bulkAiLimitDescription(bulkAiPreflight)
            : bulkAiPreflight
              ? bulkAiRunDescription(bulkAiPreflight)
              : ""
        }
        confirmLabel={bulkAiPreflight && !bulkAiPreflight.fits ? "View AI allowance options" : BULK_AI_CONFIRM_LABEL}
        cancelLabel={bulkAiPreflight && !bulkAiPreflight.fits ? "Keep grading manually" : BULK_AI_CANCEL_LABEL}
        onCancel={() => setBulkAiConfirmOpen(false)}
        onConfirm={() => {
          const preflight = bulkAiPreflight;
          const canRun = preflight?.fits === true;
          setBulkAiConfirmOpen(false);
          if (canRun && preflight) void runBulkAiGrade(preflight);
          else if (preflight) router.push("/billing");
        }}
      />

      <ConfirmModal
        open={bulkTranscriptPreflight !== null}
        title={
          bulkTranscriptPreflight?.missingSubmissionIds.length
            ? `Generate ${pluralize(bulkTranscriptPreflight.missingSubmissionIds.length, "missing transcript")}?`
            : "Download all saved transcripts?"
        }
        description={
          bulkTranscriptPreflight
            ? `${pluralize(bulkTranscriptPreflight.reusedSubmissionIds.length, "transcript")} already saved; ${pluralize(bulkTranscriptPreflight.missingSubmissionIds.length, "recording")} need transcription.${
                bulkTranscriptPreflight.unreadableSubmissionIds.length
                  ? ` ${pluralize(bulkTranscriptPreflight.unreadableSubmissionIds.length, "recording")} could not be checked and will not be sent for processing.`
                  : ""
              } Up to ${pluralize(bulkTranscriptPreflight.missingSubmissionIds.length, "AI-assisted recording unit")} will be used—only successful, usable new transcripts count. This does not grade submissions, and grading the same recording later is included. Every transcript still needs teacher review. A ZIP report will show exactly what succeeded or failed.`
            : ""
        }
        confirmLabel={
          bulkTranscriptPreflight?.missingSubmissionIds.length
            ? "Generate & download"
            : "Download ZIP"
        }
        cancelLabel="Cancel"
        onCancel={() => setBulkTranscriptPreflight(null)}
        onConfirm={() => void generateAndDownloadTranscripts()}
      />

      {assignmentEditOpen && typeof document !== "undefined" ? createPortal(
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget && !assignmentSavingRef.current) {
              setAssignmentEditOpen(false);
            }
          }}
        >
          <div
            ref={assignmentDialogRef}
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-assignment-dialog-title"
            aria-describedby="edit-assignment-dialog-description"
            tabIndex={-1}
          >
            <div className="dense-row">
              <h3 id="edit-assignment-dialog-title" className="surface-title">Edit assignment</h3>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setAssignmentEditOpen(false)}
                disabled={assignmentSaving}
              >
                Close
              </button>
            </div>
            <p id="edit-assignment-dialog-description" className="meta">Update what students see and how they should respond.</p>
            <label className="label form-label-top" htmlFor="edit-assignment-title">Assignment name</label>
            <input ref={assignmentTitleInputRef} id="edit-assignment-title" className="input" value={assignmentTitleDraft} onChange={(event) => setAssignmentTitleDraft(event.target.value)} maxLength={100} />
            <label className="label form-label-top" htmlFor="edit-assignment-description">Student directions (optional)</label>
            <input
              id="edit-assignment-description"
              className="input"
              value={assignmentDescriptionDraft}
              onChange={(event) => setAssignmentDescriptionDraft(event.target.value)}
              placeholder="Add a short summary students will see before they record."
              maxLength={500}
            />
            <p className="meta field-meta">{assignmentDescriptionDraft.length}/500</p>
            <label className="label form-label-top" htmlFor="edit-assignment-instructions">Instructions</label>
            <textarea id="edit-assignment-instructions" className="textarea" rows={4} value={assignmentInstructionsDraft} onChange={(event) => setAssignmentInstructionsDraft(event.target.value)} maxLength={500} />
            <label className="label form-label-top" htmlFor="edit-assignment-language">Student response language</label>
            <div className="select-field">
              <select
                id="edit-assignment-language"
                className="input select-input"
                value={assignmentUsesCustomLanguage ? CUSTOM_ASSIGNMENT_LANGUAGE_VALUE : assignmentTargetLanguageDraft}
                aria-describedby="edit-assignment-language-help"
                onChange={(event) => {
                  if (event.target.value === CUSTOM_ASSIGNMENT_LANGUAGE_VALUE) {
                    setAssignmentUsesCustomLanguage(true);
                    setAssignmentTargetLanguageDraft("");
                    return;
                  }
                  setAssignmentUsesCustomLanguage(false);
                  setAssignmentTargetLanguageDraft(event.target.value);
                }}
              >
                {ASSIGNMENT_LANGUAGE_OPTIONS.map((language) => (
                  <option key={language} value={language}>{language}</option>
                ))}
                <option value={CUSTOM_ASSIGNMENT_LANGUAGE_VALUE}>Other language...</option>
              </select>
              <ChevronDown size={18} aria-hidden="true" />
            </div>
            {assignmentUsesCustomLanguage ? (
              <>
                <label className="label form-label-top" htmlFor="edit-assignment-custom-language">Other response language</label>
                <input
                  id="edit-assignment-custom-language"
                  className="input"
                  value={assignmentTargetLanguageDraft}
                  onChange={(event) => setAssignmentTargetLanguageDraft(event.target.value)}
                  placeholder="Enter a language"
                  maxLength={80}
                />
              </>
            ) : null}
            <p id="edit-assignment-language-help" className="meta field-meta">
              Choose the language students will speak. AI grading evaluates responses in this language.
            </p>
            <label className="label form-label-top" htmlFor="edit-assignment-max-points">Points possible</label>
            {assignmentRubricEnabled ? (
              <div className="notice info assignment-attachment-notice">
                Points possible: <strong>{parseRubricCriteria(assignmentRubricCriteriaDraft).reduce((sum, criterion) => sum + (Number.isFinite(criterion.maxPoints) ? criterion.maxPoints : 0), 0)}</strong>
              </div>
            ) : (
              <input
                id="edit-assignment-max-points"
                className="input"
                type="number"
                min={1}
                max={1000}
                step={1}
                inputMode="numeric"
                value={assignmentMaxPointsDraft}
                onChange={(event) => setAssignmentMaxPointsDraft(event.target.value)}
              />
            )}
            <RubricBuilder
              enabled={assignmentRubricEnabled}
              title={assignmentRubricTitleDraft}
              criteria={assignmentRubricCriteriaDraft}
              totalPoints={parseRubricCriteria(assignmentRubricCriteriaDraft).reduce(
                (sum, criterion) => sum + (Number.isFinite(criterion.maxPoints) ? criterion.maxPoints : 0),
                0
              )}
              onToggle={(enabled) => {
                setAssignmentRubricEnabled(enabled);
                if (enabled && assignmentRubricCriteriaDraft.length === 0) {
                  setAssignmentRubricCriteriaDraft([createCriterionDraft()]);
                }
              }}
              onTitleChange={setAssignmentRubricTitleDraft}
              onCriterionChange={(index, update) =>
                setAssignmentRubricCriteriaDraft((prev) =>
                  prev.map((criterion, criterionIndex) =>
                    criterionIndex === index ? { ...criterion, ...update } : criterion
                  )
                )
              }
              onAddCriterion={() =>
                setAssignmentRubricCriteriaDraft((prev) => [...prev, createCriterionDraft()])
              }
              onRemoveCriterion={(index) =>
                setAssignmentRubricCriteriaDraft((prev) =>
                  prev.filter((_, criterionIndex) => criterionIndex !== index)
                )
              }
              onLoadTemplate={(templateTitle, templateCriteria) => {
                setAssignmentRubricTitleDraft(templateTitle);
                setAssignmentRubricCriteriaDraft(templateCriteria);
              }}
            />
            <label className="label form-label-top" htmlFor="edit-assignment-max-submissions">Max submissions per student</label>
            <input id="edit-assignment-max-submissions" className="input" type="number" min={0} max={50} step={1} inputMode="numeric" value={assignmentMaxSubmissionsDraft} onChange={(event) => setAssignmentMaxSubmissionsDraft(event.target.value)} placeholder="Unlimited" />
            <p className="meta field-meta">0 or blank = unlimited. Students can delete and resubmit.</p>
            <label className="label form-label-top" htmlFor="edit-assignment-max-recording">Max recording length (seconds)</label>
            <input id="edit-assignment-max-recording" className="input" type="number" min={10} max={300} step={1} inputMode="numeric" value={assignmentMaxRecordingSecondsDraft} onChange={(event) => setAssignmentMaxRecordingSecondsDraft(event.target.value)} />
            <p className="meta field-meta">10–300 seconds. Default 180.</p>
            {aiGradingEnabled || activeAssignment?.autoTranscribe ? (
              <>
                <label className="checkbox-row form-label-top">
                  <input
                    type="checkbox"
                    checked={assignmentAutoTranscribeDraft}
                    onChange={(event) => setAssignmentAutoTranscribeDraft(event.target.checked)}
                    disabled={!aiGradingEnabled && !assignmentAutoTranscribeDraft}
                  />
                  Automatically transcribe new submissions
                </label>
                <p className="meta field-meta">
                  Applies to future submissions. Each usable new transcript uses one AI-assisted recording
                  unit; grading that same recording later is included. Turning this off cancels work that
                  has not started and keeps transcripts already created; a provider request already underway
                  may still finish and count.
                  {!aiGradingEnabled ? " AI processing is currently paused for this deployment." : ""}
                </p>
              </>
            ) : null}
            <label className="label form-label-top" htmlFor="edit-assignment-attachment">Attachment (optional)</label>
            <input
              id="edit-assignment-attachment"
              className="input"
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              onChange={(event) => void handleAssignmentAttachmentChange(event)}
            />
            <p className="meta field-meta">Upload a PDF or image students can open from the assignment page. Maximum 3 MB.</p>
            {assignmentAttachmentDraft ? (
              <div className="notice info assignment-attachment-notice">
                New attachment: <strong>{assignmentAttachmentDraft.fileName}</strong>
                <button
                  type="button"
                  className="text-link"
                  aria-label={`Remove attachment ${assignmentAttachmentDraft.fileName}`}
                  onClick={() => setAssignmentAttachmentDraft(null)}
                >
                  Remove attachment
                </button>
              </div>
            ) : activeAssignment?.attachmentUrl && !assignmentAttachmentRemoved ? (
              <div className="notice info assignment-attachment-notice">
                Current attachment: <strong>{activeAssignment.attachmentName}</strong>
                <a
                  className="text-link"
                  href={`/api/assignments/${encodeURIComponent(activeAssignment.id)}/attachment`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open attachment ${activeAssignment.attachmentName}`}
                >
                  Open attachment
                </a>
                <button
                  type="button"
                  className="text-link"
                  aria-label={`Remove attachment ${activeAssignment.attachmentName}`}
                  onClick={() => setAssignmentAttachmentRemoved(true)}
                >
                  Remove attachment
                </button>
              </div>
            ) : null}
            {assignmentError ? <p className="card-inline-error">{assignmentError}</p> : null}
            <div className="actions modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setAssignmentEditOpen(false)} disabled={assignmentSaving}>Cancel</button><button type="button" className="btn btn-primary" onClick={() => void saveAssignmentEdit()} disabled={assignmentSaving}>{assignmentSaving ? "Saving..." : "Save changes"}</button></div>
          </div>
        </div>,
        document.body
      ) : null}

      {undoState ? <UndoToast message={undoState.message} expiresAt={undoState.expiresAt} onUndo={undoDelete} onDismiss={() => setUndoState(null)} /> : null}
    </main>
  );
}
