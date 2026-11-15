/**
 * How a tester adds this lab to their coding agent, per agent: the agent's
 * own command, or the entry for its config file, the same as
 * website/docs/ai-agents.mdx gives. Xenon's installer, which would write any
 * agent's config and connect one over plain HTTP, isn't published yet, so
 * the page never names it.
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
    }
  | {
      client: string;
      label: string;
      kind: 'unavailable';
      /** Why there is nothing to copy yet. */
      note: string;
    };

/** A config file's `mcpServers` entry for Xenon, `key` naming the address. */
function configEntry(key: string, mcpUrl: string): string {
  return JSON.stringify({ mcpServers: { xenon: { [key]: mcpUrl } } }, null, 2);
}

/**
 * Each agent's way of adding the lab at `hubUrl` (its origin, such as
 * `https://xenon.example.com`).
 */
export function agentSetups(hubUrl: string): AgentSetup[] {
  const mcpUrl = `${hubUrl.replace(/\/+$/, '')}/xenon/mcp`;
  return [
    {
      client: 'claude-code',
      label: 'Claude Code',
      kind: 'command',
      text: `claude mcp add --transport http xenon ${mcpUrl}`,
      after: 'Then run /mcp in Claude Code and choose xenon to sign in.',
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
      label: 'Windsurf',
      kind: 'config',
      file: '~/.codeium/windsurf/mcp_config.json',
      text: configEntry('serverUrl', mcpUrl),
    },
    {
      client: 'claude-desktop',
      label: 'Claude Desktop',
      kind: 'unavailable',
      note:
        "Claude Desktop connects to a lab through a small bridge on your computer, which isn't " +
        'available yet. Use one of the other agents for now.',
    },
  ];
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Whether agents would reach the hub over plain HTTP on the network. OAuth
 * expects HTTPS except on this computer (loopback), where agents accept
 * `http://localhost`, so a hub there needs no warning.
 */
export function isPlainHttpHub(hubUrl: string): boolean {
  try {
    const url = new URL(hubUrl);
    return url.protocol === 'http:' && !LOOPBACK.has(url.hostname);
  } catch {
    return false;
  }
}
