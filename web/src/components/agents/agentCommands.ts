/**
 * How a tester adds this lab to their coding agent, per agent: the agent's
 * own command, or the entry for its config file, the same as
 * website/docs/ai-agents.mdx gives. Xenon's installer
 * (`@xenon-device-management/mcp`, from xenon-studio) sets up any of them;
 * Claude Desktop has no other way, since it connects through the installer's
 * bridge.
 */
export type AgentSetup =
  | {
      client: string;
      label: string;
      kind: 'command';
      /** The command to run, with this lab's address in it. */
      text: string;
      /** What to do after it, if anything. */
      after?: string;
    }
  | {
      client: string;
      label: string;
      kind: 'config';
      /** The file the entry goes in. */
      file: string;
      /** The entry, with this lab's address in it. */
      text: string;
      after?: string;
    };

/** A config file's `mcpServers` entry for Xenon, `key` naming the address. */
function configEntry(key: string, mcpUrl: string): string {
  return JSON.stringify({ mcpServers: { xenon: { [key]: mcpUrl } } }, null, 2);
}

const INSTALLER = 'npx @xenon-device-management/mcp';

/** The installer's command, which sets up any agent for the lab at `hubUrl` (its origin). */
export function installerSetup(hubUrl: string): AgentSetup {
  return {
    client: 'installer',
    label: 'Xenon installer',
    kind: 'command',
    text: `${INSTALLER} add --hub ${hubUrl.replace(/\/+$/, '')}`,
    after:
      "Sets up any of the agents below, with Xenon's skills: it asks which. Needs Node 22.12 or later.",
  };
}

/**
 * Each agent's way of adding the lab at `hubUrl` (its origin, such as
 * `https://xenon.example.com`).
 */
export function agentSetups(
  hubUrl: string,
  { plainHttpSignIn = false }: { plainHttpSignIn?: boolean } = {},
): AgentSetup[] {
  const hub = hubUrl.replace(/\/+$/, '');
  const mcpUrl = `${hub}/xenon/mcp`;
  return [
    {
      client: 'claude-code',
      label: 'Claude Code',
      kind: 'command',
      text: `claude mcp add --transport http xenon ${mcpUrl}`,
      after: plainHttpSignIn
        ? CLAUDE_CODE_PLAIN_HTTP
        : 'Then run /mcp in Claude Code and choose xenon to sign in.',
    },
    {
      client: 'codex',
      label: 'Codex',
      kind: 'command',
      text: `codex mcp add xenon --url ${mcpUrl}`,
      after:
        'Codex opens this browser for you to sign in. If you close it first, run codex mcp login xenon.',
    },
    {
      client: 'gemini',
      label: 'Gemini CLI',
      kind: 'config',
      file: '~/.gemini/settings.json',
      text: configEntry('httpUrl', mcpUrl),
      after: 'Then run /mcp auth xenon in Gemini CLI.',
    },
    {
      client: 'cursor',
      label: 'Cursor',
      kind: 'config',
      file: '~/.cursor/mcp.json',
      text: configEntry('url', mcpUrl),
      after: "Then open Cursor's MCP settings and click Authenticate next to xenon.",
    },
    {
      client: 'vscode',
      label: 'VS Code',
      kind: 'command',
      text: `code --add-mcp '${JSON.stringify({ name: 'xenon', type: 'http', url: mcpUrl })}'`,
      after: 'VS Code asks you to sign in when it first starts the server.',
    },
    {
      client: 'windsurf',
      label: 'Windsurf (Devin Desktop)',
      kind: 'config',
      file: '~/.config/devin/mcp_config.json',
      text: configEntry('url', mcpUrl),
      after: "Then open Cascade's MCP settings and click Authenticate next to xenon.",
    },
    {
      client: 'claude-desktop',
      label: 'Claude Desktop',
      kind: 'command',
      text: `${INSTALLER} add --hub ${hub} --client claude-desktop`,
      after:
        'Claude Desktop connects through a small bridge the installer adds on your computer. ' +
        'The installer opens this browser for you to sign in; then restart Claude Desktop.',
    },
  ];
}

/**
 * Claude Code's next step on a plain-HTTP lab with sign-in on. The Claude
 * desktop app opens only an https sign-in page, loopback included ("Refused
 * to open sign-in URL for xenon: must be https"), so there the tester uses the
 * installer's bridge, or adds an access key and token as headers, which
 * `/xenon/mcp` takes as REST does.
 */
const CLAUDE_CODE_PLAIN_HTTP =
  'Then run /mcp in Claude Code and choose xenon to sign in. The Claude desktop app won\u2019t ' +
  'open a sign-in page on plain HTTP: there, use the installer above, or add --header ' +
  '"x-xenon-access-key: ACCESS_KEY" --header "x-xenon-token: TOKEN" to the command, with your ' +
  'access key and a token from Profile, API tokens. A Member\u2019s token can start sessions ' +
  'but not lease phones.';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Whether the hub is on plain HTTP, and where: `this-computer` (loopback) or
 * `network`. The Claude desktop app won't sign in over plain HTTP anywhere;
 * some other agents refuse it on the network. Null on HTTPS.
 */
export function plainHttpHub(hubUrl: string): 'this-computer' | 'network' | null {
  try {
    const url = new URL(hubUrl);
    if (url.protocol !== 'http:') return null;
    return LOOPBACK.has(url.hostname) ? 'this-computer' : 'network';
  } catch {
    return null;
  }
}
