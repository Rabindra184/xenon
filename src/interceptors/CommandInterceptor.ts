import { Container, Service } from 'typedi';
import { Span } from '@opentelemetry/api';
import { TracingService } from '../services/TracingService';
import { DASHBORD_EVENT_MANAGER } from '../dashboard/event-manager';
import { SESSION_MANAGER } from '../sessions/SessionManager';
import {
  HealingOrchestrator,
  coerceHealingTiersCap,
} from '../services/healing/HealingOrchestrator';
import { HealEtalonService } from '../services/healing/HealEtalonService';
import { OmniVisionService } from '../services/omni-vision/OmniVisionService';
import { AICommandService } from '../services/AICommandService';
import log from '../logger';
import { sessionContext } from '../logging/sessionContext';
import { ProcessMetricsService } from '../services/ProcessMetricsService';
import { IPluginArgs } from '../interfaces/IPluginArgs';
import { AutowaitService } from '../services/autowait/AutowaitService';
import { waitFor } from '../services/autowait/waitFor';

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
            const instruction =
              typeof scriptArgs === 'string'
                ? scriptArgs
                : typeof scriptArgs === 'object' && scriptArgs?.instruction
                  ? scriptArgs.instruction
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

        const shouldProceed = await DASHBORD_EVENT_MANAGER.beforeSessionCommand(
          sessionId,
          commandName,
          { body: { script: args[0], args: args[1] } } as any,
          {
            status: () => ({ json: (d: any) => d }),
            setHeader: () => {},
            getHeader: () => {},
          } as any,
        );

        if (shouldProceed === false) {
          return null;
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
      const elementCommands = [
        'click',
        'getElementRect',
        'getElementLocation',
        'getElementSize',
        'getText',
        'setValue',
        'elementDisplayed',
        'elementEnabled',
      ];
      if (elementCommands.includes(commandName)) {
        const elementId = args[0];
        if (
          typeof elementId === 'string' &&
          (elementId.startsWith('omni_') ||
            elementId.startsWith('healed_ocr') ||
            elementId.startsWith('healed_visual'))
        ) {
          return await this.handleVirtualElementCommand(
            sessionId,
            driver,
            commandName,
            elementId,
            args[1],
          );
        }
      }

      // --- AUTOWAIT: pre-action elementEnabled check for click/setValue/clear ---
      // Mirrors appium-wait-plugin behavior; runs before native command so
      // a NotEnabled state surfaces as a wait-then-retry rather than an
      // immediate failure. Skips elements managed by other Xenon subsystems.
      const autowait = Container.get(AutowaitService).getProps(sessionId, pluginArgs);
      if (
        autowait.enabled &&
        ['click', 'setValue', 'clear'].includes(commandName) &&
        !autowait.excludeEnabledCheck.includes(commandName) &&
        typeof args[0] === 'string' &&
        !args[0].startsWith('omni_') &&
        !args[0].startsWith('healed_')
      ) {
        await this.waitForElementEnabled(driver, args[0], autowait);
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
          await this.runPostCommandHooks(
            sessionId,
            commandName,
            driver,
            args,
            response,
            pluginArgs,
          );
        }
        return response;
      }

      const response = await next();

      if (isHub && !!pluginArgs.enableDashboard && SESSION_MANAGER.isValidSession(sessionId)) {
        await this.runPostCommandHooks(sessionId, commandName, driver, args, response, pluginArgs);
      }

      return response;
    } catch (error: any) {
      if (
        this.isNoSuchElementError(error) &&
        ['findElement', 'findElements'].includes(commandName) &&
        (pluginArgs.enableSelfHealing as boolean) !== false
      ) {
        // §2.7 healing-tier capability gate: a session created with
        // xenon:options.healingTiers restricts self-healing to those tier
        // indices (1=Resilio, 2=Fuzzy XML, 3=OCR, 4=Visual AI, 5=LLM).
        // Every optional hop is guarded — a missing/unrecoverable session,
        // capability, or malformed value all fall back to "run all tiers"
        // (fail open). coerceHealingTiersCap enforces that: an all-non-numeric
        // array (e.g. ["1","2"]) or an empty [] coerces to undefined instead
        // of [] — pre-fix, [] silently disabled healing entirely.
        const rawHealingTiers = SESSION_MANAGER.getSession(sessionId)?.getCapabilities()?.[
          'xenon:options'
        ]?.healingTiers;
        const allowedHealingTiers = coerceHealingTiersCap(rawHealingTiers);

        const healed = await Container.get(HealingOrchestrator).attemptHealing(
          sessionId,
          driver,
          args[0],
          args[1],
          allowedHealingTiers,
        );
        if (healed) {
          await this.logHealingEvent(sessionId, commandName, driver, args, healed);

          let finalId = healed.id;

          // OCR/Visual AI tiers return virtual IDs with rect coordinates
          // We need to resolve a REAL element that Appium can interact with
          if (healed.id.startsWith('healed_') && healed.rect) {
            // REGISTER the virtual element for subsequent state checks
            Container.get(OmniVisionService).addVirtualElement({
              id: healed.id,
              rect: healed.rect,
              confidence: healed.confidence,
              text: healed.message,
            });

            this.log.info(
              `[Interceptor] Visual healing returned coordinates. Resolving real element at (${healed.rect.x}, ${healed.rect.y})...`,
            );

            let resolved = false;

            // Strategy 1: Try to find element at the center of the detected area
            try {
              const cx = Math.round(healed.rect.x + healed.rect.width / 2);
              const cy = Math.round(healed.rect.y + healed.rect.height / 2);
              const touchEl = await driver.findElement(
                '-ios class chain',
                `**/XCUIElementTypeAny[\`rect.x <= ${cx} AND rect.x + rect.width >= ${cx} AND rect.y <= ${cy} AND rect.y + rect.height >= ${cy}\`]`,
              );
              if (touchEl) {
                finalId =
                  touchEl.ELEMENT || touchEl['element-6066-11e4-a52e-4f735466cecf'] || finalId;
                resolved = !!finalId && !finalId.startsWith('healed_');
              }
            } catch (e) {
              // Strategy 1 failed
            }

            // Strategy 2: Use coordinate tap action (W3C Actions API)
            if (!resolved) {
              this.log.info(
                '[Interceptor] Falling back to coordinate-based tap for visual healing',
              );
              try {
                const cx = Math.round(healed.rect.x + healed.rect.width / 2);
                const cy = Math.round(healed.rect.y + healed.rect.height / 2);
                await driver.performActions([
                  {
                    type: 'pointer',
                    id: 'xenon-heal-tap',
                    parameters: { pointerType: 'touch' },
                    actions: [
                      { type: 'pointerMove', duration: 0, x: cx, y: cy },
                      { type: 'pointerDown', button: 0 },
                      { type: 'pause', duration: 100 },
                      { type: 'pointerUp', button: 0 },
                    ],
                  },
                ]);
                await driver.releaseActions();
                this.log.info(`[Interceptor] ✅ Visual healing: tapped at (${cx}, ${cy})`);
                // Return the virtual ID — the tap already happened
              } catch (tapErr: any) {
                this.log.error(`[Interceptor] Coordinate tap failed: ${tapErr.message}`);
              }
            }
          }

          const elementResponse = {
            ELEMENT: finalId,
            'element-6066-11e4-a52e-4f735466cecf': finalId,
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

  private async runPostCommandHooks(
    sessionId: string,
    commandName: string,
    driver: any,
    args: any[],
    response: any,
    pluginArgs: IPluginArgs,
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

      if (
        commandName === 'findElement' &&
        response &&
        (pluginArgs.enableSelfHealing as boolean) !== false
      ) {
        this.triggerLearning(driver, args, response, sessionId);
      }
    } catch (postCommandErr: any) {
      this.log.warn(`[Interceptor] Post-command hooks failed: ${postCommandErr.message}`);
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
    const appiumResults = results.map((r) => ({
      ELEMENT: r.id,
      'element-6066-11e4-a52e-4f735466cecf': r.id,
    }));
    if (commandName === 'findElement') {
      if (appiumResults.length === 0)
        throw new Error('NoSuchElement: AI Vision failed to find matching element');
      return appiumResults[0];
    }
    return appiumResults;
  }

  private async handleVirtualElementCommand(
    sessionId: string,
    driver: any,
    commandName: string,
    elementId: string,
    value?: any,
  ) {
    const omniService = Container.get(OmniVisionService);
    const element = omniService.getVirtualElement(elementId);
    if (!element) throw new Error(`NoSuchElement: Virtual element ${elementId} not found`);

    const centerX = Math.round(element.rect.x + element.rect.width / 2);
    const centerY = Math.round(element.rect.y + element.rect.height / 2);

    switch (commandName) {
      case 'click':
        await driver.performActions([
          {
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x: centerX, y: centerY },
              { type: 'pointerDown', button: 0 },
              { type: 'pause', duration: 100 },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ]);
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
        return element.text || '';
      case 'setValue':
        await driver.performActions([
          {
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x: centerX, y: centerY },
              { type: 'pointerDown', button: 0 },
              { type: 'pause', duration: 100 },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ]);
        try {
          return await driver.setValue(elementId, value);
        } catch (e: any) {
          this.log.error(
            `setValue failed for virtual element ${elementId} on session ${sessionId}: ${e.message}`,
          );
          throw e;
        }
      default:
        throw new Error(`Command ${commandName} not supported for visual elements`);
    }
  }

  private learningSessions: Set<string> = new Set();

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
        const existing = await etalonService.getSignature(selector);
        if (existing) {
          this.log.debug(`[Learning] Etalon already exists for selector: ${selector}. Skipping...`);
          return;
        }

        const anchors = [
          'content-desc',
          'resource-id',
          'text',
          'name',
          'id',
          'hint',
          'label',
          'value', // iOS-specific identity attributes
        ];
        const nodeAttrs: { name: string; value: string }[] = [];

        for (const attr of anchors) {
          try {
            const val = await driver.getElementAttribute(elementId, attr);
            if (val) nodeAttrs.push({ name: attr, value: val });
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

        // Path capture logic
        let resiliotreePathJson: any = null;
        try {
          const { JSDOMParser, Path } = await import('resiliotree');
          const pageSource = await driver.getPageSource();
          const rootNode = new JSDOMParser().parse(pageSource);
          const foundNode = this.findMatchingNode(rootNode, nodeName, nodeAttrs);
          if (foundNode) {
            const pathNodes: any[] = [];
            let curr: any = foundNode;
            while (curr) {
              pathNodes.unshift(curr);
              curr = curr.parent;
            }
            resiliotreePathJson = new Path(pathNodes).toJSON();
          }
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

  private findMatchingNode(
    root: any,
    tag: string,
    attributes: { name: string; value: string }[],
  ): any {
    const attrMap = new Map(attributes.map((a) => [a.name.toLowerCase(), a.value]));
    const queue = [root];
    while (queue.length > 0) {
      const node = queue.shift();
      if (node.tag.toLowerCase() === tag.toLowerCase()) {
        let matchCount = 0;
        for (const [name, value] of attrMap) {
          if (
            node.otherAttributes.get(name) === value ||
            node.id === value ||
            node.classes.has(value)
          )
            matchCount++;
        }
        if (matchCount > 0) return node;
      }
      if (node.children) queue.push(...node.children);
    }
    return null;
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
      {
        originalSelector: args[1],
        originalStrategy: args[0],
        healedSelector: healed.recommendedSelector,
        healedStrategy: healed.recommendedStrategy ?? args[0],
        confidence: healed.confidence,
        tier: healed.tier,
      },
    );
  }
}
