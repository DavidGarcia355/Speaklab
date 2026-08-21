import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

type BenchmarkModelCost = {
  id: string;
  provider: string;
  model: string;
  costs?: {
    cheapRequestUsd?: number;
    escalationRequestUsd?: number;
  };
};

type BenchmarkReport = {
  models?: BenchmarkModelCost[];
};

type Scenario = {
  name: "expected" | "conservative" | "worst-case";
  cacheHitRate: number;
  retryRate: number;
  escalationRate: number;
  costMultiplier: number;
};

type ProfitRow = {
  teachers: number;
  revenueUsd: number;
  gradingApiCostUsd: number;
  transcriptionApiCostUsd: number;
  totalAiApiCostUsd: number;
  aiCostPerSubmissionUsd: number;
  aiCostPerTeacherUsd: number;
  paymentProcessingCostUsd: number;
  hostingAndStorageCostUsd: number;
  grossContributionPerTeacherUsd: number;
  totalGrossContributionUsd: number;
  contributionMargin: number;
  netAfterFixedBurnUsd: number;
  breakEvenTeachers: number | null;
  costStatus: "target" | "acceptable" | "above-acceptable" | "warning" | "hard-review";
};

type ProfitReport = {
  generatedAt: string;
  assumptions: {
    monthlyPricePerTeacherUsd: number;
    submissionsPerTeacher: number;
    measuredCheapRequestCostUsd: number;
    measuredEscalationRequestCostUsd: number;
    transcriptionCostPerSubmissionUsd: number;
    paymentProcessingPercent: number;
    paymentProcessingFixedPerTeacherUsd: number;
    hostingPerTeacherUsd: number;
    storagePerSubmissionUsd: number;
    fixedMonthlyBurnUsd: number;
    deterministicRate: number;
    audioSubmissionRate: number;
    teacherScales: number[];
    modelSource: string;
  };
  scenarios: Array<Scenario & { rows: ProfitRow[] }>;
  warnings: string[];
};

const DEFAULT_TEACHER_SCALES = [100, 1_000, 10_000];

function numberOption(
  values: Record<string, string | boolean | undefined>,
  name: string,
  fallback: number,
  input: { min?: number; max?: number } = {}
) {
  const raw = values[name];
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  const min = input.min ?? Number.NEGATIVE_INFINITY;
  const max = input.max ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`--${name} must be a number between ${min} and ${max}.`);
  }
  return parsed;
}

