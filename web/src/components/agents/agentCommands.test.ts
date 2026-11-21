import { describe, it, expect } from 'vitest';
import { agentSetups, installerSetup, plainHttpHub } from './agentCommands';

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

  it('gives each agent its own command or config entry, as the docs do', () => {
    const setups = agentSetups('https://hub');
    expect(setups.map((a) => a.label)).toEqual([
      'Claude Code',
      'Codex',
      'Gemini CLI',
      'Cursor',
      'VS Code',
      'Windsurf (Devin Desktop)',
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
    // Windsurf is now Devin Desktop, which reads `url` from its own file, as the installer writes it.
    expect(entry('windsurf')).toEqual({
      file: '~/.config/devin/mcp_config.json',
      json: { mcpServers: { xenon: { url: MCP_URL } } },
    });
    expect(byClient.windsurf).toMatchObject({
      after: "Then open Cascade's MCP settings and click Authenticate next to xenon.",
    });
    // Claude Desktop connects through the installer's bridge, which add signs in.
    expect(byClient['claude-desktop']).toEqual({
      client: 'claude-desktop',
      label: 'Claude Desktop',
      kind: 'command',
      text: 'npx @xenon-device-management/mcp add --hub https://hub --client claude-desktop',
      after: expect.stringMatching(/opens this browser for you to sign in.*restart Claude Desktop/),
    });
  });

  it('gives a plain-HTTP hub the same setups, with its own address', () => {
    for (const setup of agentSetups('http://lab-mac:4723')) {
      expect(setup.text, setup.client).toContain('http://lab-mac:4723');
    }
  });

  it('takes the hub with or without a trailing slash', () => {
    expect((agentSetups('https://hub/')[0] as { text: string }).text).toBe(
      `claude mcp add --transport http xenon ${MCP_URL}`,
    );
  });
});

describe('installerSetup', () => {
  it("gives the installer's command for this hub, whose --hub takes its origin", () => {
    expect(installerSetup('https://hub/')).toEqual({
      client: 'installer',
      label: 'Xenon installer',
      kind: 'command',
      text: 'npx @xenon-device-management/mcp add --hub https://hub',
      after: expect.stringContaining('Node 22.12 or later'),
    });
  });
});

describe('plainHttpHub', () => {
  it('is a hub on http that agents reach over the network', () => {
    expect(plainHttpHub('http://lab-mac:4723')).toBe('network');
    expect(plainHttpHub('http://10.0.0.4:4723')).toBe('network');
  });

  it('is one on this computer, which the Claude desktop app still refuses', () => {
    expect(plainHttpHub('http://localhost:4723')).toBe('this-computer');
    expect(plainHttpHub('http://127.0.0.1:4723')).toBe('this-computer');
    expect(plainHttpHub('http://[::1]:4723')).toBe('this-computer');
  });

  it('is not one on https', () => {
    expect(plainHttpHub('https://xenon.example.com')).toBeNull();
  });
});

describe('Claude Code on a plain-HTTP lab with sign-in on', () => {
  it('keeps the command and says how the desktop app connects instead', () => {
    const setup = agentSetups('http://127.0.0.1:4723', { plainHttpSignIn: true })[0] as {
      text: string;
      after: string;
    };
    expect(setup.text).toBe(
      'claude mcp add --transport http xenon http://127.0.0.1:4723/xenon/mcp',
    );
    expect(setup.after).toMatch(/to sign in/);
    expect(setup.after).toMatch(/Claude desktop app/);
    expect(setup.after).toMatch(/--header "x-xenon-access-key: ACCESS_KEY"/);
    expect(setup.after).toMatch(/--header "x-xenon-token: TOKEN"/);
  });

  it('says nothing of the desktop app otherwise', () => {
    const setup = agentSetups('http://127.0.0.1:4723')[0] as { after: string };
    expect(setup.after).toBe('Then run /mcp in Claude Code and choose xenon to sign in.');
  });
});
