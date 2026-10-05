import { Container, Service } from 'typedi';
import { Span } from '@opentelemetry/api';
import { TracingService } from '../services/TracingService';
import { DASHBORD_EVENT_MANAGER } from '../dashboard/event-manager';
import { SESSION_MANAGER } from '../sessions/SessionManager';
import {
  HealingOrchestrator,
  healingTiersFromCaps,
} from '../services/healing/HealingOrchestrator';
import { HealEtalonService } from '../services/healing/HealEtalonService';
import { findLearntElement, isResilioPath, resilioPathOf } from '../services/healing/resilioPath';
import {
  attributesToLearn,
  hasIdentity,
  meaningful,
} from '../services/healing/fingerprintIdentity';
import { OmniVisionService } from '../services/omni-vision/OmniVisionService';
import { AICommandService } from '../services/AICommandService';
import log from '../logger';
import { sessionContext } from '../logging/sessionContext';
import { ProcessMetricsService } from '../services/ProcessMetricsService';
import { IPluginArgs } from '../interfaces/IPluginArgs';
import { AutowaitService } from '../services/autowait/AutowaitService';
import { waitFor } from '../services/autowait/waitFor';
import { SelfHealingSwitch } from '../services/settings/SelfHealingSwitch';
import { unknownXenonScriptMessage, xenonScriptName } from './xenonScripts';
import { HealReport, reportHeal } from '../gateway/healReport';

const W3C_ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * The commands the interceptor answers itself for an element Xenon found in a
 * screenshot (Omni-Vision's `-custom:ai-*` finds, self-healing's OCR and
 * Visual AI tiers). Any other command naming one is refused.
 */
const VIRTUAL_ELEMENT_COMMANDS = [
  'click',
  'getElementRect',
  'getElementLocation',
  'getElementSize',
  'getText',
  'setValue',
  'elementDisplayed',
  'elementEnabled',
];

/** An id Xenon gave an element it found in a screenshot. */
function isVirtualElementId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    (id.startsWith('omni_') || id.startsWith('healed_ocr') || id.startsWith('healed_visual'))
  );
}

/**
 * The element an element command is about. Appium passes a command's body
 * first and the ids from its path after it: setValue is (text, elementId),
 * the other commands Xenon looks at are (elementId, ...). Through 2.14 the
 * text of a setValue was read as its element.
 */
function elementIdOf(commandName: string, args: any[]): unknown {
  return commandName === 'setValue' ? args[1] : args[0];
}

@Service()
export class CommandInterceptor {
  private log = log.scope('CommandInterceptor');

  async handle(
    next: () => any,
    driver: any,
    commandName: string,
    args: any[],
    pluginArgs: IPluginArgs,
    isHub: boolean,
  ) {
    const IGNORED_COMMANDS = ['getScreenshot', 'stopRecordingScreen', 'startRecordingScreen'];
    if (IGNORED_COMMANDS.includes(commandName)) return await next();

    const sessionId = (driver.sessionId as string) || args[args.length - 1];
    const tracingService = Container.get(TracingService);
    let span: Span | undefined;

    if (isHub && sessionId) {
      span = tracingService.startCommandSpan(sessionId, commandName, {
        'xenon.command.args': JSON.stringify(args),
      });
    }

    // Wrap the rest of the work in an AsyncLocalStorage frame so logs emitted
    // from any downstream service (healing, omni-vision, dashboard event
    // manager) automatically carry session/command/trace attribution without
    // those services having to accept a context parameter.
    const spanCtx = span?.spanContext();
    const cmdStart = Date.now();
    try {
      return await sessionContext.run(
        {
          sessionId: sessionId || undefined,
          udid: driver?.caps?.udid,
          commandName,
          traceId: spanCtx?.traceId,
          spanId: spanCtx?.spanId,
        },
        () =>
          this.handleInContext(
            next,
            driver,
            commandName,
            args,
            pluginArgs,
            isHub,
            sessionId,
            span,
            tracingService,
          ),
      );
    } finally {
      // Aggregate counter — no per-session label, just fleet-wide throughput
      // so Prom rate() gives commands/sec and the duration sum gives avg
      // latency. Errors still count: a 429-hit dashboard poll is still hub
      // work done.
      Container.get(ProcessMetricsService).recordCommand(Date.now() - cmdStart);
    }
  }

