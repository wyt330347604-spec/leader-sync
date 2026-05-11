'use client';
import * as React from 'react';
import { Command } from 'cmdk';
import TinyPinyin from 'tiny-pinyin';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface ComboboxOption {
  value: string;
  label: string;
  searchText?: string;
  leadingDot?: string;
  badge?: string;
  badgeVariant?: 'subtitle' | 'default';
  trailing?: string;
}

export interface ComboboxProps {
  value: string | null;
  onChange: (value: string | null) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  allowClear?: boolean;
  align?: 'start' | 'center' | 'end';
}

function toPinyinFull(s: string): string {
  try {
    return TinyPinyin.convertToPinyin(s, '', true).toLowerCase();
  } catch {
    return s.toLowerCase();
  }
}

function toPinyinInitials(s: string): string {
  try {
    const parsed = TinyPinyin.parse(s);
    return parsed
      .map((token: { target: string }) => (token.target ? token.target[0].toLowerCase() : ''))
      .join('');
  } catch {
    return '';
  }
}

function matchOption(option: ComboboxOption, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const haystack = [option.label, option.searchText ?? '', option.badge ?? '', option.trailing ?? '']
    .join(' ')
    .toLowerCase();
  if (haystack.includes(q)) return true;
  const searchSrc = option.label + (option.searchText ?? '');
  const pinyinFull = toPinyinFull(searchSrc);
  if (pinyinFull.includes(q)) return true;
  const pinyinInitials = toPinyinInitials(searchSrc);
  return pinyinInitials.includes(q);
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder = '选择…',
  searchPlaceholder = '搜索…',
  emptyText = '无匹配项',
  disabled = false,
  className = '',
  allowClear = false,
  align = 'start',
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const byValue = React.useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const selected = value ? byValue.get(value) : null;

  const filter = React.useCallback(
    (val: string, search: string) => (matchOption(byValue.get(val)!, search) ? 1 : 0),
    [byValue],
  );

  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={`flex w-full items-center justify-between rounded-xl bg-[var(--bg-surface)] border px-4 py-3 text-sm transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]/40 ${
            open ? 'border-[var(--accent-blue)]/50' : 'border-[var(--border)]'
          } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${className}`}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {selected ? (
              <>
                {selected.leadingDot && (
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: selected.leadingDot }}
                  />
                )}
                <span className="truncate text-[var(--text-primary)]">{selected.label}</span>
              </>
            ) : (
              <span className="text-[var(--text-muted)]">{placeholder}</span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[var(--text-muted)]">
            {allowClear && selected && !disabled && (
              <span
                role="button"
                aria-label="清空选择"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                }}
                className="rounded p-0.5 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <ClearIcon />
              </span>
            )}
            <ChevronDownIcon />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] p-0 bg-[var(--bg-card)] border-[var(--border)]"
      >
        <Command filter={filter} className="overflow-hidden rounded-lg">
          <div className="border-b border-[var(--border)] px-3">
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder={searchPlaceholder}
              className="h-10 w-full bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
          </div>
          <Command.List className="max-h-[320px] overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">
              {emptyText}
            </Command.Empty>
            {options.map((opt) => (
              <Command.Item
                key={opt.value}
                value={opt.value}
                onSelect={(val) => {
                  onChange(val);
                  setOpen(false);
                }}
                className="flex cursor-pointer items-center justify-between rounded-md px-2 py-2 text-sm text-[var(--text-primary)] aria-selected:bg-[var(--accent-blue)]/10 hover:bg-[var(--bg-hover)]"
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  {opt.leadingDot && (
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: opt.leadingDot }}
                    />
                  )}
                  <span className="truncate">{opt.label}</span>
                  {opt.badge && (
                    <span
                      className={
                        opt.badgeVariant === 'subtitle'
                          ? 'shrink-0 rounded-md bg-[#2563eb] px-1.5 py-0.5 text-[11px] font-semibold text-white'
                          : 'shrink-0 rounded-full border border-[#3b82f6]/20 bg-[#3b82f6]/10 px-2 py-0.5 text-[10px] text-[#3b82f6]'
                      }
                    >
                      {opt.badge}
                    </span>
                  )}
                </span>
                {opt.trailing && (
                  <span className="ml-2 shrink-0 text-[11px] text-[var(--text-muted)]">{opt.trailing}</span>
                )}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
