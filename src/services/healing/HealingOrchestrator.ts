import { Service } from 'typedi';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import log from '../../logger';
import { HealedElement, HealingContext, HealingProvider } from './types';
import { FuzzyXmlHealingProvider } from './FuzzyXmlHealingProvider';
import { OcrHealingProvider } from './OcrHealingProvider';
import { VisualAiHealingProvider } from './VisualAiHealingProvider';
import { LlmHealingProvider } from './LlmHealingProvider';
import { HealEtalonService } from './HealEtalonService';
import { ResilioTreeHealingProvider } from './ResilioTreeHealingProvider';
import { resilioPathOf } from './resilioPath';
import { HEALING_METRICS } from './HealingMetrics';
import { ATTR } from '../telemetry/attributes';
import { OPTION_NAMESPACES, isOptionsObject, xenonOptionsIn } from '../session/xenonOptions';
import { screenScaleOf, toDriverRect } from '../omni-vision/screenScale';

// §2.7 healing-tier capability gate. The tier numbering here is the
// externally-facing capability contract (xe:options.healingTiers),
// which is array-position based: providers[i] is tier i+1 (1=Resilio,
// 2=Fuzzy XML, 3=OCR, 4=Visual AI, 5=LLM). Tier 0 is the original/native
// selector — it's implicit and never appears in the providers array, so
// it needs no filtering. This is deliberately decoupled from the internal
// HealingTier enum (whose numeric values don't line up 1:1 with position,
// e.g. Resilio's enum value is 0), so the capability contract stays a
// simple, stable 1-5 list regardless of internal enum churn.
export function filterProvidersByTier(
  providers: HealingProvider[],
  allowedTiers?: number[],
): HealingProvider[] {
  if (allowedTiers === undefined) return providers;
  const allowed = new Set(allowedTiers);
  return providers.filter((_, index) => allowed.has(index + 1));
}

// The tiers that run on this server: Resilio, Fuzzy XML and OCR. Visual AI (4)
// and the LLM (5) send the screenshot and the page source to the AI provider.
export const LOCAL_HEALING_TIERS: readonly number[] = [1, 2, 3];

const isHealingTierList = (raw: unknown): raw is number[] =>
  Array.isArray(raw) && raw.every((t) => Number.isInteger(t) && t >= 1 && t <= 5);

// Coerce the raw xe:options.healingTiers capability value into the
// allowedTiers argument for attemptHealing. The value is a privacy control (a
// session leaves out 4 and 5 to keep its screen away from the AI provider), so
// one that can't be read fails closed for the AI tiers and open for the rest:
// - not set (or null): every tier (undefined);
// - a list of tier numbers 1 to 5: exactly those, and [] none;
// - anything else ("1,2", ["1","2"], [1, 6], ...): LOCAL_HEALING_TIERS.
// Through 2.14 [], or a value that wasn't a list or had no numbers in it, ran
// every tier, the AI ones included; a list that held some numbers ran those
// and skipped the rest ([1, 6] ran tier 1, [6] none).
export function coerceHealingTiersCap(raw: unknown): number[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  return isHealingTierList(raw) ? [...raw] : [...LOCAL_HEALING_TIERS];
}

// The allowedTiers a session asked for, read from its capabilities (one flat
// map: the session's driver's caps): xe:options.healingTiers, or the
// xenon:options alias's, coerced as above. A namespace that isn't an object
// can't be read either: xenonOptionsIn skips it, which would run every tier.
// `unreadable` says what couldn't be read, for the log.
export function healingTiersFromCaps(caps: unknown): {
  tiers: number[] | undefined;
  unreadable?: string;
} {
  for (const namespace of OPTION_NAMESPACES) {
    const bag = isOptionsObject(caps) ? caps[namespace] : undefined;
    if (bag !== undefined && bag !== null && !isOptionsObject(bag)) {
      return {
        tiers: [...LOCAL_HEALING_TIERS],
        unreadable: `${namespace} is ${JSON.stringify(bag)}, not an object`,
      };
    }
  }
  const raw = xenonOptionsIn(caps).healingTiers;
  const tiers = coerceHealingTiersCap(raw);
  return tiers === undefined || isHealingTierList(raw)
    ? { tiers }
    : {
        tiers,
        unreadable: `healingTiers is ${JSON.stringify(raw)}, not a list of tier numbers from 1 to 5`,
      };
}

@Service()
export class HealingOrchestrator {
  private logger = log.scope('HealingOrchestrator');
  private providers: HealingProvider[] = [];

