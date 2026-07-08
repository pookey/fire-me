export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[0.65rem] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>{label}</label>
      {children}
    </div>
  );
}

export function ConfigSection({ title, isOpen, onToggle, children }: { title: string; isOpen: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left"
        style={{ color: 'var(--text-primary)' }}
      >
        <span className="font-display text-sm font-semibold">{title}</span>
        <span className="text-xs transition-transform" style={{ color: 'var(--text-muted)', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          ▼
        </span>
      </button>
      {isOpen && (
        <div className="px-5 pb-5 space-y-3">
          {children}
        </div>
      )}
    </div>
  );
}
