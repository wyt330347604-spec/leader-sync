'use client';

import { useState } from 'react';
import { CalendarIcon } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface DatePickerProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly minDate?: Date;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly className?: string;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function DatePicker({
  value,
  onChange,
  minDate,
  placeholder = '选择日期',
  disabled,
  id,
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(value) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'w-full justify-start text-left font-normal h-auto rounded-xl border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-sm hover:bg-[var(--bg-hover)]',
            !selected && 'text-[var(--text-muted)]',
            className,
          )}
        >
          <CalendarIcon className="mr-2 size-4 opacity-70" />
          {selected ? format(selected, 'yyyy 年 M 月 d 日', { locale: zhCN }) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            if (d) {
              onChange(toIsoDate(d));
              setOpen(false);
            }
          }}
          disabled={minDate ? { before: minDate } : undefined}
          locale={zhCN}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
