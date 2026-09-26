import {
  GOOGLE_ANALYTICS_ID,
  GOOGLE_TAG_MANAGER_ID,
} from "@/lib/public-google-config";

export type AnalyticsParams = Record<string, string | number | boolean>;

const GA_ID = GOOGLE_ANALYTICS_ID;
const GTM_ID = GOOGLE_TAG_MANAGER_ID;
const DIRECT_GA_FALLBACK = Boolean(GA_ID && !GTM_ID);

const ANALYTICS_PATHS = new Set([
  "/",
  "/about",
  "/auth/error",
  "/billing",
  "/changelog",
  "/district",
  "/faq",
  "/feedback",
  "/pricing",
  "/privacy",
  "/students",
  "/teacher/register",
  "/teachers",
  "/terms",
]);

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function normalizeAnalyticsPath(pathname: string) {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return ANALYTICS_PATHS.has(trimmed) ? trimmed : null;
}

export function analyticsDestination(href: string, origin: string) {
  if (!href) return "unknown";

  try {
    const url = new URL(href, origin);
    if (url.protocol === "mailto:") return "mailto";
    if (url.protocol === "tel:") return "tel";
    if (url.protocol !== "http:" && url.protocol !== "https:") return "other";
    if (url.origin !== origin) return `external:${url.hostname}`;
    return url.pathname || "/";
  } catch {
    return "unknown";
  }
}

function ensureDataLayer() {
  window.dataLayer = window.dataLayer || [];
  return window.dataLayer;
}

export function ensureGoogleTag() {
  const dataLayer = ensureDataLayer();
  if (!window.gtag) {
    window.gtag = (...args: unknown[]) => {
      dataLayer.push(args);
    };
  }
  return window.gtag;
}

export function trackAnalyticsEvent(name: string, params: AnalyticsParams = {}) {
  if (typeof window === "undefined") return;
  const pagePath = normalizeAnalyticsPath(window.location.pathname);
  if (!pagePath) return;

  ensureDataLayer().push({
    event: `tryhabla_${name}`,
    page_path: pagePath,
    ...params,
  });

  if (DIRECT_GA_FALLBACK) {
    window.gtag?.("event", name, {
      page_path: pagePath,
      ...params,
    });
  }
}
