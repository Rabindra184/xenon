import { Request, Response } from 'express';
import { updateSessionDetails } from './services/session-service';
import { prisma } from '../prisma';
import log from '../logger';
import _ from 'lodash';
import { SESSION_MANAGER } from '../sessions/SessionManager';
import { saveScreenShot } from './asset-manager';

export class DashboardCommands {
  public isDashboardCommand(commandName: string) {
    return commandName.startsWith('xenon') || commandName.startsWith('devicefarm');
  }

  public async process(sessionId: string, request: Request, response: Response) {
    const { script } = request.body;
    log.info(`[DashboardCommands] Processing command: ${script}`);

    if (!script) {
      return this.sendSuccessResponse(response);
    }
    const commandName = script.split(':')[1];
    log.info(`[DashboardCommands] Parsed command name: ${commandName}`);

    if (commandName && commandName.trim()) {
      const trimmedCommand = commandName.trim();
      log.info(`[DashboardCommands] Trimmed command: ${trimmedCommand}`);

      switch (trimmedCommand) {
        case 'setSessionName':
          log.info('[DashboardCommands] Executing setSessionName');
          return await this.setSessionName(sessionId, request, response);
        case 'setSessionStatus':
          log.info('[DashboardCommands] Executing setSessionStatus');
          return await this.setSessionStatus(sessionId, request, response);
        case 'debug':
          log.info('[DashboardCommands] Executing debug command');
          return await this.debug(sessionId, request, response);
        case 'captureEvidence':
          log.info('[DashboardCommands] Executing captureEvidence');
          return await this.captureEvidence(sessionId, request, response);
        case 'addTag':
          log.info('[DashboardCommands] Executing addTag');
          return await this.addTag(sessionId, request, response);
        default:
          log.warn(`[DashboardCommands] Unknown command: ${trimmedCommand}`);
          return this.sendSuccessResponse(response);
      }
    }
    return this.sendSuccessResponse(response);
  }

  private sendSuccessResponse(response: Response) {
    return response.status(200).json({ value: null });
  }

  /* Commands */

  /**
   * Set the name of current test(session)
   *
   * driver.executeScript("xenon: setSessionName", "MyTestName")
   * or
   * driver.executeScript("xenon: setSessionName", {"name": "MyTestName"})
   */
  private async setSessionName(sessionId: string, request: Request, response: Response) {
    const { args } = request.body;
    await updateSessionDetails(sessionId, {
      name: typeof args[0] === 'object' && args[0].name ? args[0].name : args[0],
    });
    return this.sendSuccessResponse(response);
  }

  /**
   * Update the status of the session
   *
   * driver.executeScript("xenon: setSessionStatus", {"status": "passed/failed", "reason": "optional reason"})
   */
  private async setSessionStatus(sessionId: string, request: Request, response: Response) {
    let { args } = request.body;
    if (_.isArray(args)) {
      args = args[0];
    }
    // FIX: Validate against 'passed' and 'failed' (not 'success')
    const validStatuses = ['passed', 'failed', 'success']; // 'success' kept for backward compat
    if (args.status && validStatuses.indexOf(args.status) < 0) {
      log.warn(`[DashboardCommands] Invalid status: ${args.status}. Valid: ${validStatuses.join(', ')}`);
      return this.sendSuccessResponse(response);
    }
    // Normalize 'success' to 'passed' for consistency
    const normalizedStatus = args.status === 'success' ? 'passed' : args.status;
    await updateSessionDetails(sessionId, {
      status: normalizedStatus,
      failure_reason: args.reason || undefined,
    });
    return this.sendSuccessResponse(response);
  }

  /**
   * Add debug logs to the session
   *
   * driver.executeScript("xenon: debug", {"message": "Debug message"})
   * or
   * driver.executeScript("xenon: debug", "Debug message")
   */
  private async debug(sessionId: string, request: Request, response: Response) {
    const { args } = request.body;
    const logData = _.isArray(args) ? args[0] : args;

    // Support both string and object format
    const message =
      typeof logData === 'string' ? logData : logData.message || JSON.stringify(logData);

    await prisma.log.create({
      data: {
        session_id: sessionId,
        log_type: 'DEBUG',
        message: message,
      },
    });

    return this.sendSuccessResponse(response);
  }

  /**
   * Capture evidence (screenshot) with optional reason/label
   *
   * driver.executeScript("xenon: captureEvidence", {"reason": "Login failed", "label": "error_state"})
   * or
   * driver.executeScript("xenon: captureEvidence", "Checkpoint reached")
   */
  private async captureEvidence(sessionId: string, request: Request, response: Response) {
    const { args } = request.body;
    const evidenceData = _.isArray(args) ? args[0] : args;

    const reason = typeof evidenceData === 'string' ? evidenceData : evidenceData.reason || 'Manual capture';
    const label = typeof evidenceData === 'object' ? evidenceData.label : undefined;

    try {
      const session = SESSION_MANAGER.getSession(sessionId);
      if (!session) {
        log.warn(`[DashboardCommands] captureEvidence: Session ${sessionId} not found`);
        return this.sendSuccessResponse(response);
      }

      const screenshotBase64 = await session.getScreenShot();
      if (screenshotBase64) {
        const screenshotPath = saveScreenShot(sessionId, screenshotBase64);

        // Log the evidence capture
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
      }
    } catch (err: any) {
      log.error(`[DashboardCommands] captureEvidence failed: ${err.message}`);
    }

    return this.sendSuccessResponse(response);
  }

  /**
   * Add searchable tags to the session
   *
   * driver.executeScript("xenon: addTag", {"tag": "regression"})
   * or
   * driver.executeScript("xenon: addTag", "smoke-test")
   */
  private async addTag(sessionId: string, request: Request, response: Response) {
    const { args } = request.body;
    const tagData = _.isArray(args) ? args[0] : args;

    const newTag = typeof tagData === 'string' ? tagData : tagData.tag;

    if (!newTag) {
      log.warn(`[DashboardCommands] addTag: No tag provided`);
      return this.sendSuccessResponse(response);
    }

    try {
      // Get current session to append tag
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { tags: true },
      });

      // Parse existing tags or initialize empty array
      let existingTags: string[] = [];
      if (session?.tags) {
        try {
          existingTags = JSON.parse(session.tags as string);
        } catch {
          existingTags = [];
        }
      }

      // Add new tag if not already present
      if (!existingTags.includes(newTag)) {
        existingTags.push(newTag);
        await updateSessionDetails(sessionId, {
          tags: JSON.stringify(existingTags),
        });
        log.info(`[DashboardCommands] Tag added to ${sessionId}: ${newTag}`);
      }
    } catch (err: any) {
      log.error(`[DashboardCommands] addTag failed: ${err.message}`);
    }

    return this.sendSuccessResponse(response);
  }
}

export const dashboardCommands = new DashboardCommands();

