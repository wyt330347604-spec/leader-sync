import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MyMonthlySummaryCard } from '../my-monthly-summary-card';
import type { MyMonthlySummary } from '@/hooks/use-my-monthly';

const MOCK_DATA: MyMonthlySummary = {
  month: '2026-05',
  userId: 'ou_dev_harvey',
  userName: 'Harvey',
  total: 12,
  done: 9,
  inProgress: 2,
  overdue: 1,
  completionRate: 75,
  carriedOver: 1,
  delayTotal: 3,
};

describe('MyMonthlySummaryCard', () => {
  it('renders user name', () => {
    render(<MyMonthlySummaryCard data={MOCK_DATA} />);
    expect(screen.getByText('Harvey')).toBeInTheDocument();
  });

  it('renders total task count', () => {
    render(<MyMonthlySummaryCard data={MOCK_DATA} />);
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('renders done count', () => {
    render(<MyMonthlySummaryCard data={MOCK_DATA} />);
    expect(screen.getByText('9')).toBeInTheDocument();
  });

  it('renders completion rate', () => {
    render(<MyMonthlySummaryCard data={MOCK_DATA} />);
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('highlights overdue count in red when > 0', () => {
    render(<MyMonthlySummaryCard data={MOCK_DATA} />);
    const overdueValue = screen.getByText('1', { selector: '[class*="text-[var(--accent-red)]"]' });
    expect(overdueValue).toBeInTheDocument();
  });

  it('shows delay total when > 0', () => {
    render(<MyMonthlySummaryCard data={MOCK_DATA} />);
    expect(screen.getByText(/延期操作累计 3 次/)).toBeInTheDocument();
  });

  it('does not show delay text when delayTotal is 0', () => {
    const noDelay = { ...MOCK_DATA, delayTotal: 0 };
    render(<MyMonthlySummaryCard data={noDelay} />);
    expect(screen.queryByText(/延期操作累计/)).not.toBeInTheDocument();
  });
});
