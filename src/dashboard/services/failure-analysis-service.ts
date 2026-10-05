import { prisma } from '../../prisma';
import log from '../../logger';
import { categorizeFailure, commandErrorOf } from './failureCategories';

/**
 * How many failed sessions' AI analyses run at once (explainSessionFailure);
 * the others wait their turn. They run after their sessions have ended, so
 * nothing else limits them: a broken build on a big lab ends hundreds of
 * failed sessions in minutes, and each analysis holds a screenshot while it
 * runs. Few at once also spares the provider's rate limit.
 */
export const MAX_CONCURRENT_FAILURE_ANALYSES = 4;

/** Each session's analysis, waiting or running, so one session gets one. */
const analyses = new Map<string, Promise<void>>();
let analysesRunning = 0;
const analysesWaiting: Array<() => void> = [];

async function analysisTurn(): Promise<void> {
  if (analysesRunning < MAX_CONCURRENT_FAILURE_ANALYSES) {
    analysesRunning++;
    return;
  }
  // The turn is handed over by endAnalysisTurn, still counted as running.
  await new Promise<void>((resolve) => analysesWaiting.push(resolve));
}

function endAnalysisTurn(): void {
  const next = analysesWaiting.shift();
  if (next) next();
  else analysesRunning--;
}

/**
 * Files a failed session under a category (`failure_category`) by its failure
 * reason and its last five failed commands' errors (categorizeFailure, in
 * failureCategories.ts). Rules only, so it is quick: a session's end waits for
 * it. Never throws.
 */
export async function categorizeSessionFailure(sessionId: string): Promise<void> {
  try {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        SessionLog: { where: { is_error: true }, take: 5, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!session) return;

    const category = categorizeFailure(
      session.failure_reason || '',
      session.SessionLog.map((l) => commandErrorOf(l.response)),
    );
    log.info(`[FailureAnalysis] Session ${sessionId} identified as ${category}`);

    await prisma.session.update({
      where: { id: sessionId },
      data: { failure_category: category },
    });
  } catch (err: any) {
    log.error(`[FailureAnalysis] Failed to analyze session ${sessionId}: ${err.message}`);
  }
}

/**
 * Asks the AI provider why a failed session failed, and saves the answer
 * (`ai_analysis`). Only an answer is saved: with no provider, a rate limit, a
 * time-out (FAILURE_ANALYSIS_TIMEOUT_MS) or a failed call nothing is written,
 * and an analysis saved earlier stays. Never rejects.
 *
 * A session's end doesn't wait for it (onSessionStopped): an AI call can take
 * minutes, and the client's quit, or a hub's DELETE, waits for the end. At
 * most MAX_CONCURRENT_FAILURE_ANALYSES run at once, and a session whose
 * analysis is waiting or running gets that one (a session can end twice: a
 * crash, then the client's delete).
 */
export function explainSessionFailure(sessionId: string): Promise<void> {
  const pending = analyses.get(sessionId);
  if (pending) return pending;
  const analysis = (async () => {
    await analysisTurn();
    try {
      await explain(sessionId);
    } finally {
      endAnalysisTurn();
    }
  })().finally(() => analyses.delete(sessionId));
  analyses.set(sessionId, analysis);
  return analysis;
}

async function explain(sessionId: string): Promise<void> {
  try {
    const { AI_SERVICE } = await import('../../services/AIService');
    if (!AI_SERVICE.isEnabled()) return;

    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) return;

    const lastLogs = await prisma.log.findMany({
      where: { session_id: sessionId, log_type: 'DEVICE' },
      take: 50,
      orderBy: { timestamp: 'desc' },
    });

    const lastCommands = await prisma.sessionLog.findMany({
      where: { session_id: sessionId },
      take: 10,
      orderBy: { createdAt: 'desc' },
    });

    // Find the last screenshot in logs
    const lastScreenshotLog = lastCommands.find((l) => l.screenshot !== null);

    const aiAnalysis = await AI_SERVICE.analyzeFailure({
      sessionId,
      failureReason: session.failure_reason || '',
      commandLogs: lastCommands.map((c) => ({
        command: c.command_name,
        success: c.is_success,
        response: c.response?.slice(0, 500), // Truncate long responses
      })),
      deviceLogs: lastLogs.map((l) => l.message),
      screenshotPath: lastScreenshotLog?.screenshot || undefined,
    });
    if (!aiAnalysis) return;

    await prisma.session.update({
      where: { id: sessionId },
      data: { ai_analysis: aiAnalysis },
    });
  } catch (aiErr: any) {
    log.warn(`[FailureAnalysis] AI Analysis failed for ${sessionId}: ${aiErr.message}`);
  }
}
