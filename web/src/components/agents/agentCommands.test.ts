import { describe, it, expect } from 'vitest';
import { agentCommands, INSTALLER, isPlainHttpHub } from './agentCommands';

const VSCODE_ENTRY = '{"name":"xenon","type":"http","url":"https://hub/xenon/mcp"}';

describe('agentCommands', () => {
  it('gives Claude Code "claude mcp add --transport http xenon https://hub/xenon/mcp"', () => {
    const claude = agentCommands('https://hub', false).find((a) => a.client === 'claude-code');
    expect(claude).toEqual({
      client: 'claude-code',
      label: 'Claude Code',
      command: 'claude mcp add --transport http xenon https://hub/xenon/mcp',
    });
  });

  it("uses each agent's own command where it has one, else the installer", () => {
    const byClient = Object.fromEntries(
      agentCommands('https://hub', false).map((a) => [a.client, a.command]),
    );
    expect(byClient).toEqual({
      'claude-code': 'claude mcp add --transport http xenon https://hub/xenon/mcp',
      codex: 'codex mcp add xenon --url https://hub/xenon/mcp && codex mcp login xenon',
      gemini: `${INSTALLER} add --hub https://hub --client gemini`,
      cursor: `${INSTALLER} add --hub https://hub --client cursor`,
      vscode: `code --add-mcp '${VSCODE_ENTRY}'`,
      windsurf: `${INSTALLER} add --hub https://hub --client windsurf`,
      'claude-desktop': `${INSTALLER} add --hub https://hub --client claude-desktop`,
    });
  });

  it('gives every agent the installer for a plain-HTTP hub, which it connects through its relay', () => {
    const commands = agentCommands('http://lab-mac:4723', true);
    expect(commands).toHaveLength(7);
    for (const { client, command } of commands) {
      expect(command).toBe(
        `npx @xenon-device-management/mcp add --hub http://lab-mac:4723 --client ${client}`,
      );
    }
  });

  it('takes the hub with or without a trailing slash', () => {
    expect(agentCommands('https://hub/', false)[0].command).toBe(
      'claude mcp add --transport http xenon https://hub/xenon/mcp',
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