  constructor(private etalonService: HealEtalonService) {
    this.providers = [
      new ResilioTreeHealingProvider(this.etalonService),
      new FuzzyXmlHealingProvider(this.etalonService),
      new OcrHealingProvider(),
      new VisualAiHealingProvider(),
      new LlmHealingProvider(),
    ];
  }

  async attemptHealing(
    sessionId: string,
    driver: any,
    strategy: string,
    selector: string,
    allowedTiers?: number[],
  ): Promise<HealedElement | null> {
    // §2.7: when the session's xe:options.healingTiers capability is set,
    // restrict dispatch to the allowed tier indices; absent -> unchanged.
    const activeProviders = filterProvidersByTier(this.providers, allowedTiers);
    if (activeProviders.length === 0) {
      // Nothing to run, so nothing is collected either: no screenshot taken.
      this.logger.info(
        `Session ${sessionId} allows no self-healing tier; ${strategy}=${selector} is not healed.`,
      );
      return null;
    }

    this.logger.info(
      `🚨 Self-Healing triggered for session ${sessionId}. Broken locator: ${strategy}=${selector}`,
    );

    // Span wraps the whole attempt. Original selector text is intentionally
    // kept off the span — high cardinality (long XPath strings) would explode
    // Loki labels and Tempo storage. The strategy alone is a low-cardinality
    // signal that's still useful for "which strategies break most often."
    // Tracer is fetched per-call so test stubs of trace.getTracer take effect.
    const span = trace.getTracer('xenon.healing').startSpan('xenon.healing.attempt', {
      attributes: {
        [ATTR.SESSION_ID]: sessionId,
        [ATTR.HEALING_ORIGINAL_STRATEGY]: strategy,
      },
    });
    const attemptStart = Date.now();

    // Preparation: Collect data required for healing
    // Note: We do this once to avoid multiple expensive round-trips
    const context: HealingContext = { sessionId, driver, strategy, selector };

    try {
      this.logger.debug('Collecting page source and screenshot for analysis...');
      const [xml, screenshot] = await Promise.all([driver.getPageSource(), driver.getScreenshot()]);
      context.pageSource = xml;
      context.screenshotBase64 = screenshot;
    } catch (err: any) {
      this.logger.error(`Failed to collect healing context: ${err.message}`);
      span.addEvent('context_collection_failed', { error: err.message });
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'context_collection_failed' });
      span.end();
      return null;
    }

    // Tiered Execution: Try providers in order of cost/complexity.
    for (const provider of activeProviders) {
      const tierStart = Date.now();
      span.addEvent('tier_started', { tier: provider.name });
      try {
        this.logger.info(`Attempting Tier ${provider.tier}: ${provider.name}...`);
        let result = await provider.heal(context);
        if (result?.rect) {
          result = await this.rectInDriverCoordinates(result, result.rect, context, provider);
        }
        HEALING_METRICS.record(
          provider.tier,
          provider.name,
          result ? 'success' : 'failure',
          Date.now() - tierStart,
        );

        if (result) {
          this.logger.info(
            `✨ Provider ${provider.name} found a match! Confidence: ${(
              result.confidence * 100
            ).toFixed(0)}%`,
          );

          // Tier 1/2 Optimization: Stability Verification Loop
          // We try all candidates to see which one is the most stable (semantic vs absolute)
          let stabilityAttempted = false;
          let stabilityVerified = false;
          if (result.candidateSelectors && result.candidateSelectors.length > 0) {
            stabilityAttempted = true;
            this.logger.debug(
              `Verifying ${result.candidateSelectors.length} candidate locators for stability...`,
            );
            for (const candidate of result.candidateSelectors) {
              try {
                const elements = await context.driver.findElements('xpath', candidate);
                if (elements.length === 1) {
                  this.logger.info(`🎯 Verified stable & unique locator: ${candidate}`);
                  result.recommendedSelector = candidate;
                  stabilityVerified = true;
                  break; // Found a unique stable locator
                } else if (elements.length > 1) {
                  this.logger.debug(
                    `⚠️ Candidate locator is not unique (${elements.length} matches): ${candidate}`,
                  );
                }
              } catch (e) {
                this.logger.debug(`Candidate locator check failed: ${candidate}`);
              }
            }
          }

          // Principal Learning: Autonomously update the etalon to prevent future failures.
          // Gate on stability: if the provider emitted candidate selectors but none of them
          // resolved to a unique element, the structural guess was wrong and we must not
          // persist it — that's how lucky LLM/fuzzy-XML guesses poison future sessions.
          // Providers that emit no candidates (OCR/Visual) can't be verified this way, so
          // they still learn on confidence alone.
          if (stabilityAttempted && !stabilityVerified) {
            this.logger.warn(
              `Skipping etalon save for ${selector}: ${result.candidateSelectors!.length} candidate locator(s) attempted, none verified unique (provider=${provider.name}, confidence=${result.confidence})`,
            );
          } else if (result.confidence > 0.7 && result.node) {
            try {
              this.logger.info(`🧠 Learning from healing success: updating etalon for ${selector}`);

              // The healed element's path through the page source, for the
              // Resilio tier. Through 2.14 this built it from the healed node
              // with resiliotree, which an xmldom element (every node a tier
              // returns) can't be, so it was always null.
              const learnedPath = resilioPathOf(result.node, context.pageSource ?? '');

              await this.etalonService.saveSignature(strategy, selector, result.node, learnedPath);
            } catch (learnErr: any) {
              // Warn (not debug) so the loss of learning shows up in default logs —
              // a silent failure here means the same selector keeps needing the LLM tier.
              this.logger.warn(
                `Etalon save failed after healing [strategy=${strategy}, selector=${selector}, confidence=${result.confidence}]: ${learnErr.message}`,
              );
            }
          }

          span.addEvent('tier_succeeded', {
            tier: provider.name,
            confidence: result.confidence,
          });
          span.setAttributes({
            [ATTR.HEALING_TIER]: provider.name,
            [ATTR.HEALING_CONFIDENCE]: result.confidence,
            [ATTR.HEALING_RESULT_STRATEGY]: result.recommendedStrategy ?? 'xpath',
            [ATTR.HEALING_DURATION_MS]: Date.now() - attemptStart,
          });
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return result;
        }
        span.addEvent('tier_failed', { tier: provider.name });
      } catch (err: any) {
        HEALING_METRICS.record(provider.tier, provider.name, 'failure', Date.now() - tierStart);
        this.logger.error(`Provider ${provider.name} failed: ${err.message}`);
        span.addEvent('tier_failed', { tier: provider.name, error: err.message });
      }

      // Provider-driven short-circuit: a tier can advise that no downstream
      // tier can plausibly succeed (e.g. missing prerequisites that all
      // share). Saves an expensive LLM round-trip when upstream context
      // collection failed.
      if (provider.shouldSkipRemaining?.(context)) {
        this.logger.warn(
          `Tier ${provider.tier} (${provider.name}) advised skipping remaining tiers for selector=${selector}`,
        );
        HEALING_METRICS.recordSkippedRemaining(provider.tier, provider.name);
        span.addEvent('tier_skipped_remaining', { tier: provider.name });
        break;
      }
    }

    HEALING_METRICS.recordAllTiersFailed();
    this.logger.warn(`❌ All healing tiers failed for selector: ${selector}`);
    span.addEvent('all_tiers_failed');
    span.setAttributes({
      [ATTR.HEALING_DURATION_MS]: Date.now() - attemptStart,
    });
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'all_tiers_failed' });
    span.end();
    return null;
  }

  /**
   * The OCR and Visual AI tiers find the element in the screenshot, so their
   * `rect` is in its pixels. The interceptor returns a virtual element there,
   * which a click taps in the driver's coordinates (points on iOS), so it is
   * converted here. If that can't be worked out on iOS, a virtual element
   * (only a position) is no use and the tier counts as failed; a real element
   * the tier resolved keeps its id and loses only the rect.
   */
  private async rectInDriverCoordinates(
    result: HealedElement,
    rect: NonNullable<HealedElement['rect']>,
    context: HealingContext,
    provider: HealingProvider,
  ): Promise<HealedElement | null> {
    try {
      const scale = await screenScaleOf(context.driver, context.screenshotBase64 ?? '');
      return { ...result, rect: toDriverRect(rect, scale) };
    } catch (err: any) {
      const reason = err?.message ?? err;
      if (!result.id.startsWith('healed_')) {
        this.logger.warn(`${provider.name}: the element's position is unknown (${reason}).`);
        return { ...result, rect: undefined };
      }
      this.logger.warn(
        `${provider.name} found the element in the screenshot, but not where it is on the ` +
          `screen (${reason}); trying the next tier.`,
      );
      return null;
    }
  }
}