  private async handleInContext(
    next: () => any,
    driver: any,
    commandName: string,
    args: any[],
    pluginArgs: IPluginArgs,
    isHub: boolean,
    sessionId: string,
    span: Span | undefined,
    tracingService: TracingService,
  ) {
    if (commandName === 'createSession' || commandName === 'deleteSession') {
      try {
        return await next();
      } finally {
        if (commandName === 'deleteSession' && sessionId) {
          Container.get(AutowaitService).clearSession(sessionId);
        }
        if (span) tracingService.endSpan(`${sessionId}:${commandName}`);
      }
    }

    try {
      if (sessionId) {
        const { updateCmdExecutedTime } = await import('../data-service/device-service');
        await updateCmdExecutedTime(sessionId);
        if (commandName === 'execute') {
          const script = typeof args[0] === 'string' ? args[0] : '';
          let scriptArgs = args[1];

          // Appium executeScript puts script arguments in args[1] as an array.
          // Dig into it to find our payload object.
          if (Array.isArray(scriptArgs)) {
            if (
              scriptArgs.length > 0 &&
              typeof scriptArgs[0] === 'object' &&
              scriptArgs[0] !== null
            ) {
              scriptArgs = scriptArgs[0];
            } else if (scriptArgs.length === 0) {
              scriptArgs = {};
            }
          }

          const aiCommand = script.replace(/^(xe|xenon)\s*:\s*/, '').trim();
          // appium-wait-plugin compatible alias — strip the `plugin:` prefix
          // and map the old camelCase names so existing tests Just Work.
          const legacyWaitCommand = script.replace(/^plugin\s*:\s*/, '').trim();

          if (
            aiCommand === 'setAutowaitProperties' ||
            legacyWaitCommand === 'setWaitPluginProperties'
          ) {
            const payload = typeof scriptArgs === 'object' && scriptArgs !== null ? scriptArgs : {};
            const partial = AutowaitService.fromLegacyShape(payload);
            // setAutowaitProperties is also accepted with the modern field names
            // verbatim; merge those in as a second pass.
            if (typeof (payload as any).enabled === 'boolean') {
              (partial as any).enabled = (payload as any).enabled;
            }
            return Container.get(AutowaitService).setProps(sessionId, partial);
          }
          if (
            aiCommand === 'getAutowaitProperties' ||
            legacyWaitCommand === 'getWaitPluginProperties'
          ) {
            return Container.get(AutowaitService).getProps(sessionId, pluginArgs);
          }

          if (aiCommand === 'smartTap' || aiCommand === 'omniClick') {
            this.log.info(
              `[Interceptor] Routing AI command: ${script} with payload: ${JSON.stringify(scriptArgs)}`,
            );
            const payload = typeof scriptArgs === 'object' && scriptArgs !== null ? scriptArgs : {};
            return await Container.get(AICommandService).smartTap(driver, payload);
          }
          if (aiCommand === 'uiInventory' || aiCommand === 'uiScanExport') {
            this.log.info(
              `[Interceptor] Routing AI command: ${script} with payload: ${JSON.stringify(scriptArgs)}`,
            );
            const payload = typeof scriptArgs === 'object' && scriptArgs !== null ? scriptArgs : {};
            return await Container.get(AICommandService).uiInventory(driver, payload);
          }
          if (aiCommand === 'analyzeScreen' || aiCommand === 'omniScan') {
            this.log.info(`[Interceptor] Routing AI command: ${script}`);
            return await Container.get(AICommandService).analyzeScreen(driver);
          }
          if (aiCommand === 'visualTap') {
            this.log.info(
              `[Interceptor] Routing AI command: ${script} with payload: ${JSON.stringify(scriptArgs)}`,
            );
            const payload = typeof scriptArgs === 'object' && scriptArgs !== null ? scriptArgs : {};
            return await Container.get(AICommandService).visualTap(driver, payload);
          }
          if (aiCommand === 'assertVisualState') {
            this.log.info(
              `[Interceptor] Routing AI command: ${script} with payload: ${JSON.stringify(scriptArgs)}`,
            );
            // The condition as a plain string (`execute(script, 'The cart is
            // empty')`, which arrives as ['The cart is empty']) or as
            // { instruction }. A plain string used to arrive as ''.
            const first = Array.isArray(scriptArgs) ? scriptArgs[0] : scriptArgs;
            const instruction =
              typeof first === 'string'
                ? first
                : typeof first === 'object' && typeof first?.instruction === 'string'
                  ? first.instruction
                  : '';
            return await Container.get(AICommandService).assertVisualState(driver, instruction);
          }

          if (
            aiCommand === 'addMock' ||
            aiCommand === 'removeMock' ||
            aiCommand === 'clearMocks' ||
            aiCommand === 'getRequests' ||
            aiCommand === 'getMocks' ||
            aiCommand === 'exportHar'
          ) {
            const payload = typeof scriptArgs === 'object' && scriptArgs !== null ? scriptArgs : {};
            const { InterceptorService } = await import('../services/InterceptorService');
            const interceptor = Container.get(InterceptorService);
            this.log.info(`[Interceptor] Routing network command: ${script}`);
            switch (aiCommand) {
              case 'addMock':
                return interceptor.addMock(sessionId, payload as any);
              case 'removeMock':
                return interceptor.removeMock(sessionId, (payload as any).id);
              case 'clearMocks':
                interceptor.clearMocks(sessionId);
                return { ok: true };
              case 'getMocks':
                return interceptor.listMocks(sessionId);
              case 'getRequests':
                return interceptor.getRequests(sessionId);
              case 'exportHar':
                return interceptor.exportHar(sessionId);
            }
          }
        }

        // A session-details command (`xenon: setSessionName`, ...) is answered
        // by the before-hook; its answer is what the test gets.
        let answered: unknown = null;
        const shouldProceed = await DASHBORD_EVENT_MANAGER.beforeSessionCommand(
          sessionId,
          commandName,
          { body: { script: args[0], args: args[1] } } as any,
          {
            status: () => ({
              json: (d: any) => {
                answered = d?.value ?? null;
                return d;
              },
            }),
            setHeader: () => {},
            getHeader: () => {},
          } as any,
        );

        if (shouldProceed === false) {
          return answered;
        }

        // Every Xenon script this server has was answered above. Any other
        // name used to be answered with null, as if it had worked.
        if (commandName === 'execute' && xenonScriptName(args[0]) !== null) {
          const { errors } = await import('@appium/base-driver');
          throw new errors.UnknownCommandError(unknownXenonScriptMessage(args[0]));
        }
      }

      // --- OMNI-VISION: PROACTIVE SEARCH ---
      const strategy = args[0];
      const selector = args[1];
      if (
        ['findElement', 'findElements'].includes(commandName) &&
        ['-custom:ai-icon', '-custom:ai-text'].includes(strategy)
      ) {
        return await this.handleOmniVisionSearch(
          sessionId,
          driver,
          commandName,
          strategy,
          selector,
        );
      }

      // --- OMNI-VISION: VIRTUAL ELEMENT INTERACTION ---
      // The driver doesn't know these elements, so nothing about one reaches it.
      const virtualId = this.virtualElementIn(commandName, args, sessionId);
      if (virtualId !== null) {
        return await this.handleVirtualElementCommand(
          sessionId,
          driver,
          commandName,
          virtualId,
          args[0],
        );
      }

      // --- AUTOWAIT: pre-action elementEnabled check for click/setValue/clear ---
      // Mirrors appium-wait-plugin behavior; runs before native command so
      // a NotEnabled state surfaces as a wait-then-retry rather than an
      // immediate failure. Skips elements managed by other Xenon subsystems.
      const autowait = Container.get(AutowaitService).getProps(sessionId, pluginArgs);
      const actedOn = elementIdOf(commandName, args);
      if (
        autowait.enabled &&
        ['click', 'setValue', 'clear'].includes(commandName) &&
        !autowait.excludeEnabledCheck.includes(commandName) &&
        typeof actedOn === 'string' &&
        !isVirtualElementId(actedOn)
      ) {
        await this.waitForElementEnabled(driver, actedOn, autowait);
      }

      // --- AUTOWAIT: polling find for findElement/findElements ---
      // Wraps next() in a poll loop so transient NoSuchElement errors get
      // a retry budget instead of failing immediately. Healing only runs
      // after the autowait timeout expires (preserving its current role
      // as the recovery mechanism for genuinely-broken locators).
      if (
        autowait.enabled &&
        ['findElement', 'findElements'].includes(commandName) &&
        !this.isVisualStrategy(strategy)
      ) {
        const response = await this.runFindWithAutowait(next, commandName, autowait);
        if (isHub && !!pluginArgs.enableDashboard && SESSION_MANAGER.isValidSession(sessionId)) {
          await this.runPostCommandHooks(sessionId, commandName, driver, args, response);
        }
        this.learnFromFind(sessionId, commandName, driver, args, response, pluginArgs);
        return response;
      }

      const response = await next();

      if (isHub && !!pluginArgs.enableDashboard && SESSION_MANAGER.isValidSession(sessionId)) {
        await this.runPostCommandHooks(sessionId, commandName, driver, args, response);
      }
      this.learnFromFind(sessionId, commandName, driver, args, response, pluginArgs);

      return response;
    } catch (error: any) {
      if (
        this.isNoSuchElementError(error) &&
        ['findElement', 'findElements'].includes(commandName) &&
        // A -custom:ai-* find already looked at the screen; the tiers would
        // only look again for the words of its description.
        !this.isVisualStrategy(args[0]) &&
        Container.get(SelfHealingSwitch).isEnabled(pluginArgs)
      ) {
        // §2.7 healing-tier capability gate: a session created with
        // xe:options.healingTiers (or the xenon:options alias) restricts
        // self-healing to those tier indices (1=Resilio, 2=Fuzzy XML, 3=OCR,
        // 4=Visual AI, 5=LLM), and so keeps its screen from the AI provider.
        // Read from the session's own driver, which Appium hands the plugin
        // with every command. SESSION_MANAGER holds a local session only with
        // the dashboard on or a video recorded, and through 2.14 every other
        // session ran every tier. A value that isn't a list of tier numbers
        // runs only the tiers that stay on this server (coerceHealingTiersCap).
        const asked = healingTiersFromCaps(driver?.caps);
        if (asked.unreadable !== undefined) {
          this.warnUnreadableHealingTiers(driver, sessionId, asked.unreadable);
        }

        const healed = await Container.get(HealingOrchestrator).attemptHealing(
          sessionId,
          driver,
          args[0],
          args[1],
          asked.tiers,
        );
        if (healed) {
          await this.recordHeal(sessionId, commandName, driver, args, healed);

          // The OCR and Visual AI tiers can find only a position. The test gets
          // a virtual element there, which its own click taps; nothing acts on
          // the screen during the find. Through 2.14 the interceptor tapped
          // the spot here, so the test's click tapped it a second time. On an
          // iPhone it first asked for the first element covering the spot in
          // tree order, which is an outer container such as the window.
          if (healed.id.startsWith('healed_') && healed.rect) {
            Container.get(OmniVisionService).remember(sessionId, {
              id: healed.id,
              rect: healed.rect,
              confidence: healed.confidence,
              text: healed.text,
            });
          }

          const elementResponse = {
            ELEMENT: healed.id,
            [W3C_ELEMENT_KEY]: healed.id,
          };
          return commandName === 'findElement' ? elementResponse : [elementResponse];
        }
      }

      if (isHub && !!pluginArgs.enableDashboard && sessionId) {
        await DASHBORD_EVENT_MANAGER.afterSessionCommand(
          sessionId,
          commandName,
          driver,
          {
            body: args,
            method: 'POST',
            path: `/${commandName}`,
            originalUrl: `/${commandName}`,
          } as any,
          {} as any,
          JSON.stringify({ value: { error: error.message || error }, sessionId }),
        );
      }
      throw error;
    } finally {
      if (isHub && sessionId && span) tracingService.endSpan(`${sessionId}:${commandName}`);
    }
  }

