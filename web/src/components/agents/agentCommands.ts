/**
 * What a tester runs to add this lab to their coding agent, per agent: the
 * agent's own command where it has one, else Xenon's installer, which writes
 * the agent's config file (spec section 5).
 *
 * `client` is the installer's `--client` name for the agent. The installer
 * (`@xenon-device-management/mcp`, in xenon-studio) must take these names.
 */
export interface AgentCommand {
  client: string;
  label: string;
  command: string;
}

export const INSTALLER = 'npx @xenon-device-management/mcp';

const AGENTS: Array<{ client: string; label: string; own?: (mcpUrl: string) => string }> = [
  {
    client: 'claude-code',
    label: 'Claude Code',
    own: (url) => `claude mcp add --transport http xenon ${url}`,
  },
  {
    client: 'codex',
    label: 'Codex',
    own: (url) => `codex mcp add xenon --url ${url} && codex mcp login xenon`,
  },
  // Gemini CLI, Cursor and Windsurf read a config file; Claude Desktop runs
  // the installer's relay. The installer writes either.
  { client: 'gemini', label: 'Gemini CLI' },
  { client: 'cursor', label: 'Cursor' },
  {
    client: 'vscode',
    label: 'VS Code',
    own: (url) => `code --add-mcp '${JSON.stringify({ name: 'xenon', type: 'http', url })}'`,
  },
  { client: 'windsurf', label: 'Windsurf' },
  { client: 'claude-desktop', label: 'Claude Desktop' },
];

/**
 * One command per agent for the hub at `hubUrl` (its origin, such as
 * `https://xenon.example.com`). A hub on plain HTTP gets the installer for
 * every agent: an agent may refuse to sign in over plain HTTP, so the
 * installer connects it through its relay, which signs in from the tester's
 * computer.
 */
export function agentCommands(hubUrl: string, plainHttp: boolean): AgentCommand[] {
  const hub = hubUrl.replace(/\/+$/, '');
  const mcpUrl = `${hub}/xenon/mcp`;
  return AGENTS.map(({ client, label, own }) => ({
    client,
    label,
    command: own && !plainHttp ? own(mcpUrl) : `${INSTALLER} add --hub ${hub} --client ${client}`,
  }));
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Whether agents would reach the hub over plain HTTP on the network. OAuth
 * expects HTTPS except on this computer (loopback), where agents accept
 * `http://localhost`, so a hub there is added directly.
 */
export function isPlainHttpHub(hubUrl: string): boolean {
  try {
    const url = new URL(hubUrl);
    return url.protocol === 'http:' && !LOOPBACK.has(url.hostname);
  } catch {
    return false;
  }
}
