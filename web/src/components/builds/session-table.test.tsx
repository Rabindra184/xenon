import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionTable } from './session-table';
import type { ISession } from '../../interfaces/ISession';

const sessions = Array.from(
  { length: 3 },
  (_, i) =>
    ({
      id: `s-${i}`,
      name: `Test ${i}`,
      status: 'success',
      desired_capabilities: '{}',
      session_capabilities: '{}',
      startTime: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      device_platform: 'android',
    }) as unknown as ISession,
);

const table = (over: Partial<React.ComponentProps<typeof SessionTable>> = {}) =>
  render(
    <SessionTable
      sessions={sessions}
      statusFilter="all"
      searchQuery=""
      buildNames={new Map()}
      showBuild
      showSelection={false}
      selectedIds={new Set()}
      onToggleSelect={() => {}}
      onToggleSelectAll={() => {}}
      onOpenRow={() => {}}
      empty={null}
      hasMore={false}
      loadingMore={false}
      onShowMore={() => {}}
      total={null}
      {...over}
    />,
  );

describe('SessionTable paging', () => {
  it('says how many are loaded of how many, and loads the next page', () => {
    const onShowMore = vi.fn();
    table({ hasMore: true, total: 2340, onShowMore });
    expect(screen.getByText('Showing the newest 3 of 2,340 sessions')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show 200 more' }));
    expect(onShowMore).toHaveBeenCalledOnce();
  });

  it('shows the loaded count alone before the total is known', () => {
    table({ hasMore: true, total: null });
    expect(screen.getByText('Showing the newest 3 sessions')).toBeInTheDocument();
  });

  it('says it is loading, and takes no second click meanwhile', () => {
    const onShowMore = vi.fn();
    table({ hasMore: true, loadingMore: true, onShowMore });
    const button = screen.getByRole('button', { name: 'Loading…' });
    expect(button).toBeDisabled();
  });

  it('offers nothing more once every session is loaded', () => {
    table({ hasMore: false, total: 3 });
    expect(screen.queryByText(/Show .* more/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Showing the newest/)).not.toBeInTheDocument();
  });
});
