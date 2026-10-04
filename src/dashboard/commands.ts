import { Request, Response } from 'express';
import { updateSessionDetails } from './services/session-service';
import { prisma } from '../prisma';
import log from '../logger';
import { SESSION_MANAGER } from '../sessions/SessionManager';
import { saveScreenShot } from './asset-manager';
import { xenonScriptName } from '../interceptors/xenonScripts';

/**
 * The execute commands that write to a session's record (its Session row):
 * `driver.execute('xenon: setSessionName', 'Checkout')` and the like.
 *
 * Each answers `{ recorded: true }` when it wrote, or `{ recorded: false,
 * message }` saying why nothing was written: no record of the session on this
 * server (its dashboard is off, or it is a node, which keeps none for the
 * hub's sessions), an argument it can't use, or a failed write. None of them
 * fails the test's command. They are bookkeeping, and a test shouldn't die
 * because the server it ran on keeps no dashboard. Through 2.13.2
 * setSessionName, setSessionStatus and debug failed the command there
 * (Prisma's P2025, a foreign-key error), and addTag and captureEvidence
 * answered `null` as if they had worked.
 */
export const SESSION_DETAILS_COMMANDS = [
  'setSessionName',
  'setSessionStatus',
  'debug',
  'addTag',
  'captureEvidence',
] as const;

export type SessionDetailsCommand = (typeof SESSION_DETAILS_COMMANDS)[number];

export type SessionDetailsAnswer = { recorded: true } | { recorded: false; message: string };

const RECORDED: SessionDetailsAnswer = { recorded: true };
const notRecorded = (message: string): SessionDetailsAnswer => ({ recorded: false, message });

/** The session-details command a script names (`xenon: addTag`), or null for any other script. */
export function sessionDetailsCommandOf(script: unknown): SessionDetailsCommand | null {
  const name = xenonScriptName(script);
  return name !== null && (SESSION_DETAILS_COMMANDS as readonly string[]).includes(name)
    ? (name as SessionDetailsCommand)
    : null;
}

