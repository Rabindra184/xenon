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
 * base-driver 10.x), from Appium or from Xenon, with where it comes from, or
 * is marked as a test's own words. Through 2.15 the rules matched none of App
 * crash's texts, read a hub's recorded stack traces (netty's IdleStateHandler
 * is in every UiAutomator2 one) and let a failure the test had recovered from
 * decide the category.
 */

/** A row this server records for its own sessions: the error's message only (CommandInterceptor). */
const local = (message: string): CommandError =>
  commandErrorOf(JSON.stringify({ value: { error: message } }));

/** A row a hub records for a node's session: the node's whole WebDriver answer. */
const hub = (error: string, message: string, stacktrace = ''): CommandError =>
  commandErrorOf(JSON.stringify({ value: { error, message, stacktrace } }));

/**
 * The stack trace the UiAutomator2 server sends with an error it answers
 * (base-driver passes it on). Abbreviated; the netty frame is verbatim from a
 * captured 9.3.1 answer: its pipeline starts with KeepAliveStateHandler, an
 * IdleStateHandler. Nothing but that frame says "timeout".
 */
const UIA2_STACK = [
  'io.appium.uiautomator2.common.exceptions.InvalidElementStateException: Cannot set the element',
  '\tat io.appium.uiautomator2.handler.SendKeysToElement.safeHandle(SendKeysToElement.java:89)',
  '\tat io.appium.uiautomator2.http.ServerHandler.channelRead(ServerHandler.java:68)',
  '\tat io.netty.handler.timeout.IdleStateHandler.channelRead(IdleStateHandler.java:293)',
].join('\n');

const NEW_COMMAND_TIMEOUT =
  "New Command Timeout of 60 seconds expired. Try customizing the timeout using the 'newCommandTimeout' desired capability";
const NOT_LOCATED =
  'An element could not be located on the page using the given search parameters.';

