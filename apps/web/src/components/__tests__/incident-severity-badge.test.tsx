import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IncidentSeverityBadge } from '../incident-severity-badge';

describe('IncidentSeverityBadge', () => {
  it('renders P0 with red color class', () => {
    render(<IncidentSeverityBadge severity="P0" />);
    const badge = screen.getByText('P0');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('text-[var(--accent-red)]');
  });

  it('renders P1 with orange color class', () => {
    render(<IncidentSeverityBadge severity="P1" />);
    const badge = screen.getByText('P1');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('text-[#f97316]');
  });

  it('renders P2 with yellow color class', () => {
    render(<IncidentSeverityBadge severity="P2" />);
    const badge = screen.getByText('P2');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('text-[#eab308]');
  });

  it('renders P3 with blue color class', () => {
    render(<IncidentSeverityBadge severity="P3" />);
    const badge = screen.getByText('P3');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('text-[var(--accent-blue)]');
  });

  it('renders unknown severity with fallback gray style', () => {
    render(<IncidentSeverityBadge severity="P99" />);
    const badge = screen.getByText('P99');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('text-[var(--text-muted)]');
  });

  it('renders with rounded-full border styling', () => {
    render(<IncidentSeverityBadge severity="P0" />);
    const badge = screen.getByText('P0');
    expect(badge.className).toContain('rounded-full');
    expect(badge.className).toContain('border');
  });
});
