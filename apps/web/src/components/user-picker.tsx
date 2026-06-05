'use client';
import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api-client';

interface UserSearchResult {
  readonly userId: string;
  readonly userName: string;
  readonly deptName: string | null;
}

interface Props {
  value: { userId: string; userName: string } | null;
  onChange: (v: { userId: string; userName: string } | null) => void;
  placeholder?: string;
}

/** 用户搜索选择器（防抖搜 /users/search）。已选则显示 chip + 清除。 */
export function UserPicker({ value, onChange, placeholder = '搜索用户' }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly UserSearchResult[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (query.length < 1) { setResults([]); return; }
    const id = setTimeout(() => {
      apiFetch<UserSearchResult[]>(`/api/v1/users/search?q=${encodeURIComponent(query)}`)
        .then((r) => setResults(r))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm">
        <span className="text-[var(--text-primary)]">👤 {value.userName}</span>
        <button
          type="button"
          onClick={() => { onChange(null); setQuery(''); }}
          className="ml-auto text-xs text-[var(--text-muted)] hover:text-[var(--accent-red)]"
        >
          清除
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="w-full rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--accent-blue)]"
      />
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-xl">
          {results.map((u) => (
            <button
              key={u.userId}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange({ userId: u.userId, userName: u.userName }); setQuery(''); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--bg-hover)]"
            >
              <span className="text-[var(--text-primary)]">{u.userName}</span>
              {u.deptName && <span className="text-xs text-[var(--text-muted)]">{u.deptName}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
