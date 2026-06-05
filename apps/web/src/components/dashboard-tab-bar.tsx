interface TabConfig {
  readonly key: string;
  readonly label: string;
  readonly disabled?: boolean;
}

interface DashboardTabBarProps {
  readonly tabs: readonly TabConfig[];
  readonly activeKey: string;
  readonly onChange: (key: string) => void;
}

export function DashboardTabBar({ tabs, activeKey, onChange }: DashboardTabBarProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] p-1">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => !tab.disabled && onChange(tab.key)}
          disabled={tab.disabled}
          className={`rounded-md px-4 py-1.5 text-xs font-medium transition-all duration-200 ${
            activeKey === tab.key
              ? 'bg-[var(--accent-blue)] text-white shadow-sm'
              : tab.disabled
              ? 'cursor-not-allowed text-[var(--text-muted)] opacity-40'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
