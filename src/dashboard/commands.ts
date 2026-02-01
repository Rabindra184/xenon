import { Request, Response } from 'express';
import { updateSessionDetails } from './services/session-service';
import { prisma } from '../prisma';
import log from '../logger';
import _ from 'lodash';

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

  /*
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

  /*
   * Update the status of the session
   *
   * driver.executeScript("xenon: setSessionStatus", {"status": "passed/failed", "reasonn": "optional reason"})
   */

  private async setSessionStatus(sessionId: string, request: Request, response: Response) {
    let { args } = request.body;
    if (_.isArray(args)) {
      args = args[0];
    }
    if (args.status && ['success', 'failed'].indexOf(args.status) < 0) {
      return this.sendSuccessResponse(response);
    }
    await updateSessionDetails(sessionId, {
      status: args.status,
      failure_reason: args.reason || undefined,
    });
    return this.sendSuccessResponse(response);
  }

  /*
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
}

export const dashboardCommands = new DashboardCommands();
