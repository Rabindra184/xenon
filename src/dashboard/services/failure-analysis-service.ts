import { prisma } from '../../prisma';
import log from '../../logger';

const ERROR_PATTERNS = [
  {
    category: 'ELEMENT_NOT_FOUND',
    patterns: [
      'NoSuchElementError',
      'unable to find an element',
      'An element could not be located',
      'no such element',
    ],
  },
  {
    category: 'APP_CRASH',
    patterns: [
      'Appium crashed',
      'process has died',
      'activity has died',
      'The application has crashed',
      'Application not responding',
      "org.openqa.selenium.WebDriverException: An unknown server-side error occurred while processing the command. Original error: The application under test with bundle id '.*' is not running or cannot be found",
    ],
  },
  {
    category: 'TIMEOUT',
    patterns: ['timeout', 'timed out', 'TimeoutException', 'New Command Timeout', 'socket hang up'],
  },
  {
    category: 'PERMISSION_BLOCKED',
    patterns: ['Permission alert', 'Security alert', 'Always Allow', 'Allow while using app'],
  },
  {
    category: 'WDA_FAILURE',
    patterns: [
      'WebDriverAgent',
      'WDA',
      'xcodebuild failed',
      'crashed with code',
      'Unable to connect to WDA',
      'Session does not exist',
      'the session is not in a running state',
    ],
  },
  {
    category: 'SYSTEM_OVERLOAD',
    patterns: ['OutOfMemory', 'MemoryLimit', 'thermal throttling', 'too many open files'],
  },
];

export async function analyzeSessionFailure(sessionId: string): Promise<void> {
  try {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        SessionLog: { where: { is_error: true }, take: 5, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!session) return;

    let reason = session.failure_reason || '';
    let logs_text = session.SessionLog.map((l) => `${l.title} ${l.response}`).join(' ');
    let combined_text = (reason + ' ' + logs_text).toLowerCase();

    let identifiedCategory = 'UNKNOWN';

    for (const item of ERROR_PATTERNS) {
      if (item.patterns.some((p) => new RegExp(p, 'i').test(combined_text))) {
        identifiedCategory = item.category;
        break;
      }
    }

    // Special case for App Crash - check Logcat/Syslog if available
    // For now we rely on the error response text which usually mentions "process has died"

    log.info(`[FailureAnalysis] Session ${sessionId} identified as ${identifiedCategory}`);

    await prisma.session.update({
      where: { id: sessionId },
      data: {
        failure_category: identifiedCategory,
      },
    });
  } catch (err: any) {
    log.error(`[FailureAnalysis] Failed to analyze session ${sessionId}: ${err.message}`);
  }
}
