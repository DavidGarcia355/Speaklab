"use client";

import { useMemo, useState } from "react";
import { TEACHER_AI_PRICE_BOOK } from "@/lib/teacher-ai-pricing";

type ClassroomInputs = {
  classCount: number;
  studentsPerClass: number;
  aiAssignmentsPerClass: number;
};

type PricingInputKey = keyof ClassroomInputs;

type PricingControl = {
  key: PricingInputKey;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  suffix: string;
};

const FREE_LIFETIME_REVIEWS = TEACHER_AI_PRICE_BOOK.freeAllowance.reviews;
const TEACHER_PERIOD_REVIEWS = TEACHER_AI_PRICE_BOOK.includedAiReviews;

const DEFAULT_INPUTS: ClassroomInputs = {
  classCount: 5,
  studentsPerClass: 30,
  aiAssignmentsPerClass: 2,
};

const CONTROLS: readonly PricingControl[] = [
  {
    key: "classCount",
    label: "Classes",
    hint: "How many classes will use AI transcription or grading?",
    min: 1,
    max: 12,
    step: 1,
    suffix: "classes",
  },
  {
    key: "studentsPerClass",
    label: "Students per class",
    hint: "Use the average roster size for these classes.",
    min: 1,
    max: 50,
    step: 1,
    suffix: "students",
  },
  {
    key: "aiAssignmentsPerClass",
    label: "AI-assisted assignments",
    hint: "How many assignments will each class transcribe or grade with AI in one Stripe billing period?",
    min: 1,
    max: 12,
    step: 1,
    suffix: "per class",
  },
] as const;

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function formatControlValue(control: PricingControl, value: number) {
  return `${number.format(value)} ${control.suffix}`;
}

function planRecommendation(projectedReviews: number) {
  if (projectedReviews <= FREE_LIFETIME_REVIEWS) {
    return {
      name: "Free",
      detail: "Your lifetime 30-recording allowance covers this example.",
    };
  }

  if (projectedReviews <= TEACHER_PERIOD_REVIEWS) {
    return {
      name: "Teacher",
      detail: "$20 per month covers this example within one Stripe billing period.",
    };
  }

  return {
    name: "TryHabla for Schools",
    detail: "This example exceeds the self-service Teacher allowance.",
  };
}

export default function PricingCalculator() {
  const [inputs, setInputs] = useState<ClassroomInputs>(DEFAULT_INPUTS);
  const estimate = useMemo(() => {
    const totalStudents = inputs.classCount * inputs.studentsPerClass;
    const classAssignmentRuns = inputs.classCount * inputs.aiAssignmentsPerClass;
    const projectedReviews = totalStudents * inputs.aiAssignmentsPerClass;

    return {
      totalStudents,
      classAssignmentRuns,
      projectedReviews,
      teacherReviewsRemaining: Math.max(0, TEACHER_PERIOD_REVIEWS - projectedReviews),
      teacherReviewsAbove: Math.max(0, projectedReviews - TEACHER_PERIOD_REVIEWS),
      recommendation: planRecommendation(projectedReviews),
    };
  }, [inputs]);

  function updateInput(key: PricingInputKey, value: number) {
    setInputs((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="pricing-calculator-shell">
      <div className="pricing-calculator-controls">
        <div className="pricing-calculator-intro">
          <p className="pill pill-subtle">Build your estimate</p>
          <h3>Match AI-assisted recordings to your classroom</h3>
          <p>
            Each student recording with a successfully delivered transcript uses one unit. Optional
            grading for that same submission is included. Adjust the controls to model one Stripe
            billing period.
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

      <aside className="pricing-estimate-card" aria-label="Estimated TryHabla plan fit">
        <div className="pricing-estimate-head">
          <span>Best fit for this example</span>
          <strong aria-live="polite" aria-atomic="true">
            {estimate.recommendation.name}
          </strong>
          <small>{estimate.recommendation.detail}</small>
        </div>

        <dl className="pricing-estimate-stats">
          <div>
            <dt>Students</dt>
            <dd>{number.format(estimate.totalStudents)}</dd>
          </div>
          <div>
            <dt>Class-assignment runs</dt>
            <dd>{number.format(estimate.classAssignmentRuns)}</dd>
          </div>
          <div>
            <dt>AI-assisted recordings needed</dt>
            <dd>{number.format(estimate.projectedReviews)}</dd>
          </div>
          <div>
            <dt>
              {estimate.teacherReviewsAbove > 0
                ? "Above Teacher allowance"
                : "Teacher units remaining"}
            </dt>
            <dd>
              {number.format(
                estimate.teacherReviewsAbove > 0
                  ? estimate.teacherReviewsAbove
                  : estimate.teacherReviewsRemaining,
              )}
            </dd>
          </div>
        </dl>

        <div className="pricing-receipt" aria-label="TryHabla plan allowances">
          <div>
            <span>Free</span>
            <span>30 lifetime recordings</span>
          </div>
          <div>
            <span>Teacher</span>
            <span>300 recordings / $20 month</span>
          </div>
          <div>
            <span>TryHabla for Schools</span>
            <span>Contact us</span>
          </div>
          <div className="pricing-receipt-total">
            <span>Your estimate</span>
            <span>{number.format(estimate.projectedReviews)} recordings</span>
          </div>
        </div>

        <p className="pricing-estimate-note">
          Need more AI-assisted recordings? Explore TryHabla for Schools.
        </p>
        <p className="pricing-estimate-fineprint">
          This estimate assumes one submission from every student for each selected assignment.
          Provider failures, empty or unusable transcripts, and exact retries do not use another
          unit. Optional grading after transcription uses no additional unit. Unused Teacher units
          do not roll over, and there are no automatic overages.
        </p>
      </aside>
    </div>
  );
}

export { DEFAULT_INPUTS };
