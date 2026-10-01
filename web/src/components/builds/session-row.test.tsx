import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionRow } from './session-row';
import type { ISession } from '../../interfaces/ISession';

const session = (over: Partial<ISession> = {}): ISession =>
  ({
    id: '088cce7e-aaaa-bbbb-cccc-000000000001',
    build_id: 'b-1',
    name: 'Login with saved card',
    status: 'success',
    desired_capabilities: '{}',
    session_capabilities: '{}',
    node_id: 'n-1',
    has_live_video: false,
    startTime: new Date(Date.now() - 130_000).toISOString(),
    endTime: new Date().toISOString(),
    device_udid: 'R58M',
    device_platform: 'android',
    device_version: '10',
    device_name: 'Galaxy S9+',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    owner: { name: 'Priya Shah', email: 'priya@example.com' },
    ranOn: '10.0.0.9:4725',
    ...over,
  }) as ISession;

const renderRow = (props: Partial<React.ComponentProps<typeof SessionRow>> = {}) => {
  const onOpen = vi.fn();
  render(
    <table>
      <tbody>
        <SessionRow
          session={session()}
          buildName="Nightly smoke"
          showBuild
          showSelection={false}
          selected={false}
          onToggleSelect={() => {}}
          onOpen={onOpen}
          {...props}
        />
      </tbody>
    </table>,
  );
  return { onOpen };
};

describe('SessionRow', () => {
  it('leads with the test, then its build', () => {
    renderRow();
    expect(screen.getByText('Login with saved card')).toBeInTheDocument();
    expect(screen.getByText('Nightly smoke')).toBeInTheDocument();
    expect(screen.getByText('Passed')).toBeInTheDocument();
  });

  it('marks a failure and says why in place of the build', () => {
    renderRow({
      session: session({ status: 'error', failure_reason: 'NoSuchElement: id=checkout_button' }),
    });
    expect(screen.getByRole('row')).toHaveAttribute('data-outcome', 'failed');
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('NoSuchElement: id=checkout_button')).toBeInTheDocument();
    expect(screen.queryByText('Nightly smoke')).not.toBeInTheDocument();
  });

  it('names the phone, where it ran and who ran it', () => {
    renderRow();
    expect(screen.getByText('Galaxy S9+ · Android 10')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.9:4725 · Priya Shah')).toBeInTheDocument();
  });

  it('says this server for a session run here', () => {
    renderRow({ session: session({ ranOn: 'here', owner: null }) });
    expect(screen.getByText('This server')).toBeInTheDocument();
  });

  it('falls back to the app for an unnamed session, and says how to name it', () => {
    renderRow({
      session: session({
        name: null,
        session_capabilities: '{"appium:appPackage":"com.example.shop"}',
      }),
    });
    const title = screen.getByText('com.example.shop');
    expect(title.getAttribute('title')).toMatch(/xe:options\.name/);
  });

  it('opens on click, and offers selection only when asked', () => {
    const { onOpen } = renderRow();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('row'));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('opens from the keyboard too', () => {
    const { onOpen } = renderRow();
    const row = screen.getByRole('row');
    expect(row).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('leaves keys typed in its checkbox alone', () => {
    const { onOpen } = renderRow({ showSelection: true });
    fireEvent.keyDown(screen.getByRole('checkbox'), { key: ' ' });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('has a checkbox that does not open the row', () => {
    const onToggleSelect = vi.fn();
    const { onOpen } = renderRow({ showSelection: true, onToggleSelect });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggleSelect).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('shows the duration compactly', () => {
    renderRow();
    expect(screen.getByText('2m 10s')).toBeInTheDocument();
  });
});
