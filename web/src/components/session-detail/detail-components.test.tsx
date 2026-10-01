import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ToastProvider } from '../ui/toast';
import type { ISession } from '../../interfaces/ISession';
import { OutcomeHeader } from './outcome-header';
import { OutcomeTiles } from './outcome-tiles';
import { HealingPanel } from './healing-panel';
import { FailureSummary } from './failure-summary';
import { LogViewer } from './log-viewer';
import { DetailsCard } from './details-card';
import { CapabilitiesCard } from './capabilities-card';

const t = (s: number) => new Date(Date.UTC(2026, 8, 30, 20, 41, s)).toISOString();

const session = (over: Partial<ISession> = {}): ISession =>
  ({
    id: '088cce7e-aaaa-bbbb-cccc-000000000001',
    build_id: 'b-1',
    name: 'Login with saved card',
    status: 'failed',
    desired_capabilities: '{"platformName":"Android"}',
    session_capabilities: '{}',
    node_id: 'n-1',
    has_live_video: false,
    startTime: t(0),
    endTime: t(130 - 60),
    failure_reason: 'NoSuchElement: id=checkout_confirm',
    failure_category: 'selector_not_found',
    ai_analysis: 'Root Cause: the **Confirm** button moved into a `BottomSheet`.',
    device_udid: 'R58M1234',
    device_platform: 'android',
    device_version: '10',
    device_name: 'Galaxy S9+',
    createdAt: t(0),
    updatedAt: t(0),
    owner: { name: 'Priya Shah', email: 'priya@example.com' },
    ranOn: '10.0.0.9:4725',
    ...over,
  }) as ISession;

const commands = [
  {
    id: 'c3',
    command_name: 'findElement',
    title: 'Find Element',
    is_success: false,
    is_error: true,
    duration: 8400,
    response: '{"value":{"error":"no such element","message":"An element could not be located"}}',
    createdAt: t(40),
  },
  {
    id: 'c2',
    command_name: 'click',
    title: 'Click',
    is_success: true,
    is_healed: true,
    healing_tier: 'Fuzzy XML',
    healing_confidence: 0.91,
    original_strategy: 'id',
    original_selector: 'pay',
    healed_strategy: 'xpath',
    healed_selector: '//Button[@text="Pay"]',
    duration: 320,
    screenshot: '088cce7e/screenshots/c2.png',
    createdAt: t(20),
  },
  {
    id: 'c1',
    command_name: 'getPageSource',
    title: 'Get Page Source',
    is_success: true,
    duration: 1100,
    createdAt: t(10),
  },
];

const withToast = (node: React.ReactElement) => render(<ToastProvider>{node}</ToastProvider>);

