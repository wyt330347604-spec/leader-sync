import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import ProjectsPage from '../page';

vi.mock('@/lib/api-client', () => ({
  apiFetch: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  ensureAuth: vi.fn(async () => true),
}));

import { apiFetch } from '@/lib/api-client';

const MOCK_PROJECTS = [
  { id: 1, projectUid: 'p1', name: '公司建设', isDefault: true,  createdAt: '2026-01-01', category: 'jt', ownerName: null,   region: null,   subtitle: null },
  { id: 2, projectUid: 'p2', name: 'XT 印度',  isDefault: false, createdAt: '2026-01-02', category: 'zy', ownerName: 'Mia', region: '印度', subtitle: null },
  { id: 3, projectUid: 'p3', name: 'XT 巴基',  isDefault: false, createdAt: '2026-01-03', category: 'zy', ownerName: null,   region: '巴基斯坦', subtitle: null },
  { id: 4, projectUid: 'p4', name: 'cash 印度', isDefault: false, createdAt: '2026-01-04', category: 'hz', ownerName: 'Harvey', region: '印度', subtitle: 'NBFC × 2' },
];

function renderWithSWR(ui: React.ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {ui}
    </SWRConfig>,
  );
}

describe('ProjectsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.startsWith('/api/v1/projects/permissions')) return Promise.resolve({ canManage: true });
      if (url === '/api/v1/projects') return Promise.resolve(MOCK_PROJECTS);
      return Promise.resolve(null);
    });
  });

  it('renders the page header with computed stats', async () => {
    renderWithSWR(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText(/项目架构总览/)).toBeInTheDocument());
    expect(screen.getByText(/4 个项目/)).toBeInTheDocument();
    expect(screen.getByText(/位负责人/)).toBeInTheDocument();
  });

  it('groups projects by category in fixed order', async () => {
    renderWithSWR(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText('XT 印度')).toBeInTheDocument());
    // 集团 label should appear before 自营 label in DOM order
    const all = document.body.innerHTML;
    const jtIdx = all.indexOf('集团');
    const zyIdx = all.indexOf('自营');
    expect(jtIdx).toBeGreaterThan(-1);
    expect(zyIdx).toBeGreaterThan(-1);
    expect(jtIdx).toBeLessThan(zyIdx);
  });

  it('renders vacant owner state', async () => {
    renderWithSWR(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText('XT 巴基')).toBeInTheDocument());
    expect(screen.getAllByText('空缺').length).toBeGreaterThan(0);
  });

  it('renders subtitle tag (NBFC × 2)', async () => {
    renderWithSWR(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText('cash 印度')).toBeInTheDocument());
    expect(screen.getByText('NBFC × 2')).toBeInTheDocument();
  });

  it('renders region tag', async () => {
    renderWithSWR(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText('XT 印度')).toBeInTheDocument());
    expect(screen.getAllByText('印度').length).toBeGreaterThan(0);
  });

  it('shows 新建项目 button when canManage=true', async () => {
    renderWithSWR(<ProjectsPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '新建项目' })).toBeInTheDocument());
  });

  it('hides admin actions when canManage=false', async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.startsWith('/api/v1/projects/permissions')) return Promise.resolve({ canManage: false });
      if (url === '/api/v1/projects') return Promise.resolve(MOCK_PROJECTS);
      return Promise.resolve(null);
    });
    renderWithSWR(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText(/项目架构总览/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '新建项目' })).not.toBeInTheDocument();
  });
});
