const UNSAFE_FILENAME_CHARACTERS = /[\u0000-\u001f\u007f<>:"/\\|?*\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function clipUnicode(value: string, maxLength: number) {
  return Array.from(value).slice(0, maxLength).join("");
}

export function sanitizeDownloadFilenameBase(
  value: string,
  fallback = "TryHabla-recording",
  maxLength = 180,
) {
  const cleaned = value
    .normalize("NFKC")
    .replace(UNSAFE_FILENAME_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  const clipped = clipUnicode(cleaned, maxLength).replace(/[.\s]+$/g, "");
  if (!clipped) return fallback;
  return WINDOWS_RESERVED_NAME.test(clipped) ? `${clipped}-file` : clipped;
}

function filenameSegment(value: string, fallback: string, maxLength: number) {
  return sanitizeDownloadFilenameBase(value, fallback, maxLength) || fallback;
}

function stableFallbackReference(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function shortSubmissionReference(submissionId: string) {
  const withoutPrefix = submissionId.trim().replace(/^sub[_-]?/i, "");
  const compact = withoutPrefix.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `sub-${compact.slice(0, 12) || stableFallbackReference(submissionId)}`;
}

export function buildSubmissionDownloadFilenameBase(input: {
  studentName: string;
  assignmentTitle: string;
  submittedAt: number;
  submissionId: string;
}) {
  const submittedDate = new Date(input.submittedAt);
  const date = Number.isFinite(submittedDate.getTime())
    ? submittedDate.toISOString().slice(0, 10)
    : "unknown-date";
  const student = filenameSegment(input.studentName, "Student", 40);
  const assignment = filenameSegment(input.assignmentTitle, "Assignment", 56);
  const reference = shortSubmissionReference(input.submissionId);

  return sanitizeDownloadFilenameBase(
    `TryHabla - ${student} - ${assignment} - ${date} - ${reference}`,
    `TryHabla - ${date} - ${reference}`,
  );
}
