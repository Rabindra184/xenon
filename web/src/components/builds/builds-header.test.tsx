import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BuildsHeader } from './builds-header';

const build = {
  id: 'a70ac97a-0000-0000-0000-000000000000',
  name: 'Nightly smoke',
  createdAt: new Date(2026, 8, 29, 7, 30).toISOString(),
  updatedAt: new Date(2026, 8, 29, 7, 30).toISOString(),
  sessionCount: 9,
  passedCount: 7,
  failedCount: 2,
  runningCount: 0,
};

const header = (failedToCopy: number, onCopyFailed = vi.fn()) => {
  render(
    <BuildsHeader
      build={build}
      failedToCopy={failedToCopy}
      onCopyFailed={onCopyFailed}
      onExport={() => {}}
    />,
  );
  return { onCopyFailed };
};

describe('BuildsHeader', () => {
  // The server can't re-run a client's tests: no "Retry failed" that does nothing.
  it('offers to copy the failed tests, not to retry them', () => {
    const { onCopyFailed } = header(2);
    expect(screen.queryByText('Retry failed')).not.toBeInTheDocument();
    const copy = screen.getByText('Copy failed tests').closest('button') as HTMLButtonElement;
    expect(copy).toBeEnabled();
    expect(copy.title).toMatch(/2 failed tests/);
    fireEvent.click(copy);
    expect(onCopyFailed).toHaveBeenCalledOnce();
  });

  it('says why there is nothing to copy', () => {
    header(0);
    const copy = screen.getByText('Copy failed tests').closest('button') as HTMLButtonElement;
    expect(copy).toBeDisabled();
    expect(copy.title).toBe('No failed tests to copy');
  });
});