  // The sessions already told about their healingTiers, by driver: a driver
  // lives as long as its session, so nothing has to forget it.
  private warnedHealingTiers = new WeakSet<object>();

  private warnUnreadableHealingTiers(driver: any, sessionId: string, unreadable: string) {
    if (driver && typeof driver === 'object') {
      if (this.warnedHealingTiers.has(driver)) return;
      this.warnedHealingTiers.add(driver);
    }
    this.log.warn(
      `Session ${sessionId}: ${unreadable}. It heals with tiers 1, 2 and 3 only (Resilio, ` +
        'Fuzzy XML, OCR), which run on this server: healing never sends its screen to the AI ' +
        'provider.',
    );
  }

  private isNoSuchElementError(error: any): boolean {
    return (
      error.name === 'NoSuchElementError' ||
      error.message?.includes('NoSuchElement') ||
      error.status === 7
    );
  }

  private isVisualStrategy(strategy: any): boolean {
    return strategy === '-custom:ai-icon' || strategy === '-custom:ai-text';
  }

  /**
   * Polls `next()` until it succeeds or the autowait timeout expires.
   * For findElements, an empty array also counts as "not yet" — clients
   * relying on length-based assertions get the same waiting semantics.
   */
  private async runFindWithAutowait(
    next: () => any,
    commandName: string,
    autowait: { timeoutMs: number; intervalBetweenAttemptsMs: number },
  ): Promise<any> {
    const result = await waitFor<any>(
      async () => {
        const r = await next();
        if (commandName === 'findElements') {
          return Array.isArray(r) && r.length > 0 ? r : null;
        }
        return r ?? null;
      },
      {
        timeoutMs: autowait.timeoutMs,
        intervalMs: autowait.intervalBetweenAttemptsMs,
        // NoSuchElement is the expected "not yet" signal — anything else is fatal
        // (network blow-up, driver crash, etc.) and should bubble immediately.
        isTransientError: (e) => this.isNoSuchElementError(e),
      },
    );
    if ('value' in result) return result.value;

    if (commandName === 'findElements') {
      // Timed out without ever seeing an element — the contract says return [].
      // Do NOT throw, otherwise existing tests that wait for "no items" break.
      return [];
    }
    if (result.lastError) throw result.lastError;
    const { errors } = await import('@appium/base-driver');
    throw new errors.NoSuchElementError(
      `Autowait timed out after ${autowait.timeoutMs} ms waiting for element`,
    );
  }

