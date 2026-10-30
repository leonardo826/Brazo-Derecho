export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <div className="muted">{children}</div>
    </div>
  );
}
