import { z } from 'zod';
import { AUTH_TOKEN_PARAM, defineTool } from '../tool';
import { invokeApi } from '../invokeApi';
import { answerOf } from '../toolCall';

/**
 * The healing tools, ported from Xenon Studio's `appium-mcp-plugin`
 * (`src/tools/analytics.ts`) with its names, descriptions and arguments.
 * `authToken` is accepted and ignored: the caller is the one `/xenon/mcp`
 * signed in.
 */

/** A `GET /healing/events` event, as far as the tool reads it. */
interface BackendHealingEvent {
  originalSelector: string;
  healedSelector?: string | null;
  confidence: number;
  /** A tier name ('Resilio', 'Fuzzy XML', 'OCR', 'Visual AI', 'LLM', ...), nullable. */
  tier: string | null;
  isSuccess: boolean;
  createdAt: string;
}

/** An event as `xenon_healing_events` answers it (Studio's shape). */
interface HealingEventOutput {
  selector: string;
  tier: string | null;
  healedSelector?: string | null;
  confidence: number;
  isSuccess: boolean;
  createdAt: string;
}

const selectorHealthParams = z.object({
  authToken: AUTH_TOKEN_PARAM,
  appId: z.string().optional().describe('Not used yet: selectors of every app are answered.'),
  selector: z
    .string()
    .optional()
    .describe('Only this selector, matched exactly as the test wrote it.'),
  limit: z.number().optional().describe('At most this many selectors.'),
});

const healingEventsParams = z.object({
  authToken: AUTH_TOKEN_PARAM,
  sessionId: z
    .string()
    .describe("The Appium session's id, as the create-session call answered it."),
});

/** `xenon_selector_health`: `GET /healing/selector-health` as the caller. */
export const selectorHealthTool = defineTool({
  name: 'xenon_selector_health',
  scope: 'xenon:analytics:read',
  description:
    'Get selector health analytics data, optionally filtered by selector (exact match) ' +
    'and limit. Returns {selector,strategy,healCount,topTier,suggestedRewrite?,state?,' +
    'lastHealedAt?,etalonAge?} for each matching selector. topTier is a string tier name ' +
    "('Resilio', 'Fuzzy XML', 'OCR', 'Visual AI', 'LLM', 'Native', 'Unknown'), nullable — " +
    'not a number. Note: the appId param is accepted but currently ignored by the backend ' +
    '(filtering by app is deferred). Note: failRate field is not included (data not yet ' +
    'available; deferred).',
  params: selectorHealthParams,
  annotations: { readOnlyHint: true, destructiveHint: false },
  async run(args, caller) {
    const query: Record<string, string> = {};
    if (args.appId !== undefined) query.appId = args.appId;
    if (args.selector !== undefined) query.selector = args.selector;
    if (args.limit !== undefined) query.limit = String(args.limit);
    return answerOf(
      await invokeApi(caller, { method: 'GET', path: '/healing/selector-health', query }),
    );
  },
});

/**
 * `xenon_healing_events`: a session's heals, from `GET /healing/events`.
 *
 * The session is looked up first with `GET /session/:id`, so a session the
 * caller may not see (another team's phone) or one that doesn't exist gets
 * that route's not-found answer. `/healing/events` alone answers such a
 * session with no heals, which an agent would read as a clean run.
 */
export const healingEventsTool = defineTool({
  name: 'xenon_healing_events',
  scope: 'xenon:analytics:read',
  description:
    'Get healing events for a specific session, returning per-event records with ' +
    '{selector:originalSelector,tier,healedSelector?,confidence,isSuccess,createdAt}. ' +
    "tier is a string tier name ('Resilio', 'Fuzzy XML', 'OCR', 'Visual AI', 'LLM', " +
    "'Native', 'Unknown'), nullable — not a number. " +
    'Note: tierTried[] (per-attempt tier sequence) and durationMs are not included ' +
    '(only available in OTel spans, not persisted; deferred).',
  params: healingEventsParams,
  annotations: { readOnlyHint: true, destructiveHint: false },
  async run(args, caller) {
    answerOf(
      await invokeApi(caller, {
        method: 'GET',
        path: `/session/${encodeURIComponent(args.sessionId)}`,
      }),
    );
    const response: { events: BackendHealingEvent[] } = answerOf(
      await invokeApi(caller, {
        method: 'GET',
        path: '/healing/events',
        query: { sessionId: args.sessionId },
      }),
    );
    return response.events.map((e) => {
      const output: HealingEventOutput = {
        selector: e.originalSelector,
        tier: e.tier,
        confidence: e.confidence,
        isSuccess: e.isSuccess,
        createdAt: e.createdAt,
      };
      if (e.healedSelector !== undefined) output.healedSelector = e.healedSelector;
      return output;
    });
  },
});
