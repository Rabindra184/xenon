import { Service } from 'typedi';
import { IPluginArgs, DefaultPluginArgs } from './interfaces/IPluginArgs';

@Service()
export class PluginContext {
  public pluginArgs: IPluginArgs = Object.assign({}, DefaultPluginArgs);
  public port = 4723;
  public nodeId = '';
  public nodeBasePath = '';
  /**
   * Appium's own Express app, as ServerManager.registerRoutes was handed it:
   * where an MCP tool runs a WebDriver command in process (invokeWebDriver).
   */
  public expressApp?: (req: any, res: any) => unknown;

  setContext(args: IPluginArgs, port: number, nodeId: string, nodeBasePath: string) {
    this.pluginArgs = args;
    this.port = port;
    this.nodeId = nodeId;
    this.nodeBasePath = nodeBasePath;
  }
}