describe('failure categories, from what Appium really says', () => {
  describe('only what the failure says is read', () => {
    it("a UiAutomator2 error on a hub isn't a timeout because netty's IdleStateHandler is in its stack", () => {
      const row = hub('invalid element state', 'Cannot set the element', UIA2_STACK);
      expect(categorizeFailure('invalid element state', [row])).to.equal('UNKNOWN');
    });

    it('keeps only the code and the message of a recorded answer', () => {
      expect(
        commandErrorOf(JSON.stringify({ value: { error: 'e', message: 'm', stacktrace: 's' } })),
      ).to.deep.equal({ error: 'e', message: 'm' });
      expect(commandErrorOf(null)).to.deep.equal({});
      expect(commandErrorOf('not json')).to.deep.equal({});
      expect(commandErrorOf(JSON.stringify({ value: 'x' }))).to.deep.equal({});
    });

    it("a selector quoted in Xenon's own message doesn't decide the category", () => {
      // OmniVision's miss and autowait quote the test's selector
      // (CommandInterceptor), which can hold any rule's phrase.
      for (const selector of [
        'Allow notifications to be enabled',
        'Session timed out due to inactivity',
        'Hub shutdown',
      ]) {
        const miss = `Xenon found nothing on the screen matching -custom:ai-text "${selector}".`;
        expect(categorizeFailure(miss, [local(miss)]), selector).to.equal('ELEMENT_NOT_FOUND');
        expect(
          categorizeFailure('no such element', [hub('no such element', miss)]),
          `hub: ${selector}`,
        ).to.equal('ELEMENT_NOT_FOUND');
      }
    });

    it("a locator quoted in a driver's message doesn't either", () => {
      // "emfile" is a substring of "systemFileList".
      const stale = "The element 'By.id: com.acme:id/systemFileList' does not exist in DOM anymore";
      expect(categorizeFailure(stale, [local(stale)])).to.equal('STALE_ELEMENT');
    });
  });

  describe('the failure that ended the session decides alone', () => {
    // Each older failure's rule comes before the ending one's, so reading
    // them all as one text would give the older one's category.
    it('an earlier failure the test recovered from does not decide', () => {
      const recoveredStale = hub(
        'stale element reference',
        "The element 'By.id: com.acme:id/list' does not exist in DOM anymore",
      );
      const finalMiss = hub('no such element', NOT_LOCATED);
      expect(categorizeFailure('no such element', [finalMiss, recoveredStale])).to.equal(
        'ELEMENT_NOT_FOUND',
      );
      const recoveredLost = local(
        'Could not proxy command to the remote server. Original error: socket hang up',
      );
      expect(categorizeFailure(NEW_COMMAND_TIMEOUT, [local(NOT_LOCATED), recoveredLost])).to.equal(
        'TIMEOUT',
      );
    });

    it('a reason no rule matches is unknown, whatever failed before it', () => {
      // A test's own reason, and an ending error nothing matches.
      expect(categorizeFailure('expected Total to be 12', [local(NOT_LOCATED)])).to.equal(
        'UNKNOWN',
      );
      const notInteractable = hub('element not interactable', 'Element is not interactable');
      expect(
        categorizeFailure('element not interactable', [notInteractable, local(NOT_LOCATED)]),
      ).to.equal('UNKNOWN');
      expect(categorizeFailure('Shutdown timeout (Cleanup hung for > 60s)', [])).to.equal(
        'UNKNOWN',
      );
    });

    it("for a node's session, the reason is the bare code, so its command's message is read with it", () => {
      // UiAutomator2 answers an expired cache entry as "no such element"
      // (ElementsCache.get): it is a stale element.
      const row = hub(
        'no such element',
        "The element identified by '00000000-0000-0000-0000-000000000bad' is not present in the cache or has expired. Try to find it again",
      );
      expect(categorizeFailure('no such element', [row])).to.equal('STALE_ELEMENT');
    });

    it('a reason Xenon writes whole is matched whole', () => {
      expect(categorizeFailure('Hub shutdown', [])).to.equal('HUB_RESTART');
      expect(categorizeFailure('Assertion failed after Hub shutdown', [])).to.equal('UNKNOWN');
    });

    it('with no reason at all, the newest failed command decides, then older ones', () => {
      const olderStale = hub(
        'stale element reference',
        "The element 'By.id: com.acme:id/list' does not exist in DOM anymore",
      );
      expect(categorizeFailure('', [hub('no such element', NOT_LOCATED), olderStale])).to.equal(
        'ELEMENT_NOT_FOUND',
      );
      expect(categorizeFailure('', [local('boom'), olderStale])).to.equal('STALE_ELEMENT');
      expect(categorizeFailure('', [])).to.equal('UNKNOWN');
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
      'WebDriverAgent restarted without the session, for a node (FBRoute.m)',
      'invalid session id',
      [hub('invalid session id', 'Session does not exist')],
      'SESSION_LOST',
    ],
    [
      'base-driver, a command after the session ended (protocol.js)',
      'A session is either terminated or not started',
      [],
      'SESSION_LOST',
    ],
    [
      "Appium, a command racing the session's end (appium.js)",
      "The session with id '6f1c2a8e' does not exist",
      [],
      'SESSION_LOST',
    ],
    [
      'Appium ended the session without a cause (base-driver driver.js)',
      'The driver was unexpectedly shut down!',
      [],
      'SESSION_LOST',
    ],
    [
      "Xenon's onUnexpectedShutdown, no cause given (shutdownReason.ts)",
      'Driver shut down unexpectedly',
      [],
      'SESSION_LOST',
    ],
    [
      'UiAutomator2, a web view (android-driver context/exports.js)',
      'Chromedriver quit unexpectedly during session',
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
    [
      "the hub, for a node it can't reach (forwardToNode.ts)",
      'unknown error',
      [hub('unknown error', 'Xenon could not reach the node running this session.')],
      'SESSION_LOST',
    ],
    // APP_CRASH
    [
      'WebDriverAgent, app under test gone, for a node (FBSession.m)',
      'invalid element state',
      [
        hub(
          'invalid element state',
          "The application under test with bundle id 'com.acme.shop' is not running, possibly crashed",
        ),
      ],
      'APP_CRASH',
    ],
    ["a test's own words", 'The application has crashed', [], 'APP_CRASH'],
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
    ['Node, opening a file', 'EMFILE: too many open files, open /tmp/x.png', [], 'SYSTEM_OVERLOAD'],
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
      'UiAutomator2 server, several (ElementsCache.restore)',
      "Cached elements 'By.id: com.acme:id/row' do not exist in DOM anymore",
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
      'Safari on an iPhone (remote-debugger atoms)',
      'Element does not exist in cache',
      [],
      'STALE_ELEMENT',
    ],
    [
      'for a node, by code',
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
    [
      'Safari on an iPhone (remote-debugger)',
      'Timed out waiting for asynchronous script result after 5000 ms',
      [],
      'TIMEOUT',
    ],
    [
      'XCUITest (xctest.js)',
      "Timed out after '120000ms' waiting for XCTest to complete",
      [],
      'TIMEOUT',
    ],
    [
      'WebDriverAgent (FBXCTestDaemonsProxy.m), on this server: no code to go by',
      "The application 'com.acme.shop' cannot be launched within 60 seconds timeout",
      [],
      'TIMEOUT',
    ],
    [
      'WebDriverAgent (XCUIDevice+FBHelpers.m), on this server',
      'Timed out while waiting until the screen gets locked',
      [],
      'TIMEOUT',
    ],
    [
      'UiAutomator2, a screen that never goes idle: not a crash (AXWindowHelpers)',
      'Timed out after 10000ms waiting for the root AccessibilityNodeInfo in the active window. Make sure the active window is not constantly hogging the main UI thread (e.g. the application is being idle long enough), so the accessibility manager could do its work',
      [],
      'TIMEOUT',
    ],
    ['for a node, by code', 'script timeout', [hub('script timeout', 'x')], 'TIMEOUT'],
    [
      "Xenon's autowait, an element that never became enabled",
      'Autowait timed out after 10000 ms waiting for element 00000000-0001 to be enabled',
      [],
      'TIMEOUT',
    ],
    // ELEMENT_NOT_FOUND
    ["base-driver's default, both platforms' finds", NOT_LOCATED, [], 'ELEMENT_NOT_FOUND'],
    [
      'WebDriverAgent identifier lookup (FBElementCommands.m)',
      "'Pay' identifier didn't match any elements",
      [],
      'ELEMENT_NOT_FOUND',
    ],
    [
      "Xenon's autowait gave up looking: not a timeout",
      'Autowait timed out after 10000 ms waiting for element',
      [],
      'ELEMENT_NOT_FOUND',
    ],
    [
      'Xenon, an element id it holds no more',
      'Xenon has no element omni_42.',
      [],
      'ELEMENT_NOT_FOUND',
    ],
    ['for a node, by code', 'no such element', [hub('no such element', 'x')], 'ELEMENT_NOT_FOUND'],
    // PERMISSION_BLOCKED
    [
      'a web page on an iPhone (base-driver)',
      'unexpected alert open',
      [hub('unexpected alert open', 'A modal dialog was open, blocking this operation')],
      'PERMISSION_BLOCKED',
    ],
    // HUB_RESTART
    ["ShutdownCoordinator's drain", 'Hub shutdown', [], 'HUB_RESTART'],
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

  it("reads a node session's newest failed command with its reason, and nothing older", async () => {
    // The reason is the newest command's bare code. Its message makes it a
    // stale element; read alone, the code would be Element not found; read
    // oldest first, the older lost helper would decide.
    await scratch.db.session.create({
      data: {
        id: 's-stale',
        status: 'failed',
        failure_reason: 'no such element',
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
      title: 'Find Element',
      is_error: true,
      createdAt: new Date(Date.UTC(2026, 9, 5, 9, 0, n)),
      response: JSON.stringify({ value: { error, message, stacktrace: UIA2_STACK } }),
    });
    await scratch.db.sessionLog.createMany({
      data: [
        row(
          1,
          'unknown error',
          'Could not proxy command to the remote server. Original error: socket hang up',
        ),
        row(
          2,
          'no such element',
          "The element identified by '00000000-0000-0000-0000-000000000bad' is not present in the cache or has expired. Try to find it again",
        ),
      ],
    });

    await categorizeSessionFailure('s-stale');

    const session = await prisma.session.findUnique({ where: { id: 's-stale' } });
    expect(session?.failure_category).to.equal('STALE_ELEMENT');
  });
});
