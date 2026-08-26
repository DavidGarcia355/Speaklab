import "server-only";

import "server-only";

export const INTERNAL_TEST_EMAILS = Object.freeze([
  "eddiegarcia814@gmail.com",
  "kyrie2celtics@gmail.com",
  "davidsgarcia325@gmail.com",
] as const);

export function isInternalTestEmail(email: string) {
  return INTERNAL_TEST_EMAILS.includes(
    email.trim().toLowerCase() as (typeof INTERNAL_TEST_EMAILS)[number],
  );
}
