import { config } from '../config';
import type { McpCaller } from './mcpCredential';
import { mcpScopesOf, XenonTool } from './tool';
import { labInfoTool } from './tools/labInfo';
import {
  acquireDeviceTool,
  extendDeviceTool,
  listDevicesTool,
  releaseDeviceTool,
} from './tools/devices';
import { healingEventsTool, selectorHealthTool } from './tools/analytics';

/**
 * Every tool, in the order they are listed. The tools import nothing of this
 * module or of `/capabilities` at load time (tool.ts; labInfo reads
 * `/capabilities` when it runs), so each is defined by the time this list is.
 */
const TOOLS: readonly XenonTool[] = [
  labInfoTool,
  listDevicesTool,
  acquireDeviceTool,
  releaseDeviceTool,
  extendDeviceTool,
  selectorHealthTool,
  healingEventsTool,
];

/** Every tool's name, as `/capabilities` reports them. */
export function toolNames(): string[] {
  return TOOLS.map((t) => t.name);
}

/** The tools this caller may see and call: every tool with auth disabled. */
export function toolsFor(caller: McpCaller): XenonTool[] {
  if (config.authDisabled === true) return [...TOOLS];
  const granted = new Set(mcpScopesOf(caller));
  return TOOLS.filter((t) => t.scope === null || granted.has(t.scope));
}
