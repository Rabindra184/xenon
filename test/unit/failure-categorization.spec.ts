import 'reflect-metadata';
import { expect } from 'chai';
import {
  categorizeFailure,
  commandErrorOf,
  type CommandError,
} from '../../src/dashboard/services/failureCategories';
import { categorizeSessionFailure } from '../../src/dashboard/services/failure-analysis-service';
import { prisma } from '../../src/prisma';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * A failed session's category, from what Appium and the drivers really say.
 *
 * Each text below is quoted from the installed drivers (UiAutomator2 6.4.1
 * with its server 9.3.1, XCUITest 10.9.0 with WebDriverAgent 10.2.3,
 * base-driver 10.x) or from Xenon, with where it comes from. Through 2.14 the
 * rules matched none of App crash's texts, filed every UiAutomator2 error on
 * a hub as TIMEOUT (its stack trace names netty's IdleStateHandler), and let
 * a find the test expected to fail outrank the real failure.
 */

/** A row this server records for its own sessions: the error's message only (CommandInterceptor). */
const local = (message: string): CommandError =>
  commandErrorOf(JSON.stringify({ value: { error: message } }));

/** A row a hub records for a node's session: the node's whole WebDriver answer. */
const hub = (error: string, message: string, stacktrace = ''): CommandError =>
  commandErrorOf(JSON.stringify({ value: { error, message, stacktrace } }));

/**
 * The stack trace the UiAutomator2 server sends with every error it answers
 * (base-driver passes it on). Abbreviated; the netty frame is verbatim from a
 * captured 9.3.1 answer: its pipeline starts with KeepAliveStateHandler, an
 * IdleStateHandler.
 */
const UIA2_STACK = [
  'io.appium.uiautomator2.common.exceptions.StaleElementReferenceException: The element does not exist in DOM anymore',
  '\tat io.appium.uiautomator2.model.ElementsCache.restore(ElementsCache.java:117)',
  '\tat io.appium.uiautomator2.http.ServerHandler.channelRead(ServerHandler.java:68)',
  '\tat io.netty.handler.timeout.IdleStateHandler.channelRead(IdleStateHandler.java:293)',
].join('\n');

const NEW_COMMAND_TIMEOUT =
  "New Command Timeout of 60 seconds expired. Try customizing the timeout using the 'newCommandTimeout' desired capability";

describe('failure categories, from what Appium really says', () => {
  describe('the stack trace is never read', () => {
    it("a UiAutomator2 error on a hub isn't a timeout because netty's IdleStateHandler is in its stack", () => {
      const row = hub(
        'stale element reference',
        "The element 'By.id: com.acme:id/pay' does not exist in DOM anymore",
        UIA2_STACK,
      );
      expect(categorizeFailure('stale element reference', [row])).to.equal('STALE_ELEMENT');
      expect(
        categorizeFailure('invalid element state', [
          hub('invalid element state', 'Cannot set the element to the value', UIA2_STACK),
        ]),
      ).to.equal('UNKNOWN');
    });

    it('keeps only the code and the message of a recorded answer', () => {
      expect(
        commandErrorOf(JSON.stringify({ value: { error: 'e', message: 'm', stacktrace: 's' } })),
      ).to.deep.equal({ error: 'e', message: 'm' });
      expect(commandErrorOf(null)).to.deep.equal({});
      expect(commandErrorOf('not json')).to.deep.equal({});
      expect(commandErrorOf(JSON.stringify({ value: 'x' }))).to.deep.equal({});
    });

    it("a selector's own words don't decide the category", () => {
      // Xenon's OmniVision miss names the selector (CommandInterceptor).
      const miss = 'Xenon found nothing on the screen matching id "sessionTimeoutLabel".';
      expect(categorizeFailure(miss, [local(miss)])).to.equal('ELEMENT_NOT_FOUND');
    });
  });

  describe('the failure that ended the session decides, not an earlier one', () => {
    it('a find the test expected to fail, earlier, does not outrank the real failure', () => {
      const stale =
        'An element command failed because the referenced element is no longer attached to the DOM.';
      const expectedMiss = local(
        'An element could not be located on the page using the given search parameters.',
      );
      expect(categorizeFailure(stale, [local(stale), expectedMiss])).to.equal('STALE_ELEMENT');
    });

    it('an earlier failure the test recovered from, of a kind tried first, does not decide either', () => {
      // A stale element the test caught and found again, then a find that
      // really failed: Stale element is tried before Element not found, so
      // read all together the earlier one won.
      const recovered = hub(
        'stale element reference',
        "The element 'By.id: com.acme:id/list' does not exist in DOM anymore",
      );
      const miss = hub(
        'no such element',
        'An element could not be located on the page using the given search parameters.',
      );
      expect(categorizeFailure('no such element', [miss, recovered])).to.equal('ELEMENT_NOT_FOUND');
      // The same on this server's own rows, and with Xenon losing the session
      // after an earlier timeout.
      expect(
        categorizeFailure('Session heartbeat timeout', [
          local('An operation did not complete before its timeout expired.'),
        ]),
      ).to.equal('SESSION_LOST');
      const timedOutScript = local('A script did not complete before its timeout expired.');
      const finalMiss = local(
        'An element could not be located on the page using the given search parameters.',
      );
      expect(categorizeFailure(finalMiss.error as string, [finalMiss, timedOutScript])).to.equal(
        'ELEMENT_NOT_FOUND',
      );
    });

    it('an idle session is a timeout, whatever failed before it', () => {
      const expectedMiss = local(
        'An element could not be located on the page using the given search parameters.',
      );
      expect(categorizeFailure(NEW_COMMAND_TIMEOUT, [expectedMiss])).to.equal('TIMEOUT');
    });

    it("on a hub, the reason is the bare code, so the command's message is read with it", () => {
      // UiAutomator2 answers an expired cache entry as "no such element"
      // (ElementsCache.get): it is a stale element.
      const row = hub(
        'no such element',
        "The element identified by '00000000-0000-0000-0000-000000000bad' is not present in the cache or has expired. Try to find it again",
        UIA2_STACK,
      );
      expect(categorizeFailure('no such element', [row])).to.equal('STALE_ELEMENT');
    });

    it('with a reason that names nothing, the newest failed command decides, then older ones', () => {
      const lost = local(
        'Could not proxy command to the remote server. Original error: socket hang up',
      );
      const miss = local(
        'An element could not be located on the page using the given search parameters.',
      );
      expect(categorizeFailure('Assertion failed: total is 12', [lost, miss])).to.equal(
        'SESSION_LOST',
      );
      expect(categorizeFailure('Assertion failed: total is 12', [local('boom'), miss])).to.equal(
        'ELEMENT_NOT_FOUND',
      );
      expect(categorizeFailure('Assertion failed: total is 12', [])).to.equal('UNKNOWN');
    });
  });

  const cases: Array<[string, string, CommandError[], string]> = [
    // SESSION_LOST: the phone's helper or the session went away.
    [
      'base-driver proxy, helper dropped the connection (jsonwp-proxy/proxy.js)',
      'Could not proxy command to the remote server. Original error: socket hang up',
      [],
      'SESSION_LOST',
    ],
    [
      'base-driver proxy, helper gone',
      'Could not proxy command to the remote server. Original error: connect ECONNREFUSED 127.0.0.1:8200',
      [],
      'SESSION_LOST',
    ],
    [
      "base-driver proxy, helper hung: a read time-out, which isn't the test's timeout",
      'Could not proxy command to the remote server. Original error: timeout of 240000ms exceeded',
      [],
      'SESSION_LOST',
    ],
    [
      'UiAutomator2 instrumentation exited: the helper, though it says "probably crashed" (uiautomator2.js)',
      "'POST /element' cannot be proxied to UiAutomator2 server because the instrumentation process is not running (probably crashed). Check the server log and/or the logcat output for more details",
      [],
      'SESSION_LOST',
    ],
    [
      'WebDriverAgent restarted without the session, on a hub (FBRoute.m)',
      'invalid session id',
      [hub('invalid session id', 'Session does not exist')],
      'SESSION_LOST',
    ],
    [
      'Appium ended the session without a cause (base-driver driver.js)',
      'The driver was unexpectedly shut down!',
      [],
      'SESSION_LOST',
    ],
    [
      "XCUITest's commandTimeouts, which then ends the session (proxy-helper.js)",
      'timeout',
      [hub('timeout', "Appium did not get any response from 'click' command in 60000 ms")],
      'SESSION_LOST',
    ],
    ['OrphanSweeper', 'Session heartbeat timeout', [], 'SESSION_LOST'],
    [
      'SessionHeartbeatService, node no longer has it',
      'Session terminal failure (SESSION_NOT_FOUND: The node no longer has this session)',
      [],
      'SESSION_LOST',
    ],
    [
      "SessionHeartbeatService, node unreachable: not a timeout of the test's",
      'Session terminal failure (TIMEOUT: Node session status failed: ETIMEDOUT)',
      [],
      'SESSION_LOST',
    ],
    // APP_CRASH
    [
      'WebDriverAgent, app under test gone, on a hub (FBSession.m)',
      'invalid element state',
      [
        hub(
          'invalid element state',
          "The application under test with bundle id 'com.acme.shop' is not running, possibly crashed",
        ),
      ],
      'APP_CRASH',
    ],
    [
      'UiAutomator2, the app hogging its main thread: not a timeout (AXWindowHelpers)',
      'Timed out after 10000ms waiting for the root AccessibilityNodeInfo in the active window. Make sure the active window is not constantly hogging the main UI thread (e.g. the application is being idle long enough), so the accessibility manager could do its work',
      [],
      'APP_CRASH',
    ],
    ['a test reporting it', 'The application has crashed', [], 'APP_CRASH'],
    // SYSTEM_OVERLOAD
    [
      'UiAutomator2 server out of memory',
      'java.lang.OutOfMemoryError: Failed to allocate a 268435472 byte allocation',
      [],
      'SYSTEM_OVERLOAD',
    ],
    [
      "the server out of files, though it reached the proxy: not the helper's loss",
      'Could not proxy command to the remote server. Original error: connect EMFILE 127.0.0.1:8200 - Local (undefined:undefined)',
      [],
      'SYSTEM_OVERLOAD',
    ],
    // STALE_ELEMENT
    [
      'WebDriverAgent snapshot (XCUIElement+FBUtilities.m)',
      'The previously found element "Button, label: \'Pay\'" is not present in the current view anymore. Make sure the application UI has the expected state',
      [],
      'STALE_ELEMENT',
    ],
    [
      'WebDriverAgent cache (FBElementCache.m)',
      'The element identified by "5D2F" is either not present or it has expired from the internal cache. Try to find it again',
      [],
      'STALE_ELEMENT',
    ],
    [
      'UiAutomator2 server (ElementsCache.java)',
      "The element 'By.id: com.acme:id/pay' is not linked to the same object in DOM anymore",
      [],
      'STALE_ELEMENT',
    ],
    [
      "base-driver's default, which XENON_COMMAND_FAILURE used to catch",
      'An element command failed because the referenced element is no longer attached to the DOM.',
      [],
      'STALE_ELEMENT',
    ],
    [
      'a hub, by code',
      'stale element reference',
      [hub('stale element reference', '')],
      'STALE_ELEMENT',
    ],
    // TIMEOUT
    ['Appium, idle past newCommandTimeout', NEW_COMMAND_TIMEOUT, [], 'TIMEOUT'],
    ["Xenon's idle sweep", 'Session timed out due to inactivity', [], 'TIMEOUT'],
    [
      "base-driver's timeout default",
      'An operation did not complete before its timeout expired.',
      [],
      'TIMEOUT',
    ],
    ['a hub, by code', 'script timeout', [hub('script timeout', 'x')], 'TIMEOUT'],
    [
      "Xenon's autowait, an element that never became enabled",
      'Autowait timed out after 10000 ms waiting for element 00000000-0001 to be enabled',
      [],
      'TIMEOUT',
    ],
    // ELEMENT_NOT_FOUND
    [
      "base-driver's default, both platforms' finds",
      'An element could not be located on the page using the given search parameters.',
      [],
      'ELEMENT_NOT_FOUND',
    ],
    [
      "Xenon's autowait gave up looking: not a timeout",
      'Autowait timed out after 10000 ms waiting for element',
      [],
      'ELEMENT_NOT_FOUND',
    ],
    ['a hub, by code', 'no such element', [hub('no such element', 'x')], 'ELEMENT_NOT_FOUND'],
    // PERMISSION_BLOCKED
    [
      'a web page on an iPhone (base-driver)',
      'unexpected alert open',
      [hub('unexpected alert open', 'A modal dialog was open, blocking this operation')],
      'PERMISSION_BLOCKED',
    ],
    // HUB_RESTART
    ["ShutdownCoordinator's drain", 'Hub shutdown', [], 'HUB_RESTART'],
    // UNKNOWN
    [
      "onSessionStopped's fallback, which XENON_COMMAND_FAILURE used to catch",
      'Command failed: click',
      [],
      'UNKNOWN',
    ],
    ['nothing at all', '', [], 'UNKNOWN'],
  ];

  for (const [source, reason, commands, category] of cases) {
    it(`${category}: ${source}`, () => {
      expect(categorizeFailure(reason, commands)).to.equal(category);
    });
  }
});

describe('categorizeSessionFailure', function () {
  this.timeout(30_000);
  const scratch = useScratchDatabase();

  beforeEach(async () => {
    await scratch.db.sessionLog.deleteMany({});
    await scratch.db.session.deleteMany({});
  });

  it("files a hub's stale-element failure from its rows, stack traces and all", async () => {
    await scratch.db.session.create({
      data: {
        id: 's-stale',
        status: 'failed',
        failure_reason: 'stale element reference',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'n-1',
        has_live_video: false,
        device_udid: 'R5CT',
        device_platform: 'android',
        device_version: '10',
      },
    });
    const row = (n: number, error: string, message: string) => ({
      session_id: 's-stale',
      url: '/element',
      method: 'POST',
      title: 'Timeouts', // a title is never read: "Timeouts" used to match TIMEOUT
      is_error: true,
      createdAt: new Date(Date.UTC(2026, 9, 5, 9, 0, n)),
      response: JSON.stringify({ value: { error, message, stacktrace: UIA2_STACK } }),
    });
    await scratch.db.sessionLog.createMany({
      data: [
        row(
          1,
          'no such element',
          'An element could not be located on the page using the given search parameters',
        ),
        row(
          2,
          'stale element reference',
          "The element 'By.id: com.acme:id/pay' does not exist in DOM anymore",
        ),
      ],
    });

    await categorizeSessionFailure('s-stale');

    const session = await prisma.session.findUnique({ where: { id: 's-stale' } });
    expect(session?.failure_category).to.equal('STALE_ELEMENT');
  });
});