/** The script's arguments as a list, as both the W3C body and Appium's executeScript give them. */
function argumentList(args: unknown): unknown[] {
  if (Array.isArray(args)) return args;
  return args === undefined || args === null ? [] : [args];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A string argument, or the named field of an object argument. */
function stringArg(value: unknown, field: string): string | undefined {
  if (typeof value === 'string') return value;
  if (isObject(value) && typeof value[field] === 'string') return value[field] as string;
  return undefined;
}

export class DashboardCommands {
  /**
   * Answers a session-details command on an Express-style response, as
   * `{ value: <answer> }`, and returns the answer. The hub's gateway passes
   * the client's response; CommandInterceptor passes one that keeps it.
   */
  public async process(
    sessionId: string,
    request: Request,
    response: Response,
  ): Promise<SessionDetailsAnswer> {
    const { script, args } = request.body ?? {};
    const command = sessionDetailsCommandOf(script);
    const answer = command
      ? await this.run(sessionId, command, args)
      : notRecorded(`"${script}" is not a command that records session details.`);
    response.status(200).json({ value: answer });
    return answer;
  }

  /** Runs one command. Never throws: a failure is `{ recorded: false, message }`. */
  public async run(
    sessionId: string,
    command: SessionDetailsCommand,
    args: unknown,
  ): Promise<SessionDetailsAnswer> {
    log.info(`[DashboardCommands] ${command} for session ${sessionId}`);
    const list = argumentList(args);
    let answer: SessionDetailsAnswer;
    try {
      const row = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { id: true, tags: true },
      });
      if (!row) {
        answer = notRecorded(
          `This server keeps no record of session ${sessionId}, so nothing was saved. ` +
            'Sessions are recorded on a hub with its dashboard turned on.',
        );
      } else {
        switch (command) {
          case 'setSessionName':
            answer = await this.setSessionName(sessionId, list);
            break;
          case 'setSessionStatus':
            answer = await this.setSessionStatus(sessionId, list);
            break;
          case 'debug':
            answer = await this.debug(sessionId, list);
            break;
          case 'captureEvidence':
            answer = await this.captureEvidence(sessionId, list);
            break;
          case 'addTag':
            answer = await this.addTag(sessionId, list, row.tags);
            break;
        }
      }
    } catch (err: any) {
      answer = notRecorded(`Xenon could not save it: ${err?.message ?? err}`);
    }
    if (!answer.recorded) log.warn(`[DashboardCommands] ${command}: ${answer.message}`);
    return answer;
  }

  /* Commands */

  /**
   * Set the name of current test(session)
   *
   * driver.executeScript("xenon: setSessionName", "MyTestName")
   * or
   * driver.executeScript("xenon: setSessionName", {"name": "MyTestName"})
   */
  private async setSessionName(sessionId: string, args: unknown[]) {
    const name = stringArg(args[0], 'name');
    if (!name || !name.trim()) {
      return notRecorded('setSessionName needs a name, as a string or { name }.');
    }
    await updateSessionDetails(sessionId, { name });
    return RECORDED;
  }

  /**
   * Update the status of the session
   *
   * driver.executeScript("xenon: setSessionStatus", {"status": "passed/failed", "reason": "optional reason"})
   * or, positionally, ("xe:setSessionStatus", "failed", "reason")
   */
  private async setSessionStatus(sessionId: string, args: unknown[]) {
    const statusArg = isObject(args[0]) ? args[0] : { status: args[0], reason: args[1] };
    const given = statusArg.status;
    const inputStatus = typeof given === 'string' ? given.toLowerCase() : '';
    const validStatuses = ['success', 'failed', 'passed'];

    if (!validStatuses.includes(inputStatus)) {
      return notRecorded(
        'setSessionStatus takes "passed" or "failed" ("success" also means passed); ' +
          `it was given ${JSON.stringify(given ?? null)}.`,
      );
    }
    // Normalize 'passed' to 'success' for consistency with SessionStatus enum
    const normalizedStatus = inputStatus === 'passed' ? 'success' : inputStatus;
    const reason = typeof statusArg.reason === 'string' ? statusArg.reason : undefined;
    const updated = await updateSessionDetails(sessionId, {
      status: normalizedStatus,
      failure_reason: reason || undefined,
    });

    // --- REAL-TIME UI UPDATE ---
    // Emit a socket event so the dashboard row updates immediately.
    const { SocketServer } = await import('../services/SocketServer');
    const { Container } = await import('typedi');
    const { SocketEvents } = await import('../enums/SocketEvents');

    void Container.get(SocketServer).emitToDashboardForDevices(
      SocketEvents.SESSION_STOPPED,
      {
        id: sessionId,
        status: normalizedStatus,
        failure_reason: reason || undefined,
      },
      { udid: updated?.device_udid },
    );

    return RECORDED;
  }

  /**
   * Add debug logs to the session
   *
   * driver.executeScript("xenon: debug", {"message": "Debug message"})
   * or
   * driver.executeScript("xenon: debug", "Debug message")
   */
  private async debug(sessionId: string, args: unknown[]) {
    const logData = args[0];
    let message: string | undefined;
    if (typeof logData === 'string') message = logData;
    else if (isObject(logData)) {
      message = typeof logData.message === 'string' ? logData.message : JSON.stringify(logData);
    }
    if (!message) {
      return notRecorded('debug needs a message, as a string or { message }.');
    }

    await prisma.log.create({
      data: {
        session_id: sessionId,
        log_type: 'DEBUG',
        message: message,
      },
    });
    return RECORDED;
  }

  /**
   * Capture evidence (screenshot) with optional reason/label
   *
   * driver.executeScript("xenon: captureEvidence", {"reason": "Login failed", "label": "error_state"})
   * or
   * driver.executeScript("xenon: captureEvidence", "Checkpoint reached")
   */
  private async captureEvidence(sessionId: string, args: unknown[]) {
    const evidenceData = args[0];
    const reason = stringArg(evidenceData, 'reason') || 'Manual capture';
    const label = isObject(evidenceData) ? evidenceData.label : undefined;

    const session = SESSION_MANAGER.getSession(sessionId);
    if (!session) {
      return notRecorded(`Session ${sessionId} isn't running here, so no screenshot was taken.`);
    }

    let screenshotBase64: string | null | undefined;
    try {
      screenshotBase64 = await session.getScreenShot();
    } catch (err: any) {
      return notRecorded(`No screenshot could be taken: ${err?.message ?? err}`);
    }
    if (!screenshotBase64) return notRecorded('No screenshot could be taken.');

    const screenshotPath = saveScreenShot(sessionId, screenshotBase64);
    await prisma.sessionLog.create({
      data: {
        session_id: sessionId,
        command_name: 'captureEvidence',
        body: JSON.stringify({ reason, label }),
        response: JSON.stringify({ captured: true }),
        is_success: true,
        is_error: false,
        method: 'POST',
        title: 'Evidence Captured',
        subtitle: reason,
        screenshot: screenshotPath,
        url: '/execute/sync',
      },
    });
    log.info(`[DashboardCommands] Evidence captured for ${sessionId}: ${reason}`);
    return RECORDED;
  }

  /**
   * Add searchable tags to the session
   *
   * driver.executeScript("xenon: addTag", {"tag": "regression"})
   * or
   * driver.executeScript("xenon: addTag", "smoke-test")
   */
  private async addTag(sessionId: string, args: unknown[], tags: string | null) {
    const newTag = stringArg(args[0], 'tag');
    if (!newTag || !newTag.trim()) {
      return notRecorded('addTag needs a tag, as a string or { tag }.');
    }

    let existingTags: string[] = [];
    if (tags) {
      try {
        const parsed = JSON.parse(tags);
        if (Array.isArray(parsed)) existingTags = parsed;
      } catch {
        existingTags = [];
      }
    }

    if (!existingTags.includes(newTag)) {
      existingTags.push(newTag);
      await updateSessionDetails(sessionId, { tags: JSON.stringify(existingTags) });
      log.info(`[DashboardCommands] Tag added to ${sessionId}: ${newTag}`);
    }
    return RECORDED;
  }
}

export const dashboardCommands = new DashboardCommands();
