export const TEACHER_SELF_REGISTRATION_ENV_KEY = "ALLOW_TEACHER_SELF_REGISTRATION";

/**
 * Normalize a boolean environment value without treating other truthy strings
 * as enabled.
 *
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
export function normalizeBooleanEnvironmentValue(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : undefined;
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [environment]
 * @returns {string | undefined}
 */
export function getTeacherSelfRegistrationSetting(environment = process.env) {
  return normalizeBooleanEnvironmentValue(environment[TEACHER_SELF_REGISTRATION_ENV_KEY]);
}

/**
 * Runtime registration is open only for an explicit, normalized `true`.
 * Missing, false, and malformed settings all fail closed.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [environment]
 */
export function isTeacherSelfRegistrationEnabled(environment = process.env) {
  return getTeacherSelfRegistrationSetting(environment) === "true";
}
