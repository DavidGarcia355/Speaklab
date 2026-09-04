import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync("app/globals.css", "utf8");
const cssWithoutComments = styles.replace(/\/\*[\s\S]*?\*\//g, "");

type CssRule = {
  declarations: Record<string, string>;
  index: number;
  selectors: string[];
};

function normalizeSelector(selector: string) {
  return selector.replace(/\s+/g, " ").trim();
}

function parseDeclarations(body: string) {
  return Object.fromEntries(
    [...body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(([, property, value]) => [
      property.toLowerCase(),
      value.trim().toLowerCase(),
    ]),
  );
}

function parseLeafRules(css: string): CssRule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => {
    const selectorSource = match[1].replace(/@[^;{}]+;/g, "");
    return {
      declarations: parseDeclarations(match[2]),
      index: match.index,
      selectors: selectorSource.split(",").map(normalizeSelector),
    };
  });
}

const rules = parseLeafRules(cssWithoutComments);

function rulesFor(selector: string) {
  const normalized = normalizeSelector(selector);
  return rules.filter((rule) => rule.selectors.includes(normalized));
}

function lastRuleFor(selector: string) {
  const matches = rulesFor(selector);
  expect(matches.length, `Expected a CSS rule for ${selector}`).toBeGreaterThan(0);
  return matches.at(-1)!;
}

function customPropertiesFor(selector: string) {
  const matches = rulesFor(selector);
  expect(matches.length, `Expected a CSS rule for ${selector}`).toBeGreaterThan(0);

  return Object.fromEntries(
    matches.flatMap((rule) =>
      Object.entries(rule.declarations).filter(([property]) => property.startsWith("--")),
    ),
  );
}

function rgbFromHex(value: string): [number, number, number] {
  const normalized = value.toLowerCase();
  const shorthand = normalized.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  const full = normalized.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/);

  if (shorthand) {
    return [
      Number.parseInt(shorthand[1].repeat(2), 16),
      Number.parseInt(shorthand[2].repeat(2), 16),
      Number.parseInt(shorthand[3].repeat(2), 16),
    ];
  }

  if (full) {
    return [
      Number.parseInt(full[1], 16),
      Number.parseInt(full[2], 16),
      Number.parseInt(full[3], 16),
    ];
  }

  throw new Error(`Expected a three- or six-digit hex color, received ${value}`);
}

function relativeLuminance(value: string) {
  const channels = rgbFromHex(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

const light = customPropertiesFor(":root");
const dark = customPropertiesFor("html.dark");

const lightPalette = {
  "--background": "#f5fbff",
  "--surface": "#fffdf4",
  "--surface-soft": "#e8f7ff",
  "--surface-muted": "#f8efdd",
  "--text": "#172238",
  "--muted": "#58677a",
  "--line": "#cddfe8",
  "--line-strong": "#a9cedc",
  "--primary": "#1374ad",
  "--primary-strong": "#0b5f91",
  "--primary-soft": "#d9f2ff",
  "--primary-soft-border": "#92d2ec",
  "--coral": "#f26c5e",
  "--mascot-orange": "#f06f25",
  "--mint": "#3ebf8a",
  "--mango": "#f06f25",
  "--lavender": "#8d77d8",
  "--danger": "#d73d45",
  "--success": "#16865d",
  "--status-warning-bg": "#fffbeb",
  "--status-warning-border": "#fcd34d",
  "--status-warning-text": "#92400e",
  "--status-success-bg": "#ecfdf3",
  "--status-success-border": "#86efac",
  "--status-success-text": "#166534",
  "--status-neutral-bg": "#f1f5f9",
  "--status-neutral-border": "#cbd5e1",
  "--status-neutral-text": "#334155",
} as const;

const structuralTokens = [
  "--background",
  "--surface",
  "--surface-soft",
  "--surface-muted",
  "--line",
  "--line-strong",
] as const;

const accentTokens = [
  "--primary",
  "--primary-strong",
  "--coral",
  "--mascot-orange",
  "--mint",
  "--mango",
  "--lavender",
  "--danger",
  "--success",
] as const;

describe("dark theme visual contract", () => {
  it("keeps the approved light palette unchanged", () => {
    expect(light).toMatchObject(lightPalette);
  });

  it("uses a black canvas and color-neutral structural surfaces", () => {
    expect(dark["--background"]).toBe("#000000");

    for (const token of structuralTokens) {
      const [red, green, blue] = rgbFromHex(dark[token]);
      expect(red, `${token} must not carry a blue/navy tint`).toBe(green);
      expect(green, `${token} must not carry a blue/navy tint`).toBe(blue);
    }
  });

  it("preserves every brand accent from light mode", () => {
    for (const token of accentTokens) {
      expect(dark[token], `${token} must not shift in dark mode`).toBe(light[token]);
    }
  });

  it("keeps primary and secondary copy readable on every structural surface", () => {
    for (const backgroundToken of structuralTokens.slice(0, 4)) {
      const background = dark[backgroundToken];
      expect(
        contrastRatio(dark["--text"], background),
        `--text on ${backgroundToken}`,
      ).toBeGreaterThanOrEqual(7);
      expect(
        contrastRatio(dark["--muted"], background),
        `--muted on ${backgroundToken}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(["warning", "success", "neutral"] as const)(
    "keeps %s status copy readable",
    (tone) => {
      expect(
        contrastRatio(dark[`--status-${tone}-text`], dark[`--status-${tone}-bg`]),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("restates dangerous buttons after the generic dark button rule", () => {
    const genericButton = lastRuleFor("html.dark .btn");
    const dangerButton = lastRuleFor("html.dark .btn.btn-danger");

    expect(dangerButton.index).toBeGreaterThan(genericButton.index);
    expect(dangerButton.declarations.background).toBeTruthy();
    expect(dangerButton.declarations.color).toBeTruthy();
  });

  it("restates disabled buttons after the generic dark button rule", () => {
    const genericButton = lastRuleFor("html.dark .btn");
    const disabledButton = lastRuleFor("html.dark .btn:disabled");

    expect(disabledButton.index).toBeGreaterThan(genericButton.index);
    expect(disabledButton.declarations.background).toBeTruthy();
    expect(disabledButton.declarations.color).toBeTruthy();
  });

  it.each(["ready", "success"] as const)(
    "restates %s banners after the generic dark state banner",
    (tone) => {
      const genericState = lastRuleFor("html.dark .state-banner");
      const selector = `html.dark .state-${tone}`;
      const state = lastRuleFor(selector);
      expect(state.index).toBeGreaterThan(genericState.index);
      expect(state.declarations["border-color"]).toBeTruthy();
      expect(state.declarations.background).toBeTruthy();
      expect(state.declarations.color).toBeTruthy();
    },
  );
});
