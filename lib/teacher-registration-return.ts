const DEFAULT_TEACHER_RETURN_PATH = "/teacher";
const TEACHER_REGISTRATION_PATH = "/teacher/register";

export function normalizeTeacherReturnPath(value: string | null | undefined) {
  const candidate = value?.trim() ?? "";
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.length > 1000) {
    return DEFAULT_TEACHER_RETURN_PATH;
  }

  try {
    const parsed = new URL(candidate, "https://tryhabla.invalid");
    const isTeacherPath =
      parsed.pathname === DEFAULT_TEACHER_RETURN_PATH ||
      parsed.pathname.startsWith(`${DEFAULT_TEACHER_RETURN_PATH}/`);
    const isRegistrationPath =
      parsed.pathname === TEACHER_REGISTRATION_PATH ||
      parsed.pathname === `${TEACHER_REGISTRATION_PATH}/`;

    if (parsed.origin !== "https://tryhabla.invalid" || !isTeacherPath || isRegistrationPath) {
      return DEFAULT_TEACHER_RETURN_PATH;
    }

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return DEFAULT_TEACHER_RETURN_PATH;
  }
}

export function teacherReturnPathFromSearch(search: string) {
  return normalizeTeacherReturnPath(new URLSearchParams(search).get("callbackUrl"));
}

export function buildTeacherRegistrationCallbackUrl(returnPath: string) {
  const safeReturnPath = normalizeTeacherReturnPath(returnPath);
  return `${TEACHER_REGISTRATION_PATH}?callbackUrl=${encodeURIComponent(safeReturnPath)}`;
}