  /**
   * Pre-action gate: poll `driver.elementEnabled` until truthy or the
   * autowait timeout expires. Failures are surfaced so the caller can decide
   * whether to bail; for now we log+throw to mirror appium-wait-plugin.
   */
  private async waitForElementEnabled(
    driver: any,
    elementId: string,
    autowait: { timeoutMs: number; intervalBetweenAttemptsMs: number },
  ): Promise<void> {
    if (typeof driver.elementEnabled !== 'function') return; // hub/proxy drivers have no elementEnabled
    const result = await waitFor<boolean>(
      async () => {
        try {
          const enabled = await driver.elementEnabled(elementId);
          return enabled ? true : null;
        } catch {
          return null;
        }
      },
      { timeoutMs: autowait.timeoutMs, intervalMs: autowait.intervalBetweenAttemptsMs },
    );
    if ('timedOut' in result) {
      throw new Error(
        `Autowait timed out after ${autowait.timeoutMs} ms waiting for element ${elementId} to be enabled`,
      );
    }
  }

  /** The dashboard's record of a command: only where enableDashboard records the session. */
  private async runPostCommandHooks(
    sessionId: string,
    commandName: string,
    driver: any,
    args: any[],
    response: any,
  ): Promise<void> {
    try {
      await DASHBORD_EVENT_MANAGER.afterSessionCommand(
        sessionId,
        commandName,
        driver,
        {
          body: args,
          method: 'POST',
          path: `/${commandName}`,
          originalUrl: `/${commandName}`,
        } as any,
        {} as any,
        JSON.stringify({ value: response, sessionId }),
      );
    } catch (postCommandErr: any) {
      this.log.warn(`[Interceptor] Post-command hooks failed: ${postCommandErr.message}`);
    }
  }

