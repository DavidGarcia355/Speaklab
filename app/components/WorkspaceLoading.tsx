type WorkspaceLoadingProps = {
  compact?: boolean;
  label: string;
};

export default function WorkspaceLoading({ compact = false, label }: WorkspaceLoadingProps) {
  return (
    <section
      className={`workspace-loading-card${compact ? " is-compact" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="workspace-loading-signal" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="workspace-loading-copy">
        <span>TryHabla // getting set</span>
        <strong>{label}</strong>
      </span>
      <span className="workspace-loading-lines" aria-hidden="true">
        <span />
        <span />
      </span>
    </section>
  );
}
