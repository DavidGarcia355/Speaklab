const REGISTRATION_ENV_KEY = "ALLOW_TEACHER_SELF_REGISTRATION";

/**
 * Public TryHabla releases must opt into the same self-serve registration that
 * the public pages advertise. Invite-only releases remain available, but only
 * through an explicit setting and release acknowledgement.
 *
 * @param {{
 *   environment?: NodeJS.ProcessEnv | Record<string, string | undefined>;
 *   privateDeployment?: boolean;
 * }} [options]
 * @returns {"public" | "private"}
 */
export function assertTeacherRegistrationReleasePolicy(options = {}) {
  const environment = options.environment ?? process.env;
  const value = environment[REGISTRATION_ENV_KEY]?.trim().toLowerCase();

  if (value === "true") {
    if (options.privateDeployment) {
      throw new Error(
        `${REGISTRATION_ENV_KEY}=true conflicts with --private-deployment. ` +
          "Set it to false for an invite-only deployment.",
      );
    }
    return "public";
  }

  if (value === "false") {
    if (!options.privateDeployment) {
      throw new Error(
        `${REGISTRATION_ENV_KEY}=false conflicts with TryHabla's public Start free experience. ` +
          "Set it to true, or rerun with --private-deployment for an intentionally invite-only deployment.",
      );
    }
    return "private";
  }

  if (!value) {
    throw new Error(
      `${REGISTRATION_ENV_KEY} must be explicit: true for public TryHabla releases, ` +
        "or false together with --private-deployment for an invite-only deployment.",
    );
  }

  throw new Error(`${REGISTRATION_ENV_KEY} must be either true or false.`);
}