  /**
   * Learn the fingerprint of a selector a findElement found, which the Resilio
   * and Fuzzy XML tiers heal it with later. On every session this server
   * drives while self-healing is on, whatever enableDashboard says, nodes
   * included. Through 2.14 it ran only behind the dashboard's record above,
   * so a server with enableDashboard off, and every node, learnt nothing.
   * A session that turned its own healing off (`healingTiers: []`) isn't
   * learnt from, as the switch stops learning for every session.
   * It reads the element in the background; the find has already answered.
   */
  private learnFromFind(
    sessionId: string,
    commandName: string,
    driver: any,
    args: any[],
    response: any,
    pluginArgs: IPluginArgs,
  ) {
    // The find has its element: nothing here may fail it.
    try {
      if (
        commandName !== 'findElement' ||
        !response ||
        !Container.get(SelfHealingSwitch).isEnabled(pluginArgs) ||
        healingTiersFromCaps(driver?.caps).tiers?.length === 0
      ) {
        return;
      }
      this.triggerLearning(driver, args, response, sessionId).catch((err: any) =>
        this.log.debug(`[Learning] Failed: ${err?.message ?? err}`),
      );
    } catch (err: any) {
      this.log.debug(`[Learning] Skipped: ${err?.message ?? err}`);
    }
  }

