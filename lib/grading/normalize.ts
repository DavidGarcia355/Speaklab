export type PiiRedactionCounts = {
  emails: number;
  phoneNumbers: number;
  socialSecurityNumbers: number;
  knownNames: number;
};

export type PromptInjectionCheck = {
  detected: boolean;
  signals: string[];
};

export type NormalizedSubmission = {
  text: string;
  containsPii: boolean;
  redactions: PiiRedactionCounts;
  promptInjection: PromptInjectionCheck;
};

export type NormalizeSubmissionOptions = {
  /** Names supplied from trusted application data; names are never inferred. */
  knownNames?: readonly string[];
};

const PROMPT_INJECTION_PATTERNS: ReadonlyArray<{
  signal: string;
  pattern: RegExp;
}> = [
  {
    signal: "instruction_override",
    pattern: /\b(?:ignore|disregard|override|bypass)\b.{0,100}\b(?:instructions?|rubric|prompt|system|developer)\b/i,
  },
  {
    signal: "score_manipulation",
    pattern: /\b(?:give|award|assign|set)\b.{0,60}\b(?:100|full|maximum|perfect)\b.{0,30}\b(?:points?|credit|score|grade)?\b/i,
  },
  {
    signal: "role_manipulation",
    pattern: /\b(?:you are now|act as|pretend (?:that )?you are)\b/i,
  },
  {
    signal: "prompt_exfiltration",
    pattern: /\b(?:reveal|repeat|print|show)\b.{0,80}\b(?:system prompt|developer message|hidden instructions?)\b/i,
  },
  {
    signal: "role_delimiter",
    pattern: /<\|\s*(?:system|assistant|developer|tool)\s*\|>|\[(?:system|developer)\s*(?:message|prompt)\]/i,
  },
];

export function stripHtml(input: string) {
  return input
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<\/?[a-z][^>]*>/gi, " ");
}

function decodeHtmlEntities(input: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return input
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match)
    .replace(/&#(\d{1,7});/g, (match, digits: string) => {
      const codePoint = Number(digits);
      return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/&#x([0-9a-f]{1,6});/gi, (match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : match;
    });
}

function isValidCodePoint(value: number) {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff);
}

/** Normalization used for grading, evidence checks, and cache identities. */
export function normalizeText(input: string) {
  return decodeHtmlEntities(stripHtml(String(input ?? "")))
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactPii(
  input: string,
  options: NormalizeSubmissionOptions = {}
): { text: string; counts: PiiRedactionCounts } {
  const counts: PiiRedactionCounts = {
    emails: 0,
    phoneNumbers: 0,
    socialSecurityNumbers: 0,
    knownNames: 0,
  };
  let text = input;

  text = text.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/gi,
    () => {
      counts.emails += 1;
      return "[REDACTED_EMAIL]";
    }
  );

  text = text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, () => {
    counts.socialSecurityNumbers += 1;
    return "[REDACTED_SSN]";
  });

  text = text.replace(/(^|[^\p{L}\p{N}_])(\+?\d[\d(). -]{7,}\d)(?![\p{L}\p{N}_])/gu, (match, prefix: string, candidate: string) => {
    const digitCount = candidate.replace(/\D/g, "").length;
    if (digitCount < 10 || digitCount > 15) return match;
    counts.phoneNumbers += 1;
    return `${prefix}[REDACTED_PHONE]`;
  });

  const names = [...new Set(options.knownNames?.map(normalizeText).filter(Boolean) ?? [])]
    .sort((left, right) => right.length - left.length);
  for (const name of names) {
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}_])(${escapeRegExp(name)})(?![\\p{L}\\p{N}_])`,
      "giu"
    );
    text = text.replace(pattern, (_match, prefix: string) => {
      counts.knownNames += 1;
      return `${prefix}[REDACTED_NAME]`;
    });
  }

  return { text, counts };
}

export function detectPromptInjection(input: string): PromptInjectionCheck {
  const signals = PROMPT_INJECTION_PATTERNS
    .filter(({ pattern }) => pattern.test(input))
    .map(({ signal }) => signal);
  return { detected: signals.length > 0, signals };
}

export function normalizeSubmission(
  input: string,
  options: NormalizeSubmissionOptions = {}
): NormalizedSubmission {
  const normalized = normalizeText(input);
  const { text, counts } = redactPii(normalized, options);
  const redactionTotal = Object.values(counts).reduce((total, count) => total + count, 0);
  return {
    text,
    containsPii: redactionTotal > 0,
    redactions: counts,
    promptInjection: detectPromptInjection(text),
  };
}
