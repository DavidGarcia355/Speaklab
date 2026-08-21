"use client";

import { useMemo, useState } from "react";
import {
  estimateTeacherAiPricing,
  type TeacherAiPricingInputs,
} from "@/lib/teacher-ai-pricing";

type PricingInputKey = keyof TeacherAiPricingInputs;

type PricingControl = {
  key: PricingInputKey;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  suffix?: string;
};

const DEFAULT_INPUTS: TeacherAiPricingInputs = {
  classCount: 5,
  studentsPerClass: 28,
  aiAssignmentsPerClass: 4,
  submissionsPerStudent: 1,
  averageAudioMinutes: 2,
  outputTokensPerGrade: 300,
};

const CONTROLS: readonly PricingControl[] = [
  {
    key: "classCount",
    label: "Active classes",
    hint: "Classes with a roster and at least one real assignment.",
    min: 1,
    max: 30,
    step: 1,
  },
  {
    key: "studentsPerClass",
    label: "Average roster size",
    hint: "Use the average number of students in each class.",
    min: 1,
    max: 100,
    step: 1,
    suffix: "students",
  },
  {
    key: "aiAssignmentsPerClass",
    label: "AI-graded assignments",
    hint: "How many assignments per class will use AI each month?",
    min: 0,
    max: 30,
    step: 1,
    suffix: "/ month",
  },
  {
    key: "submissionsPerStudent",
    label: "Submissions per assignment",
    hint: "Use more than one only when AI should review resubmissions.",
    min: 1,
    max: 3,
    step: 1,
  },
  {
    key: "averageAudioMinutes",
    label: "Average recording length",
    hint: "Audio is metered by duration, never by file size.",
    min: 0.5,
    max: 10,
    step: 0.5,
    suffix: "minutes",
  },
  {
    key: "outputTokensPerGrade",
    label: "Expected feedback output",
    hint: "Estimate the final selected response size. Internal retries are not customer usage.",
    min: 100,
    max: 2_000,
    step: 100,
    suffix: "tokens",
  },
] as const;

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function formatControlValue(control: PricingControl, value: number) {
  return control.suffix ? `${number.format(value)} ${control.suffix}` : number.format(value);
}

export default function PricingCalculator() {
  const [inputs, setInputs] = useState<TeacherAiPricingInputs>(DEFAULT_INPUTS);
  const estimate = useMemo(() => estimateTeacherAiPricing(inputs), [inputs]);

  function updateInput(key: PricingInputKey, value: number) {
    setInputs((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="pricing-calculator-shell">
      <div className="pricing-calculator-controls">
        <div className="pricing-calculator-intro">
          <p className="pill pill-subtle">Build your estimate</p>
          <h3>Match AI to your classroom</h3>
          <p>
            Core Habla stays free. These controls estimate the optional AI work you choose to run.
          </p>
        </div>

        <div className="pricing-control-grid">
          {CONTROLS.map((control) => {
            const inputId = `pricing-${control.key}`;
            const hintId = `${inputId}-hint`;
            const value = inputs[control.key];

            return (
              <div className="pricing-control" key={control.key}>
                <div className="pricing-control-heading">
                  <label htmlFor={inputId}>{control.label}</label>
                  <output htmlFor={inputId}>{formatControlValue(control, value)}</output>
                </div>
                <input
                  id={inputId}
                  type="range"
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={value}
                  aria-describedby={hintId}
                  onChange={(event) => updateInput(control.key, Number(event.currentTarget.value))}
                />
                <p id={hintId}>{control.hint}</p>
              </div>
            );
          })}
        </div>
      </div>

      <aside className="pricing-estimate-card" aria-label="Estimated monthly AI price">
        <div className="pricing-estimate-head">
          <span>Your AI estimate</span>
          <strong aria-live="polite" aria-atomic="true">
            {usd.format(estimate.estimatedMonthlyUsd)}
          </strong>
          <small>estimated per month</small>
        </div>

        <dl className="pricing-estimate-stats">
          <div>
            <dt>Students</dt>
            <dd>{number.format(estimate.totalStudents)}</dd>
          </div>
          <div>
            <dt>AI grades</dt>
            <dd>{number.format(estimate.projectedAiGrades)}</dd>
          </div>
          <div>
            <dt>Free each month</dt>
            <dd>{number.format(estimate.appliedFreeAiGrades)}</dd>
          </div>
          <div>
            <dt>Billable grades</dt>
            <dd>{number.format(estimate.billableAiGrades)}</dd>
          </div>
        </dl>

        <div className="pricing-receipt" aria-label="AI estimate details">
          <div>
            <span>Successful AI grades</span>
            <span>{usd.format(estimate.baseChargeUsd)}</span>
          </div>
          <div>
            <span>{number.format(estimate.billableAudioMinutes)} audio minutes</span>
            <span>{usd.format(estimate.audioChargeUsd)}</span>
          </div>
          <div>
            <span>{number.format(estimate.billableOutputTokens)} feedback tokens</span>
            <span>{usd.format(estimate.outputChargeUsd)}</span>
          </div>
          <div className="pricing-receipt-total">
            <span>Estimated total</span>
            <span>{usd.format(estimate.estimatedMonthlyUsd)}</span>
          </div>
        </div>

        <p className="pricing-estimate-note">
          {estimate.monthlyFreeAiGrades === 0
            ? "Your first active class keeps Habla free; add another active class to unlock a monthly AI credit."
            : `${number.format(estimate.monthlyFreeAiGrades)} monthly AI ${
                estimate.monthlyFreeAiGrades === 1 ? "credit" : "credits"
              } included — one fewer than your active class count.`}
        </p>
        <p className="pricing-estimate-fineprint">
          This is an estimate, not a bill. Actual audio is measured by whole seconds and actual final
          feedback tokens; failures, compatible cache hits, and Habla&apos;s internal retries are not charged again.
        </p>
      </aside>
    </div>
  );
}

export { DEFAULT_INPUTS };
