"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

export type RubricCriterionDraft = {
  id: string;
  name: string;
  description: string;
  maxPoints: string;
};

type RubricTemplate = {
  id: string;
  name: string;
  title: string;
  criteria: RubricCriterionDraft[];
};

const RUBRIC_TEMPLATES_KEY = "habla.rubricTemplates";

function loadTemplates(): RubricTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RUBRIC_TEMPLATES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RubricTemplate[];
  } catch {
    return [];
  }
}

function saveTemplates(templates: RubricTemplate[]): void {
  try {
    window.localStorage.setItem(RUBRIC_TEMPLATES_KEY, JSON.stringify(templates));
  } catch {}
}

type Props = {
  enabled: boolean;
  title: string;
  criteria: RubricCriterionDraft[];
  totalPoints: number;
  onToggle: (enabled: boolean) => void;
  onTitleChange: (value: string) => void;
  onCriterionChange: (index: number, update: Partial<RubricCriterionDraft>) => void;
  onAddCriterion: () => void;
  onRemoveCriterion: (index: number) => void;
  onLoadTemplate?: (title: string, criteria: RubricCriterionDraft[]) => void;
};

export default function RubricBuilder({
  enabled,
  title,
  criteria,
  totalPoints,
  onToggle,
  onTitleChange,
  onCriterionChange,
  onAddCriterion,
  onRemoveCriterion,
  onLoadTemplate,
}: Props) {
  const templateSelectId = useId();
  const [templates, setTemplates] = useState<RubricTemplate[]>(() => loadTemplates());
  const [savedFeedback, setSavedFeedback] = useState(false);

  function handleSaveTemplate() {
    if (!title.trim() || criteria.length === 0) return;
    const name = title.trim();
    const template: RubricTemplate = {
      id: `tpl_${crypto.randomUUID()}`,
      name,
      title: name,
      criteria,
    };
    const updated = [...templates.filter((t) => t.name !== name), template];
    saveTemplates(updated);
    setTemplates(updated);
    setSavedFeedback(true);
    window.setTimeout(() => setSavedFeedback(false), 2000);
  }

  function handleLoadTemplate(templateId: string) {
    const template = templates.find((t) => t.id === templateId);
    if (!template || !onLoadTemplate) return;
    onLoadTemplate(
      template.title,
      template.criteria.map((c) => ({ ...c, id: `criterion_${crypto.randomUUID()}` }))
    );
  }

  return (
    <section className="section-gap">
      <div className="dense-row">
        <div>
          <label className="label" htmlFor="rubric-enabled">
            Add a grading rubric (optional)
          </label>
          <p className="meta">Use criteria-based scoring and auto-calculate the final total.</p>
        </div>
        <label className="pill pill-subtle" htmlFor="rubric-enabled" style={{ cursor: "pointer" }}>
          <input
            id="rubric-enabled"
            type="checkbox"
            checked={enabled}
            onChange={(event) => onToggle(event.target.checked)}
            style={{ marginRight: 8 }}
          />
          Enable rubric
        </label>
      </div>

      {enabled ? (
        <div className="section-gap">
          <label className="label form-label-top" htmlFor="rubric-title">
            Rubric title
          </label>
          <input
            id="rubric-title"
            className="input"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="Speaking rubric"
            maxLength={80}
          />
          <p className="meta field-meta">{title.length}/80</p>

          {onLoadTemplate ? (
            <div className="dense-row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
              {templates.length > 0 ? (
                <>
                  <label className="sr-only" htmlFor={templateSelectId}>
                    Load a saved rubric template
                  </label>
                  <div className="select-field">
                    <select
                      id={templateSelectId}
                      className="input select-input"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) handleLoadTemplate(e.target.value);
                      }}
                    >
                      <option value="" disabled>Load a saved rubric...</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <ChevronDown size={20} aria-hidden="true" />
                  </div>
                </>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleSaveTemplate}
                disabled={!title.trim() || criteria.length === 0}
              >
                {savedFeedback ? "Saved!" : "Save rubric as template"}
              </button>
            </div>
          ) : null}

          <div className="dense-row">
            <p className="label" style={{ marginBottom: 0 }}>
              Criteria
            </p>
            <span className="pill pill-subtle">Points possible: {totalPoints}</span>
          </div>

          <div className="grid section-gap">
            {criteria.map((criterion, index) => (
              <div key={criterion.id} className="card panel-subtle">
                <label className="label" htmlFor={`criterion-name-${criterion.id}`}>
                  Criterion name
                </label>
                <input
                  id={`criterion-name-${criterion.id}`}
                  className="input"
                  value={criterion.name}
                  onChange={(event) => onCriterionChange(index, { name: event.target.value })}
                  placeholder="Pronunciation"
                  maxLength={60}
                />
                <p className="meta field-meta">{criterion.name.length}/60</p>

                <label className="label form-label-top" htmlFor={`criterion-description-${criterion.id}`}>
                  Description (optional)
                </label>
                <input
                  id={`criterion-description-${criterion.id}`}
                  className="input"
                  value={criterion.description}
                  onChange={(event) => onCriterionChange(index, { description: event.target.value })}
                  placeholder="Clarity and accuracy of sounds"
                  maxLength={120}
                />
                <p className="meta field-meta">{criterion.description.length}/120</p>

                <label className="label form-label-top" htmlFor={`criterion-points-${criterion.id}`}>
                  Max points
                </label>
                <input
                  id={`criterion-points-${criterion.id}`}
                  className="input"
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  inputMode="numeric"
                  value={criterion.maxPoints}
                  onChange={(event) => onCriterionChange(index, { maxPoints: event.target.value })}
                />

                <div className="actions form-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => onRemoveCriterion(index)}
                    disabled={criteria.length <= 1}
                  >
                    Remove criterion
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="actions form-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onAddCriterion}
              disabled={criteria.length >= 8}
            >
              Add criterion
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
