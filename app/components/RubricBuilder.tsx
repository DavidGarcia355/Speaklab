"use client";

export type RubricCriterionDraft = {
  id: string;
  name: string;
  description: string;
  maxPoints: string;
};

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
}: Props) {
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