function round(value: number, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function parseTeacherScales(raw: string | boolean | undefined) {
  if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_TEACHER_SCALES;
  const scales = raw.split(",").map((item) => Number(item.trim()));
  if (scales.length === 0 || scales.some((item) => !Number.isInteger(item) || item <= 0)) {
    throw new Error("--teachers must be a comma-separated list of positive integers.");
  }
  return [...new Set(scales)];
}

function readBenchmarkCosts(filePath: string, requestedModel?: string) {
  const resolved = path.resolve(filePath);
  const report = JSON.parse(fs.readFileSync(resolved, "utf8")) as BenchmarkReport;
  const models = report.models ?? [];
  if (models.length === 0) throw new Error(`Benchmark report ${resolved} contains no model results.`);
  const selected = requestedModel
    ? models.find((item) => item.id === requestedModel || `${item.provider}:${item.model}` === requestedModel)
    : models.length === 1
      ? models[0]
      : undefined;
  if (!selected) {
    const available = models.map((item) => item.id || `${item.provider}:${item.model}`).join(", ");
    throw new Error(
      requestedModel
        ? `Model ${requestedModel} was not found. Available models: ${available}`
        : `Benchmark contains multiple models. Pass --model. Available models: ${available}`
    );
  }
  return {
    cheapRequestUsd: selected.costs?.cheapRequestUsd ?? 0,
    escalationRequestUsd: selected.costs?.escalationRequestUsd ?? 0,
    source: `${resolved} (${selected.id || `${selected.provider}:${selected.model}`})`,
  };
}

function costStatus(costPerTeacherUsd: number): ProfitRow["costStatus"] {
  if (costPerTeacherUsd <= 0.5) return "target";
  if (costPerTeacherUsd < 1) return "acceptable";
  if (costPerTeacherUsd < 2) return "above-acceptable";
  if (costPerTeacherUsd < 3) return "warning";
  return "hard-review";
}

function buildScenarioRows(input: {
  scenario: Scenario;
  teacherScales: number[];
  pricePerTeacherUsd: number;
  submissionsPerTeacher: number;
  cheapRequestCostUsd: number;
  escalationRequestCostUsd: number;
  transcriptionCostPerSubmissionUsd: number;
  paymentPercent: number;
  paymentFixedPerTeacherUsd: number;
  hostingPerTeacherUsd: number;
  storagePerSubmissionUsd: number;
  fixedMonthlyBurnUsd: number;
  deterministicRate: number;
  audioSubmissionRate: number;
}) {
  const aiEligibleSubmissionsPerTeacher =
    input.submissionsPerTeacher * (1 - input.deterministicRate) * (1 - input.scenario.cacheHitRate);
  const gradingCostPerTeacher =
    aiEligibleSubmissionsPerTeacher *
    (input.cheapRequestCostUsd * (1 + input.scenario.retryRate) +
      input.escalationRequestCostUsd * input.scenario.escalationRate) *
    input.scenario.costMultiplier;
  const transcriptionCostPerTeacher =
    input.submissionsPerTeacher *
    input.audioSubmissionRate *
    (1 - input.scenario.cacheHitRate) *
    input.transcriptionCostPerSubmissionUsd *
    input.scenario.costMultiplier;
  const totalAiCostPerTeacher = gradingCostPerTeacher + transcriptionCostPerTeacher;
  const paymentCostPerTeacher =
    input.pricePerTeacherUsd * input.paymentPercent + input.paymentFixedPerTeacherUsd;
  const hostingAndStoragePerTeacher =
    input.hostingPerTeacherUsd + input.storagePerSubmissionUsd * input.submissionsPerTeacher;
  const contributionPerTeacher =
    input.pricePerTeacherUsd -
    totalAiCostPerTeacher -
    paymentCostPerTeacher -
    hostingAndStoragePerTeacher;
  const breakEvenTeachers =
    input.fixedMonthlyBurnUsd <= 0
      ? 0
      : contributionPerTeacher > 0
        ? Math.ceil(input.fixedMonthlyBurnUsd / contributionPerTeacher)
        : null;

  return input.teacherScales.map((teachers): ProfitRow => {
    const revenue = input.pricePerTeacherUsd * teachers;
    const totalContribution = contributionPerTeacher * teachers;
    return {
      teachers,
      revenueUsd: round(revenue, 2),
      gradingApiCostUsd: round(gradingCostPerTeacher * teachers, 2),
      transcriptionApiCostUsd: round(transcriptionCostPerTeacher * teachers, 2),
      totalAiApiCostUsd: round(totalAiCostPerTeacher * teachers, 2),
      aiCostPerSubmissionUsd: round(totalAiCostPerTeacher / input.submissionsPerTeacher, 8),
      aiCostPerTeacherUsd: round(totalAiCostPerTeacher, 4),
      paymentProcessingCostUsd: round(paymentCostPerTeacher * teachers, 2),
      hostingAndStorageCostUsd: round(hostingAndStoragePerTeacher * teachers, 2),
      grossContributionPerTeacherUsd: round(contributionPerTeacher, 2),
      totalGrossContributionUsd: round(totalContribution, 2),
      contributionMargin: round(revenue > 0 ? totalContribution / revenue : 0, 4),
      netAfterFixedBurnUsd: round(totalContribution - input.fixedMonthlyBurnUsd, 2),
      breakEvenTeachers,
      costStatus: costStatus(totalAiCostPerTeacher),
    };
  });
}

export function generateProfitReport(
  values: Record<string, string | boolean | undefined>
): ProfitReport {
  const benchmarkPath = typeof values.benchmark === "string" ? values.benchmark : undefined;
  const requestedModel = typeof values.model === "string" ? values.model : undefined;
  const benchmark = benchmarkPath
    ? readBenchmarkCosts(benchmarkPath, requestedModel)
    : { cheapRequestUsd: 0, escalationRequestUsd: 0, source: "explicit CLI values" };
  const cheapRequestCostUsd = numberOption(
    values,
    "cheap-cost-usd",
    benchmark.cheapRequestUsd,
    { min: 0 }
  );
  const escalationRequestCostUsd = numberOption(
    values,
    "escalation-cost-usd",
    benchmark.escalationRequestUsd,
    { min: 0 }
  );
  const averageAudioMinutes = numberOption(values, "average-audio-minutes", 0, { min: 0 });
  const transcriptionPerMinuteUsd = numberOption(values, "transcription-per-minute-usd", 0, {
    min: 0,
  });
  const explicitTranscriptionCost = numberOption(
    values,
    "transcription-cost-per-submission-usd",
    0,
    { min: 0 }
  );
  if (explicitTranscriptionCost > 0 && averageAudioMinutes * transcriptionPerMinuteUsd > 0) {
    throw new Error(
      "Use either --transcription-cost-per-submission-usd or the per-minute/audio-minutes pair, not both."
    );
  }
  const transcriptionCostPerSubmissionUsd =
    explicitTranscriptionCost || averageAudioMinutes * transcriptionPerMinuteUsd;
  const pricePerTeacherUsd = numberOption(values, "price-per-teacher-usd", 49, { min: 0 });
  const submissionsPerTeacher = numberOption(values, "submissions-per-teacher", 2_240, {
    min: 1,
  });
  const paymentPercent = numberOption(values, "payment-percent", 0, { min: 0, max: 1 });
  const paymentFixedPerTeacherUsd = numberOption(values, "payment-fixed-usd", 0, { min: 0 });
  const hostingPerTeacherUsd = numberOption(values, "hosting-per-teacher-usd", 0, { min: 0 });
  const storagePerSubmissionUsd = numberOption(values, "storage-per-submission-usd", 0, {
    min: 0,
  });
  const fixedMonthlyBurnUsd = numberOption(values, "fixed-monthly-burn-usd", 0, { min: 0 });
  const deterministicRate = numberOption(values, "deterministic-rate", 0, { min: 0, max: 1 });
  const audioSubmissionRate = numberOption(values, "audio-submission-rate", 1, {
    min: 0,
    max: 1,
  });
  const teacherScales = parseTeacherScales(values.teachers);

  const scenarios: Scenario[] = [
    {
      name: "expected",
      cacheHitRate: numberOption(values, "expected-cache-hit-rate", 0.15, { min: 0, max: 1 }),
      retryRate: numberOption(values, "expected-retry-rate", 0.02, { min: 0, max: 1 }),
      escalationRate: numberOption(values, "expected-escalation-rate", 0.05, { min: 0, max: 1 }),
      costMultiplier: numberOption(values, "expected-cost-multiplier", 1, { min: 0 }),
    },
    {
      name: "conservative",
      cacheHitRate: numberOption(values, "conservative-cache-hit-rate", 0.05, {
        min: 0,
        max: 1,
      }),
      retryRate: numberOption(values, "conservative-retry-rate", 0.05, { min: 0, max: 1 }),
      escalationRate: numberOption(values, "conservative-escalation-rate", 0.1, {
        min: 0,
        max: 1,
      }),
      costMultiplier: numberOption(values, "conservative-cost-multiplier", 1.25, { min: 0 }),
    },
    {
      name: "worst-case",
      cacheHitRate: numberOption(values, "worst-cache-hit-rate", 0, { min: 0, max: 1 }),
      retryRate: numberOption(values, "worst-retry-rate", 0.1, { min: 0, max: 1 }),
      escalationRate: numberOption(values, "worst-escalation-rate", 0.1, { min: 0, max: 1 }),
      costMultiplier: numberOption(values, "worst-cost-multiplier", 1.75, { min: 0 }),
    },
  ];

  const warnings: string[] = [];
  if (cheapRequestCostUsd === 0 && escalationRequestCostUsd === 0) {
    warnings.push(
      benchmarkPath
        ? "Grading-model cost is zero; the selected benchmark is probably mock-only and is not a paid cost measurement."
        : "Grading-model cost is zero because no paid benchmark or explicit request costs were supplied."
    );
  }
  if (audioSubmissionRate > 0 && transcriptionCostPerSubmissionUsd === 0) {
    warnings.push(
      "Audio submissions are enabled but transcription cost is zero; this is not a full Habla product-cost estimate."
    );
  }
  if (paymentPercent === 0 && paymentFixedPerTeacherUsd === 0) {
    warnings.push("Payment-processing cost is zero; pass explicit processor assumptions for planning.");
  }
  if (hostingPerTeacherUsd === 0 && storagePerSubmissionUsd === 0) {
    warnings.push("Hosting and storage are zero; pass explicit infrastructure assumptions for planning.");
  }

  return {
    generatedAt: new Date().toISOString(),
    assumptions: {
      monthlyPricePerTeacherUsd: pricePerTeacherUsd,
      submissionsPerTeacher,
      measuredCheapRequestCostUsd: cheapRequestCostUsd,
      measuredEscalationRequestCostUsd: escalationRequestCostUsd,
      transcriptionCostPerSubmissionUsd,
      paymentProcessingPercent: paymentPercent,
      paymentProcessingFixedPerTeacherUsd: paymentFixedPerTeacherUsd,
      hostingPerTeacherUsd,
      storagePerSubmissionUsd,
      fixedMonthlyBurnUsd,
      deterministicRate,
      audioSubmissionRate,
      teacherScales,
      modelSource: benchmark.source,
    },
    scenarios: scenarios.map((scenario) => ({
      ...scenario,
      rows: buildScenarioRows({
        scenario,
        teacherScales,
        pricePerTeacherUsd,
        submissionsPerTeacher,
        cheapRequestCostUsd,
        escalationRequestCostUsd,
        transcriptionCostPerSubmissionUsd,
        paymentPercent,
        paymentFixedPerTeacherUsd,
        hostingPerTeacherUsd,
        storagePerSubmissionUsd,
        fixedMonthlyBurnUsd,
        deterministicRate,
        audioSubmissionRate,
      }),
    })),
    warnings,
  };
}

function money(value: number) {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 1 ? 6 : 2,
  })}`;
}

function printReport(report: ProfitReport) {
  console.log("AI grading profit report");
  console.log(
    `Price ${money(report.assumptions.monthlyPricePerTeacherUsd)}/teacher; ${report.assumptions.submissionsPerTeacher.toLocaleString()} submissions/teacher/month`
  );
  console.log(
    `Measured request costs: cheap=${money(report.assumptions.measuredCheapRequestCostUsd)}, escalation=${money(report.assumptions.measuredEscalationRequestCostUsd)}, transcription/submission=${money(report.assumptions.transcriptionCostPerSubmissionUsd)}`
  );
  for (const scenario of report.scenarios) {
    console.log(
      `\n${scenario.name}: cache ${(scenario.cacheHitRate * 100).toFixed(1)}%, retry ${(scenario.retryRate * 100).toFixed(1)}%, escalation ${(scenario.escalationRate * 100).toFixed(1)}%, cost multiplier ${scenario.costMultiplier.toFixed(2)}x`
    );
    console.table(
      scenario.rows.map((row) => ({
        teachers: row.teachers,
        revenue: money(row.revenueUsd),
        ai_api: money(row.totalAiApiCostUsd),
        ai_per_submission: money(row.aiCostPerSubmissionUsd),
        ai_per_teacher: money(row.aiCostPerTeacherUsd),
        payment: money(row.paymentProcessingCostUsd),
        hosting_storage: money(row.hostingAndStorageCostUsd),
        gross_per_teacher: money(row.grossContributionPerTeacherUsd),
        gross_total: money(row.totalGrossContributionUsd),
        net_after_fixed_burn: money(row.netAfterFixedBurnUsd),
        margin: `${(row.contributionMargin * 100).toFixed(2)}%`,
        break_even_teachers: row.breakEvenTeachers ?? "never",
        status: row.costStatus,
      }))
    );
  }
  for (const warning of report.warnings) console.warn(`WARNING: ${warning}`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      benchmark: { type: "string" },
      model: { type: "string" },
      output: { type: "string" },
      teachers: { type: "string" },
      "price-per-teacher-usd": { type: "string" },
      "submissions-per-teacher": { type: "string" },
      "cheap-cost-usd": { type: "string" },
      "escalation-cost-usd": { type: "string" },
      "transcription-cost-per-submission-usd": { type: "string" },
      "transcription-per-minute-usd": { type: "string" },
      "average-audio-minutes": { type: "string" },
      "payment-percent": { type: "string" },
      "payment-fixed-usd": { type: "string" },
      "hosting-per-teacher-usd": { type: "string" },
      "storage-per-submission-usd": { type: "string" },
      "fixed-monthly-burn-usd": { type: "string" },
      "deterministic-rate": { type: "string" },
      "audio-submission-rate": { type: "string" },
      "expected-cache-hit-rate": { type: "string" },
      "expected-retry-rate": { type: "string" },
      "expected-escalation-rate": { type: "string" },
      "expected-cost-multiplier": { type: "string" },
      "conservative-cache-hit-rate": { type: "string" },
      "conservative-retry-rate": { type: "string" },
      "conservative-escalation-rate": { type: "string" },
      "conservative-cost-multiplier": { type: "string" },
      "worst-cache-hit-rate": { type: "string" },
      "worst-retry-rate": { type: "string" },
      "worst-escalation-rate": { type: "string" },
      "worst-cost-multiplier": { type: "string" },
    },
    strict: true,
  });
  const report = generateProfitReport(values);
  printReport(report);
  if (typeof values.output === "string") {
    const outputPath = path.resolve(values.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "w" });
    console.log(`\nWrote ${outputPath}`);
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entryPoint) {
  main().catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
