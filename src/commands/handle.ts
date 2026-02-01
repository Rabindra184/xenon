import { updateCmdExecutedTime } from '../data-service/device-service';

export default async function handle(
  next: () => any,
  driver: any,
  _commandName: string,
  ..._args: any
) {
  updateCmdExecutedTime(driver.sessionId);
  return await next();
}
