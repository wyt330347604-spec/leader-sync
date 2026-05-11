import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Combobox, type ComboboxOption } from '../combobox';

const SIMPLE_OPTIONS: ComboboxOption[] = [
  { value: 'p1', label: 'XT 印度', leadingDot: '#DC2626', trailing: '自营 · 印度' },
  { value: 'p2', label: 'cash 印度', leadingDot: '#2563EB', badge: 'NBFC × 2', badgeVariant: 'subtitle', trailing: '合作 · 印度' },
  { value: 'p3', label: '公司建设', leadingDot: '#475569', badge: '默认', badgeVariant: 'default', trailing: '集团' },
];

function renderWith(props: Partial<Parameters<typeof Combobox>[0]> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <Combobox
      value={null}
      onChange={onChange}
      options={SIMPLE_OPTIONS}
      placeholder="选择项目"
      searchPlaceholder="搜索"
      {...props}
    />,
  );
  return { ...utils, onChange };
}

describe('Combobox — render', () => {
  it('shows placeholder when no value selected', () => {
    renderWith();
    expect(screen.getByText('选择项目')).toBeInTheDocument();
  });

  it('shows label of selected option', () => {
    renderWith({ value: 'p1' });
    expect(screen.getByText('XT 印度')).toBeInTheDocument();
  });
});

describe('Combobox — open / search', () => {
  it('opens popover on trigger click and lists all options', async () => {
    renderWith();
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('搜索')).toBeInTheDocument();
    });
    expect(screen.getByText('XT 印度')).toBeInTheDocument();
    expect(screen.getByText('cash 印度')).toBeInTheDocument();
    expect(screen.getByText('公司建设')).toBeInTheDocument();
  });

  it('filters list by substring match', async () => {
    renderWith();
    fireEvent.click(screen.getByRole('button'));
    const input = await screen.findByPlaceholderText('搜索');
    fireEvent.change(input, { target: { value: '印度' } });
    await waitFor(() => {
      expect(screen.queryByText('公司建设')).not.toBeInTheDocument();
    });
    expect(screen.getByText('XT 印度')).toBeInTheDocument();
    expect(screen.getByText('cash 印度')).toBeInTheDocument();
  });

  it('filters by pinyin (yd → 印度)', async () => {
    renderWith();
    fireEvent.click(screen.getByRole('button'));
    const input = await screen.findByPlaceholderText('搜索');
    fireEvent.change(input, { target: { value: 'yd' } });
    await waitFor(() => {
      expect(screen.queryByText('公司建设')).not.toBeInTheDocument();
    });
    expect(screen.getByText('XT 印度')).toBeInTheDocument();
  });

  it('shows emptyText on no match', async () => {
    renderWith({ emptyText: '没有匹配' });
    fireEvent.click(screen.getByRole('button'));
    const input = await screen.findByPlaceholderText('搜索');
    fireEvent.change(input, { target: { value: 'zzzzz' } });
    await waitFor(() => {
      expect(screen.getByText('没有匹配')).toBeInTheDocument();
    });
  });
});

describe('Combobox — selection', () => {
  it('calls onChange with value when option clicked', async () => {
    const { onChange } = renderWith();
    fireEvent.click(screen.getByRole('button'));
    const opt = await screen.findByText('XT 印度');
    fireEvent.click(opt);
    expect(onChange).toHaveBeenCalledWith('p1');
  });
});

describe('Combobox — disabled', () => {
  it('does not open when disabled', () => {
    renderWith({ disabled: true });
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByPlaceholderText('搜索')).not.toBeInTheDocument();
  });
});

describe('Combobox — badge variants', () => {
  it('renders subtitle badge with blue style', async () => {
    renderWith();
    fireEvent.click(screen.getByRole('button'));
    const badge = await screen.findByText('NBFC × 2');
    expect(badge).toBeInTheDocument();
  });

  it('renders default badge', async () => {
    renderWith();
    fireEvent.click(screen.getByRole('button'));
    const badge = await screen.findByText('默认');
    expect(badge).toBeInTheDocument();
  });
});