describe('OutcomeHeader', () => {
  it('leads with the outcome and the test, then where, who and when', () => {
    withToast(<OutcomeHeader session={session()} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Login with saved card');
    expect(screen.getByText('Failed')).toBeInTheDocument();
    const meta = screen.getByTestId('outcome-meta');
    expect(meta).toHaveTextContent('Galaxy S9+ · Android 10');
    expect(meta).toHaveTextContent('10.0.0.9:4725');
    expect(meta).toHaveTextContent('Priya Shah');
    // By its text: the test DOM's dom-accessibility-api names it by its title.
    expect(screen.getByText('Download bug report').closest('button')).toBeInTheDocument();
  });

  it('names an unnamed session by its app, and an error as failed', () => {
    withToast(
      <OutcomeHeader
        session={session({
          name: null,
          status: 'error',
          session_capabilities: '{"appium:appPackage":"com.example.shop"}',
          ranOn: 'here',
          owner: null,
        })}
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('com.example.shop');
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByTestId('outcome-meta')).toHaveTextContent('This server');
  });
});

describe('OutcomeTiles', () => {
  it('shows the result, the commands, the healing and the slowest command', () => {
    render(<OutcomeTiles session={session()} commands={commands} />);
    const tile = (label: string) => screen.getByText(label).parentElement as HTMLElement;
    expect(within(tile('Result')).getByText('Failed')).toBeInTheDocument();
    expect(within(tile('Result')).getByText('Selector Not Found')).toBeInTheDocument();
    expect(within(tile('Commands')).getByText('3')).toBeInTheDocument();
    expect(within(tile('Commands')).getByText('1 failed')).toBeInTheDocument();
    expect(within(tile('Self-healing')).getByText('1 healed')).toBeInTheDocument();
    expect(within(tile('Self-healing')).getByText('Fuzzy XML')).toBeInTheDocument();
    expect(within(tile('Slowest command')).getByText('8.4s')).toBeInTheDocument();
    expect(within(tile('Slowest command')).getByText('findElement')).toBeInTheDocument();
  });

  it('says so when nothing failed or needed healing', () => {
    render(<OutcomeTiles session={session({ status: 'success' })} commands={[commands[2]]} />);
    expect(screen.getByText('None failed')).toBeInTheDocument();
    expect(screen.getByText('None')).toBeInTheDocument();
    expect(screen.getByText('Passed')).toBeInTheDocument();
  });
});

describe('HealingPanel', () => {
  it('lists each heal: what was asked for, what it healed to, how', () => {
    render(<HealingPanel commands={commands} />);
    expect(screen.getByText('id=pay')).toBeInTheDocument();
    expect(screen.getByText('xpath=//Button[@text="Pay"]')).toBeInTheDocument();
    expect(screen.getByText('Fuzzy XML')).toBeInTheDocument();
    expect(screen.getByText('91%')).toBeInTheDocument();
  });

  it('shows nothing when nothing was healed', () => {
    const { container } = render(<HealingPanel commands={[commands[0]]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('FailureSummary', () => {
  it('says why it failed: the reason, the failed command and the AI analysis', () => {
    withToast(
      <FailureSummary
        session={session()}
        buildName="Nightly"
        buildId="b-1"
        commands={commands}
        durationText="1m 10s"
      />,
    );
    expect(screen.getByText('Why it failed')).toBeInTheDocument();
    expect(screen.getByText('NoSuchElement: id=checkout_confirm')).toBeInTheDocument();
    expect(screen.getByText('An element could not be located')).toBeInTheDocument();
    const ai = screen.getByTestId('ai-analysis');
    expect(within(ai).getByText('Confirm').tagName).toBe('STRONG');
    expect(within(ai).getByText('BottomSheet').tagName).toBe('CODE');
  });

  it('leaves out the AI analysis when there is none', () => {
    withToast(
      <FailureSummary
        session={session({ ai_analysis: null })}
        buildName="Nightly"
        buildId="b-1"
        commands={commands}
        durationText="1m 10s"
      />,
    );
    expect(screen.queryByTestId('ai-analysis')).not.toBeInTheDocument();
  });
});

describe('LogViewer', () => {
  const viewer = (over: Partial<React.ComponentProps<typeof LogViewer>> = {}) =>
    withToast(
      <LogViewer sessionLogs={commands} deviceLogs={[]} debugLogs={[]} profiling={[]} {...over} />,
    );

  it('has a tab for commands, the timeline, screenshots and logs', () => {
    viewer();
    for (const name of [/Commands/, /Timeline/, /Screenshots/, /Device logs/, /Debug logs/]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('dims a tab with nothing in it, without taking it away', () => {
    viewer();
    expect(screen.getByRole('button', { name: /Device logs/ })).toHaveAttribute(
      'data-empty',
      'true',
    );
    expect(screen.getByRole('button', { name: /Commands/ })).toHaveAttribute('data-empty', 'false');
  });

  it('shows each command on the timeline', () => {
    viewer();
    fireEvent.click(screen.getByRole('button', { name: /Timeline/ }));
    const bars = screen.getAllByTestId('timeline-bar');
    expect(bars.map((b) => b.getAttribute('data-command'))).toEqual([
      'getPageSource',
      'click',
      'findElement',
    ]);
    expect(bars[2]).toHaveAttribute('data-failed', 'true');
  });

  it('shows the screenshots commands kept', () => {
    viewer();
    fireEvent.click(screen.getByRole('button', { name: /Screenshots/ }));
    const img = screen.getByRole('img', { name: /click/ });
    expect(img.getAttribute('src')).toBe('/xenon/api/session/088cce7e/asset/screenshots/c2.png');
  });

  it("shows each command's duration", () => {
    viewer();
    expect(screen.getByText('8.4s')).toBeInTheDocument();
    expect(screen.getByText('320ms')).toBeInTheDocument();
  });
});

describe('DetailsCard', () => {
  it('lists the build, the phone, where it ran and who ran it', () => {
    withToast(<DetailsCard session={session()} buildName="Nightly smoke" />);
    expect(screen.getByText('Nightly smoke')).toBeInTheDocument();
    expect(screen.getByText('R58M1234')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.9:4725')).toBeInTheDocument();
    expect(screen.getByText('Priya Shah')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy session ID' })).toBeInTheDocument();
  });

  it('links an iOS performance trace when the session kept one', () => {
    withToast(
      <DetailsCard
        session={session({
          performance_trace: '088cce7e/performance/088cce7e.zip',
        } as Partial<ISession>)}
        buildName={null}
      />,
    );
    expect(screen.getByRole('link', { name: /performance trace/i })).toHaveAttribute(
      'href',
      '/xenon/api/session/088cce7e/asset/performance/088cce7e.zip',
    );
  });
});

describe('CapabilitiesCard', () => {
  it('calls them requested and actual, and keeps long names whole', () => {
    render(
      <CapabilitiesCard
        session={session({ desired_capabilities: '{"appium:wdaConnectionTimeout":120000}' })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Requested' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actual' })).toBeInTheDocument();
    expect(screen.getByText('appium:wdaConnectionTimeout')).not.toHaveClass('truncate');
  });
});
