export type ClassItem = {
  id: string;
  name: string;
  createdAt: number;
};

export type AssignmentItem = {
  id: string;
  classId: string;
  title: string;
  description: string;
  instructions: string;
  createdAt: number;
};

export type SubmissionItem = {
  id: string;
  assignmentId: string;
  studentName: string;
  audioData: string; // base64 encoded audio
  submittedAt: number;
  feedback?: string;
  grade?: number;
};

const CLASSES_KEY = "speaklab_classes_v1";
const ASSIGNMENTS_KEY = "speaklab_assignments_v1";
const SUBMISSIONS_KEY = "speaklab_submissions_v1";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function makeId(prefix: string) {
  const uuid =
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : null;
  return uuid
    ? `${prefix}_${uuid}`
    : `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

/** ---- CLASSES ---- */
export function getClasses(): ClassItem[] {
  return read<ClassItem[]>(CLASSES_KEY, []).sort((a, b) => b.createdAt - a.createdAt);
}

export function addClass(name: string): ClassItem {
  const classes = read<ClassItem[]>(CLASSES_KEY, []);
  const item: ClassItem = { id: makeId("class"), name, createdAt: Date.now() };
  classes.unshift(item);
  write(CLASSES_KEY, classes);
  return item;
}

export function getClassById(id: string): ClassItem | undefined {
  return getClasses().find((c) => c.id === id);
}

/** ---- ASSIGNMENTS ---- */
export function getAssignmentsByClassId(classId: string): AssignmentItem[] {
  const all = read<AssignmentItem[]>(ASSIGNMENTS_KEY, []);
  return all
    .filter((a) => a.classId === classId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function addAssignment(
  input: Omit<AssignmentItem, "id" | "createdAt">
): AssignmentItem {
  const all = read<AssignmentItem[]>(ASSIGNMENTS_KEY, []);
  const item: AssignmentItem = {
    id: makeId("asg"),
    createdAt: Date.now(),
    ...input,
  };
  all.unshift(item);
  write(ASSIGNMENTS_KEY, all);
  return item;
}

export function getAssignmentById(id: string): AssignmentItem | undefined {
  const all = read<AssignmentItem[]>(ASSIGNMENTS_KEY, []);
  return all.find((a) => a.id === id);
}

/** ---- SUBMISSIONS ---- */
export function getSubmissionsByAssignmentId(assignmentId: string): SubmissionItem[] {
  const all = read<SubmissionItem[]>(SUBMISSIONS_KEY, []);
  return all
    .filter((s) => s.assignmentId === assignmentId)
    .sort((a, b) => b.submittedAt - a.submittedAt);
}

export function addSubmission(
  input: Omit<SubmissionItem, "id" | "submittedAt">
): SubmissionItem {
  const all = read<SubmissionItem[]>(SUBMISSIONS_KEY, []);
  const item: SubmissionItem = {
    id: makeId("sub"),
    submittedAt: Date.now(),
    ...input,
  };
  all.unshift(item);
  write(SUBMISSIONS_KEY, all);
  return item;
}

export function getSubmissionById(id: string): SubmissionItem | undefined {
  const all = read<SubmissionItem[]>(SUBMISSIONS_KEY, []);
  return all.find((s) => s.id === id);
}

export function updateSubmissionFeedback(id: string, feedback: string, grade?: number) {
  const all = read<SubmissionItem[]>(SUBMISSIONS_KEY, []);
  const index = all.findIndex((s) => s.id === id);
  if (index !== -1) {
    all[index].feedback = feedback;
    if (grade !== undefined) {
      all[index].grade = grade;
    }
    write(SUBMISSIONS_KEY, all);
  }
}
