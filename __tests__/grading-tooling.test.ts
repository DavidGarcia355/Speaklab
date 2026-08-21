import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertBenchmarkAuthorization,
  parseModelSpecs,
  readDataset,
  toPipelineInput,
} from "@/scripts/grading-benchmark";
import { generateProfitReport } from "@/scripts/grading-profit";
import { getGradingConfig } from "@/lib/grading/config";
import { runGradingPipeline } from "@/lib/grading/pipeline";

describe("grading evaluation tooling", () => {
  it("loads the synthetic JSONL with criterion labels and no student PII", () => {
    const dataset = readDataset(path.join(process.cwd(), "data", "grading-eval.synthetic.jsonl"));

    expect(dataset.rows).toHaveLength(18);
    expect(dataset.rows.every((row) => row.contains_pii === false)).toBe(true);
    expect(dataset.rows.some((row) => row.expected_prompt_injection)).toBe(true);
    expect(dataset.rows.some((row) => row.assignment_type === "numeric")).toBe(true);
    expect(dataset.rows.some((row) => row.assignment_type === "multiple_choice")).toBe(true);
    expect(
      dataset.rows.every(
        (row) =>
          row.teacher_rubric_results.reduce(
            (sum, criterion) => sum + criterion.points_awarded,
            0
          ) === row.teacher_score
      )
    ).toBe(true);
  });

  it("blocks paid providers without the explicit flag and always blocks PII", () => {
    const dataset = readDataset(path.join(process.cwd(), "data", "grading-eval.synthetic.jsonl"));
    const specs = parseModelSpecs({ models: "openai:gpt-5-nano" });

    expect(() =>
      assertBenchmarkAuthorization({ specs, rows: dataset.rows, allowPaid: false })
    ).toThrow(/--allow-paid/);
    expect(() =>
      assertBenchmarkAuthorization({
        specs,
        rows: [{ ...dataset.rows[0], contains_pii: true }],
        allowPaid: true,
      })
    ).toThrow(/PII/);
  });

  it("runs the synthetic input through the production pipeline with only the mock provider", async () => {
    const dataset = readDataset(path.join(process.cwd(), "data", "grading-eval.synthetic.jsonl"));
    const mockModel = { provider: "mock" as const, model: "mock-cheap" };
    const config = {
      ...getGradingConfig(),
      enabled: true,
      defaultModel: mockModel,
      escalationModel: mockModel,
    };

    const outcome = await runGradingPipeline(toPipelineInput(dataset.rows[0]), {
      config,
      bypassPersistence: true,
      forceAi: true,
      enhanced: false,
      mode: "evaluation",
    });

    expect(outcome.provider).toBe("mock");
    expect(outcome.cacheHit).toBe(false);
    expect(outcome.usage.inputTokens).toBeGreaterThan(0);
    expect(outcome.result.maximum_score).toBe(dataset.rows[0].maximum_score);
    expect(outcome.result.rubric_results).toHaveLength(
      dataset.rows[0].teacher_rubric_results.length
    );
  });

  it("keeps audio transcription separate in the profit calculation", () => {
    const report = generateProfitReport({
      "cheap-cost-usd": "0",
      "escalation-cost-usd": "0",
      "transcription-cost-per-submission-usd": "0.012",
      "payment-percent": "0.03",
      "payment-fixed-usd": "0.30",
      "hosting-per-teacher-usd": "1",
      "storage-per-submission-usd": "0.0001",
      "fixed-monthly-burn-usd": "5000",
    });
    const expected100 = report.scenarios.find((scenario) => scenario.name === "expected")!.rows[0];

    expect(expected100.teachers).toBe(100);
    expect(expected100.gradingApiCostUsd).toBe(0);
    expect(expected100.transcriptionApiCostUsd).toBe(2_284.8);
    expect(expected100.paymentProcessingCostUsd).toBe(177);
    expect(expected100.hostingAndStorageCostUsd).toBe(122.4);
    expect(expected100.aiCostPerTeacherUsd).toBe(22.848);
    expect(expected100.grossContributionPerTeacherUsd).toBe(23.16);
    expect(expected100.breakEvenTeachers).toBe(216);
    expect(expected100.costStatus).toBe("hard-review");
  });
});
