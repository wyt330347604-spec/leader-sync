import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DashboardTabBar } from '../dashboard-tab-bar';

const TABS = [
  { key: 'boss', label: 'Boss 全员概览' },
  { key: 'leader', label: '我的团队' },
  { key: 'me', label: '我的完成情况' },
];

describe('DashboardTabBar', () => {
  it('renders all tab labels', () => {
    render(<DashboardTabBar tabs={TABS} activeKey="me" onChange={() => {}} />);
    expect(screen.getByText('Boss 全员概览')).toBeInTheDocument();
    expect(screen.getByText('我的团队')).toBeInTheDocument();
    expect(screen.getByText('我的完成情况')).toBeInTheDocument();
  });

  it('highlights the active tab', () => {
    render(<DashboardTabBar tabs={TABS} activeKey="me" onChange={() => {}} />);
    const activeBtn = screen.getByText('我的完成情况');
    expect(activeBtn.className).toContain('bg-[var(--accent-blue)]');
    expect(activeBtn.className).toContain('text-white');
  });

  it('calls onChange when a tab is clicked', () => {
    const onChange = vi.fn();
    render(<DashboardTabBar tabs={TABS} activeKey="me" onChange={onChange} />);
    fireEvent.click(screen.getByText('Boss 全员概览'));
    expect(onChange).toHaveBeenCalledWith('boss');
  });

  it('does not call onChange for disabled tab', () => {
    const onChange = vi.fn();
    const tabsWithDisabled = [
      ...TABS,
      { key: 'disabled', label: '禁用', disabled: true },
    ];
    render(<DashboardTabBar tabs={tabsWithDisabled} activeKey="me" onChange={onChange} />);
    fireEvent.click(screen.getByText('禁用'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