  private async handleOmniVisionSearch(
    sessionId: string,
    driver: any,
    commandName: string,
    strategy: string,
    selector: string,
  ) {
    const omniService = Container.get(OmniVisionService);
    let results: any[] = [];
    if (strategy === '-custom:ai-text') results = await omniService.findByText(driver, selector);
    else if (strategy === '-custom:ai-icon') {
      const match = await omniService.findByIcon(driver, selector);
      if (match) results = [match];
    }
    // The session's test gets these ids, so the session keeps the elements.
    for (const element of results) omniService.remember(sessionId, element);
    const appiumResults = results.map((r) => ({
      ELEMENT: r.id,
      'element-6066-11e4-a52e-4f735466cecf': r.id,
    }));
    if (commandName === 'findElement') {
      if (appiumResults.length === 0) {
        const { errors } = await import('@appium/base-driver');
        throw new errors.NoSuchElementError(
          `Xenon found nothing on the screen matching ${strategy} "${selector}".`,
        );
      }
      return appiumResults[0];
    }
    return appiumResults;
  }

  /**
   * The virtual element a command is about, or null. A command the
   * interceptor answers for one is recognised by its element id; any other
   * command naming a virtual element Xenon holds is caught too, so it is
   * refused rather than sent to a driver that doesn't know the id.
   */
  private virtualElementIn(commandName: string, args: any[], sessionId: string): string | null {
    if (VIRTUAL_ELEMENT_COMMANDS.includes(commandName)) {
      const id = elementIdOf(commandName, args);
      return isVirtualElementId(id) ? id : null;
    }
    const omni = Container.get(OmniVisionService);
    const named = args.find((a) => isVirtualElementId(a) && omni.getVirtualElement(a, sessionId));
    return named ?? null;
  }

  private async tapAt(driver: any, x: number, y: number) {
    await driver.performActions([
      {
        type: 'pointer',
        id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x, y },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 100 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ]);
  }

