export type Box = { x: number; y: number; width: number; height: number };
export type StudentDestination =
  | "recordings"
  | "classes"
  | "assignments"
  | "record";

export function studentDestination(path: string): StudentDestination | null {
  if (path === "/student" || path === "/student/") return "recordings";
  if (path === "/student/dashboard" || path === "/student/dashboard/")
    return "classes";
  if (/^\/student\/class\/[^/]+\/?$/.test(path)) return "assignments";
  if (/^\/a\/[^/]+\/?$/.test(path)) return "record";
  return null;
}

export function motionLink(
  href: string,
  current: string,
  origin: string,
): string | null {
  try {
    const url = new URL(href, origin);
    if (
      url.origin !== origin ||
      url.pathname === current ||
      !studentDestination(url.pathname)
    )
      return null;
    return url.pathname;
  } catch {
    return null;
  }
}

export const clamp = (n: number, lo = 0, hi = 1) =>
  Math.max(lo, Math.min(hi, n));
export const ease = (n: number) => {
  const p = clamp(n);
  return p * p * (3 - 2 * p);
};
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

export const ANTICIPATION_MS = 160;
export const FLIGHT_MS = 1180;
export const LANDING_MS = 420;
export const HOLD_PROGRESS = 0.63;
export const LANDING_PROGRESS = 0.74;

export type MotionScore = {
  anticipation: number;
  flight: number;
  landing: number;
  arc: number;
  scale: number;
};

export function motionScore(destination: StudentDestination): MotionScore {
  switch (destination) {
    case "classes":
      return {
        anticipation: ANTICIPATION_MS,
        flight: FLIGHT_MS,
        landing: LANDING_MS,
        arc: 1,
        scale: 1,
      };
    case "recordings":
      return {
        anticipation: 140,
        flight: 1000,
        landing: 360,
        arc: 0.85,
        scale: 0.94,
      };
    case "assignments":
      return {
        anticipation: 110,
        flight: 780,
        landing: 300,
        arc: 0.6,
        scale: 0.85,
      };
    case "record":
      return {
        anticipation: 100,
        flight: 600,
        landing: 280,
        arc: 0.38,
        scale: 0.75,
      };
  }
}

export function progressBeforeArrival(
  elapsed: number,
  score = motionScore("classes"),
) {
  return clamp((elapsed - score.anticipation) / score.flight, 0, HOLD_PROGRESS);
}

export function imageBox(element: HTMLImageElement): Box {
  const rect = element.getBoundingClientRect();
  const ratio = Math.min(
    rect.width / element.naturalWidth,
    rect.height / element.naturalHeight,
  );
  const width = element.naturalWidth * ratio,
    height = element.naturalHeight * ratio;
  const position = getComputedStyle(element).objectPosition;
  return {
    x: rect.x + (rect.width - width) * (position.startsWith("100%") ? 1 : 0.5),
    y: rect.bottom - height,
    width,
    height,
  };
}

export function flightPoint(
  start: Box,
  end: Box,
  p: number,
  width: number,
  height: number,
  arcScale = 1,
) {
  const x0 = start.x + start.width / 2,
    y0 = start.y + start.height / 2;
  const x1 = end.x + end.width / 2,
    y1 = end.y + end.height / 2;
  const arc = Math.sin(clamp(p) * Math.PI) * arcScale;
  return {
    x: clamp(
      lerp(x0, x1, p) - arc * Math.min(width * 0.28, 360),
      85,
      width - 85,
    ),
    y: clamp(
      lerp(y0, y1, p) + arc * Math.min(height * 0.13, 100),
      100,
      height - 110,
    ),
  };
}
