// Google Analytics, Tag Manager, and Search Console identifiers are public
// browser-side values, not secrets. Checked-in values let TryHabla operate even
// when dashboard env writes are unavailable; environment values can still override
// them per deployment.

const CHECKED_IN_GOOGLE_ANALYTICS_ID = "G-L8T1XVR1H8";
const CHECKED_IN_GOOGLE_TAG_MANAGER_ID = "";
const CHECKED_IN_GOOGLE_SITE_VERIFICATION = "";

export const GOOGLE_ANALYTICS_ID =
  process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID?.trim() ||
  CHECKED_IN_GOOGLE_ANALYTICS_ID;

export const GOOGLE_TAG_MANAGER_ID =
  process.env.NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID?.trim() ||
  CHECKED_IN_GOOGLE_TAG_MANAGER_ID;

export const GOOGLE_SITE_VERIFICATION =
  process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim() ||
  CHECKED_IN_GOOGLE_SITE_VERIFICATION;