  private async handleVirtualElementCommand(
    sessionId: string,
    driver: any,
    commandName: string,
    elementId: string,
    value?: any,
  ) {
    const { errors } = await import('@appium/base-driver');
    const omniService = Container.get(OmniVisionService);
    // Another session's element is unknown here, as one that has gone is.
    const element = omniService.getVirtualElement(elementId, sessionId);
    if (!element) {
      throw new errors.NoSuchElementError(`Xenon has no element ${elementId}.`);
    }

    const centerX = Math.round(element.rect.x + element.rect.width / 2);
    const centerY = Math.round(element.rect.y + element.rect.height / 2);

    switch (commandName) {
      case 'click':
        await this.tapAt(driver, centerX, centerY);
        return null;
      case 'getElementRect':
        return element.rect;
      case 'getElementLocation':
        return { x: element.rect.x, y: element.rect.y };
      case 'getElementSize':
        return { width: element.rect.width, height: element.rect.height };
      case 'elementDisplayed':
      case 'elementEnabled':
        return true;
      case 'getText':
        // The text OCR read there. An element Visual AI found has none: it
        // used to answer '' (or, healed, Xenon's note about the match).
        if (typeof element.text === 'string') return element.text;
        throw new errors.UnsupportedOperationError(
          `Element ${elementId} was found by AI vision, which reads no text, so Xenon has no text for it.`,
        );
      case 'setValue': {
        // The driver doesn't know this element, so the text goes to the field
        // the tap gives the keyboard focus. A driver that can't say which
        // field that is gets no tap at all.
        if (typeof driver.active !== 'function') {
          throw new errors.UnsupportedOperationError(
            `Xenon can't type into ${elementId}, an element it found in a screenshot: ` +
              "this driver can't tell which field has the keyboard focus. Tap the element, then type with key actions.",
          );
        }
        await this.tapAt(driver, centerX, centerY);
        let focused: any = null;
        try {
          focused = await driver.active();
        } catch {
          focused = null;
        }
        const focusedId = focused?.[W3C_ELEMENT_KEY] ?? focused?.ELEMENT;
        if (typeof focusedId !== 'string' || !focusedId) {
          throw new errors.ElementNotInteractableError(
            `Xenon tapped ${elementId} at (${centerX}, ${centerY}), but no field took the keyboard focus, so there was nowhere to type.`,
          );
        }
        try {
          return await driver.setValue(value, focusedId);
        } catch (e: any) {
          this.log.error(
            `setValue failed for virtual element ${elementId} on session ${sessionId}: ${e.message}`,
          );
          throw e;
        }
      }
      default:
        throw new errors.UnsupportedOperationError(
          `${commandName} isn't available on ${elementId}: Xenon found it in a screenshot, and ` +
            `it is only a position on the screen. It answers ${VIRTUAL_ELEMENT_COMMANDS.join(', ')}.`,
        );
    }
  }

  private learningSessions: Set<string> = new Set();

  /** Selectors whose fingerprint was learnt again for its path in this process (bounded). */
  private relearnt: Set<string> = new Set();

  private rememberRelearnt(selector: string) {
    if (this.relearnt.size >= 10_000) this.relearnt.clear();
    this.relearnt.add(selector);
  }

