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
import { HEALING_METRICS } from './HealingMetrics';
import { ATTR } from '../telemetry/attributes';

// §2.7 healing-tier capability gate. The tier numbering here is the
// externally-facing capability contract (xenon:options.healingTiers),
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

// Coerce the raw xenon:options.healingTiers capability value into the
// allowedTiers argument for attemptHealing. Fail-open contract (Phase 2a
// review fix): a malformed cap must RUN ALL tiers, never silently disable
// healing. Pre-fix, an all-non-numeric array (e.g. ["1","2"]) filtered to []
// which filterProvidersByTier turned into "no providers" — healing silently
// off. Now any coercion that yields no numeric tiers (non-array, all-non-
// numeric, or an explicitly-empty []) returns undefined → run all tiers.
// The cap is meant to restrict healing, not disable it, so an explicit []
// opting out of healing entirely is deliberately NOT supported.
export function coerceHealingTiersCap(raw: unknown): number[] | undefined {
  const nums = Array.isArray(raw) ? raw.filter((t: any) => typeof t === 'number') : undefined;
  return nums && nums.length === 0 ? undefined : nums;
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
    // §2.7: when the session's xenon:options.healingTiers capability is set,
    // restrict dispatch to the allowed tier indices; absent -> unchanged.
    const activeProviders = filterProvidersByTier(this.providers, allowedTiers);
    for (const provider of activeProviders) {
      const tierStart = Date.now();
      span.addEvent('tier_started', { tier: provider.name });
      try {
        this.logger.info(`Attempting Tier ${provider.tier}: ${provider.name}...`);
        const result = await provider.heal(context);
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

              // Recalculate path for ResilioTree if node is available
              let learnedPath: any = null;
              if (result.node) {
                try {
                  const { Path } = await import('resiliotree');
                  const pathNodes: any[] = [];
                  let curr: any = result.node;
                  while (curr) {
                    pathNodes.unshift(curr);
                    curr = curr.parent || curr.parentNode;
                  }
                  learnedPath = new Path(pathNodes).toJSON();
                } catch {
                  // resiliotree import is best-effort; learnedPath stays null
                }
              }

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
}
