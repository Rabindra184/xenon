import { Service } from 'typedi';
import { IPluginArgs, DefaultPluginArgs } from './interfaces/IPluginArgs';

@Service()
export class PluginContext {
  public pluginArgs: IPluginArgs = Object.assign({}, DefaultPluginArgs);
<<<<<<< HEAD
  public port: number = 4723;
  public nodeId: string = '';
  public nodeBasePath: string = '';
=======
  public port = 4723;
  public nodeId = '';
  public nodeBasePath = '';
>>>>>>> main

  setContext(args: IPluginArgs, port: number, nodeId: string, nodeBasePath: string) {
    this.pluginArgs = args;
    this.port = port;
    this.nodeId = nodeId;
    this.nodeBasePath = nodeBasePath;
  }
}
