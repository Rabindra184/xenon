import { describe, it, expect } from 'vitest';
import { agentSetups, isPlainHttpHub } from './agentCommands';

const MCP_URL = 'https://hub/xenon/mcp';

describe('agentSetups', () => {
  it('gives Claude Code "claude mcp add --transport http xenon https://hub/xenon/mcp"', () => {
    const claude = agentSetups('https://hub').find((a) => a.client === 'claude-code');
    expect(claude).toEqual({
      client: 'claude-code',
      label: 'Claude Code',
      kind: 'command',
      text: `claude mcp add --transport http xenon ${MCP_URL}`,
      after: 'Then run /mcp in Claude Code and choose xenon to sign in.',
    });
  });

  it("gives each agent its own command or config entry, as the docs do, and never Xenon's installer", () => {
    const setups = agentSetups('https://hub');
    expect(setups.map((a) => a.label)).toEqual([
      'Claude Code',
      'Codex',
      'Gemini CLI',
      'Cursor',
      'VS Code',
      'Windsurf',
      'Claude Desktop',
    ]);
    const byClient = Object.fromEntries(setups.map((a) => [a.client, a]));
    expect(byClient.codex).toMatchObject({
      kind: 'command',
      // `codex mcp add` signs in by itself; a `codex mcp login` after it
      // asked the person to sign in a second time.
      text: `codex mcp add xenon --url ${MCP_URL}`,
      after: expect.stringContaining('codex mcp login xenon'),
    });
    expect(byClient.vscode).toMatchObject({
      kind: 'command',
      text: `code --add-mcp '{"name":"xenon","type":"http","url":"${MCP_URL}"}'`,
    });
    // The config entries, each agent's own key for the address.
    const entry = (client: string) => {
      const setup = byClient[client];
      expect(setup.kind, client).toBe('config');
      return { file: (setup as any).file, json: JSON.parse((setup as any).text) };
    };
    expect(entry('gemini')).toEqual({
      file: '~/.gemini/settings.json',
      json: { mcpServers: { xenon: { httpUrl: MCP_URL } } },
    });
    expect(byClient.gemini).toMatchObject({ after: 'Then run /mcp auth xenon in Gemini CLI.' });
    expect(entry('cursor')).toEqual({
      file: '~/.cursor/mcp.json',
      json: { mcpServers: { xenon: { url: MCP_URL } } },
    });
    // Cursor lists the server as needing sign-in and waits for a click.
    expect(byClient.cursor).toMatchObject({
      after: "Then open Cursor's MCP settings and click Authenticate next to xenon.",
    });
    expect(entry('windsurf')).toEqual({
      file: '~/.codeium/windsurf/mcp_config.json',
      json: { mcpServers: { xenon: { serverUrl: MCP_URL } } },
    });
    // Claude Desktop needs the bridge, which isn't out: nothing to copy.
    expect(byClient['claude-desktop'].kind).toBe('unavailable');
    expect(JSON.stringify(setups)).not.toMatch(/npx|@xenon-device-management/);
  });

  it('gives a plain-HTTP hub the same setups, with its own address', () => {
    for (const setup of agentSetups('http://lab-mac:4723')) {
      if (setup.kind === 'unavailable') continue;
      expect(setup.text, setup.client).toContain('http://lab-mac:4723/xenon/mcp');
    }
  });

  it('takes the hub with or without a trailing slash', () => {
    expect((agentSetups('https://hub/')[0] as { text: string }).text).toBe(
      `claude mcp add --transport http xenon ${MCP_URL}`,
    );
  });
});

describe('isPlainHttpHub', () => {
  it('is a hub on http that agents reach over the network', () => {
    expect(isPlainHttpHub('http://lab-mac:4723')).toBe(true);
    expect(isPlainHttpHub('http://10.0.0.4:4723')).toBe(true);
  });

  it('is not one on https, nor one on this computer, where agents accept http', () => {
    expect(isPlainHttpHub('https://xenon.example.com')).toBe(false);
    expect(isPlainHttpHub('http://localhost:4723')).toBe(false);
    expect(isPlainHttpHub('http://127.0.0.1:4723')).toBe(false);
    expect(isPlainHttpHub('http://[::1]:4723')).toBe(false);
  });
});