  private async triggerLearning(driver: any, args: any[], response: any, sessionId: string) {
    if (this.learningSessions.has(sessionId)) return;
    this.learningSessions.add(sessionId);

    const strategy = args[0];
    const selector = args[1];
    const elementId = response.ELEMENT || response['element-6066-11e4-a52e-4f735466cecf'];
    if (!elementId || typeof selector !== 'string') {
      this.learningSessions.delete(sessionId);
      return;
    }

    (async () => {
      try {
        const etalonService = Container.get(HealEtalonService);

        // CRITICAL PERFORMANCE OPTIMIZATION:
        // Only trigger the heavy metadata collection if we don't already have an etalon for this selector.
        // Collecting page source and element rects for every single action is too CPU-intensive.
        // A fingerprint stored without a usable path, or without anything
        // that says which element it is (all learnt ones through 2.14), is
        // learnt again, once per selector per process, so the Resilio tier
        // gets its path and Fuzzy XML can use it.
        const existing = await etalonService.getSignature(selector);
        const complete =
          existing && isResilioPath(existing.path) && hasIdentity(existing.attributes);
        if (existing && (complete || this.relearnt.has(selector))) {
          this.log.debug(`[Learning] Etalon already exists for selector: ${selector}. Skipping...`);
          return;
        }
        if (existing) this.rememberRelearnt(selector);

        const nodeAttrs: { name: string; value: string }[] = [];

        // The WebDriver command is getAttribute(name, elementId). Through
        // 2.14 this asked for getElementAttribute, which neither UiAutomator2
        // nor XCUITest has, so no attribute was ever read. Only the attributes
        // the driver has are asked for, and "null" (UiAutomator2's answer for
        // one the element hasn't set) isn't kept.
        for (const attr of attributesToLearn(driver?.caps?.platformName)) {
          try {
            const val = await driver.getAttribute(attr, elementId);
            if (meaningful(val)) nodeAttrs.push({ name: attr, value: val });
          } catch (e) {
            // Silently ignore: attribute may not exist or be inaccessible
          }
        }

        // Capture spatial coordinates from element rect for position-based healing
        try {
          const rect = await driver.getElementRect(elementId);
          if (rect) {
            if (rect.x !== undefined)
              nodeAttrs.push({ name: 'x', value: String(Math.round(rect.x)) });
            if (rect.y !== undefined)
              nodeAttrs.push({ name: 'y', value: String(Math.round(rect.y)) });
            if (rect.width !== undefined)
              nodeAttrs.push({ name: 'width', value: String(Math.round(rect.width)) });
            if (rect.height !== undefined)
              nodeAttrs.push({ name: 'height', value: String(Math.round(rect.height)) });
          }
        } catch (e) {
          // Silently ignore: rect capture is optional
        }

        let nodeName = 'XCUIElementTypeAny'; // Default for IOS, will be overridden
        try {
          if (typeof driver.getElementTagName === 'function') {
            nodeName = (await driver.getElementTagName(elementId)) || nodeName;
          } else if (typeof driver.getName === 'function') {
            nodeName = (await driver.getName(elementId)) || nodeName;
          } else {
            // Check if it's android or ios to provide a better default
            const caps = await driver.getCapabilities();
            const platform = (caps.platformName || caps.platform || 'ios').toLowerCase();
            nodeName = platform === 'android' ? 'android.view.View' : 'XCUIElementTypeAny';
          }
        } catch (e) {
          this.log.debug(
            `[Learning] Failed to get tag name for element ${elementId}. Using default.`,
          );
        }

        // Final safety check to ensure nodeName is a valid string
        if (!nodeName) nodeName = 'Unknown';

        // The element's path through the page source, for the Resilio tier:
        // the element there that has the most of the attributes just read,
        // and none when two have as many.
        let resiliotreePathJson: any = null;
        try {
          const pageSource = await driver.getPageSource();
          const element = findLearntElement(pageSource, nodeName, nodeAttrs);
          resiliotreePathJson = element ? resilioPathOf(element, pageSource) : null;
        } catch (e) {
          // Silently ignore: path capture is optional for learning
        }

        await etalonService.saveSignature(
          strategy,
          selector,
          { nodeName, attributes: nodeAttrs },
          resiliotreePathJson,
        );
      } catch (err: any) {
        this.log.debug(`[Learning] Failed: ${err.message}`);
      } finally {
        this.learningSessions.delete(sessionId);
      }
    })();
  }

  /**
   * A heal of a command a hub sent goes back to the hub, which owns the
   * session's record (healReport.ts); this server records any other.
   */
  private async recordHeal(
    sessionId: string,
    commandName: string,
    driver: any,
    args: any[],
    healed: any,
  ) {
    const reported = reportHeal(this.healReportOf(args, healed));
    if (reported === 'reported') return;
    if (reported === 'too-long') {
      // The session is the hub's: this server has no record to write it to.
      this.log.warn(
        `[Interceptor] The heal of ${args[0]}=${args[1]} is too long to send to the hub; it isn't recorded.`,
      );
      return;
    }
    await this.logHealingEvent(sessionId, commandName, driver, args, healed);
  }

  private healReportOf(args: any[], healed: any): HealReport {
    return {
      originalSelector: args[1],
      originalStrategy: args[0],
      healedSelector: healed.recommendedSelector,
      healedStrategy: healed.recommendedStrategy ?? args[0],
      confidence: healed.confidence,
      tier: healed.tier,
    };
  }

  private async logHealingEvent(
    sessionId: string,
    commandName: string,
    driver: any,
    args: any[],
    healed: any,
  ) {
    await DASHBORD_EVENT_MANAGER.afterSessionCommand(
      sessionId,
      commandName,
      driver,
      {
        body: args,
        method: 'POST',
        path: `/${commandName}`,
        originalUrl: `/${commandName}`,
      } as any,
      {} as any,
      JSON.stringify({ value: { ELEMENT: healed.id }, sessionId }),
      this.healReportOf(args, healed),
    );
  }
}
