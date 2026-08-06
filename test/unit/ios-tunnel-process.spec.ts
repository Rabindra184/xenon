import { expect } from 'chai';
import {
  tunnelSpawnOptions,
  killProcessGroup,
  reapTunnelsForUdid,
  reapAllOrphanTunnels,
  KillFn,
  ExecFn,
} from '../../src/device-managers/ios/tunnelProcess';

describe('tunnelProcess helpers (go-ios leak guards)', () => {
  describe('tunnelSpawnOptions', () => {
    it('spawns the tunnel detached so it leads its own process group', () => {
      const opts = tunnelSpawnOptions({ ENABLE_GO_IOS_AGENT: 'yes' } as NodeJS.ProcessEnv);
      // detached => the go-ios process is a group leader, so the self-forking
      // agent children can be reaped as a group instead of orphaning.
      expect(opts.detached).to.equal(true);
      expect(opts.stdio).to.deep.equal(['pipe', 'pipe', 'pipe']);
      expect((opts.env as NodeJS.ProcessEnv).ENABLE_GO_IOS_AGENT).to.equal('yes');
    });
  });

  describe('killProcessGroup', () => {
    it('signals the whole process group (negative pid) first', () => {
      const calls: Array<[number, NodeJS.Signals | number | undefined]> = [];
      const kill: KillFn = (pid, sig) => {
        calls.push([pid, sig]);
      };
      killProcessGroup(4242, 'SIGKILL', kill);
      expect(calls).to.deep.equal([[-4242, 'SIGKILL']]);
    });

    it('falls back to a direct kill when the group kill throws (ESRCH)', () => {
      const calls: number[] = [];
      const kill: KillFn = (pid) => {
        calls.push(pid);
        if (pid < 0) throw new Error('ESRCH');
      };
      killProcessGroup(99, 'SIGKILL', kill);
      expect(calls).to.deep.equal([-99, 99]);
    });

    it('never signals pid <= 1 or non-integers (guards launchd / "kill everything")', () => {
      const calls: number[] = [];
      const kill: KillFn = (pid) => calls.push(pid);
      [undefined, null, 0, 1, -1, 1.5, NaN].forEach((p) =>
        killProcessGroup(p as unknown as number, 'SIGKILL', kill),
      );
      expect(calls).to.have.length(0);
    });
  });

  describe('reapTunnelsForUdid', () => {
    it('group-kills the top-level tunnel pids matched for the udid', async () => {
      const groups: number[] = [];
      const kill: KillFn = (pid) => {
        groups.push(pid);
      };
      const exec: ExecFn = async (cmd) => {
        if (cmd.includes('pgrep') && cmd.includes('ios tunnel.*UDID1')) {
          return { stdout: '111\n222\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      };
      await reapTunnelsForUdid('UDID1', exec, kill);
      expect(groups).to.include(-111);
      expect(groups).to.include(-222);
    });

    it('does nothing when pgrep finds no matching tunnel', async () => {
      const groups: number[] = [];
      const kill: KillFn = (pid) => groups.push(pid);
      const exec: ExecFn = async () => {
        throw new Error('exit 1'); // pgrep exits 1 on no-match
      };
      await reapTunnelsForUdid('NOPE', exec, kill);
      expect(groups).to.have.length(0);
    });
  });

  describe('reapAllOrphanTunnels', () => {
    it('pkills every process on the vendored binary path and returns the count', async () => {
      const cmds: string[] = [];
      const binary = '/Users/x/.cache/xenon/goIOS/ios';
      const exec: ExecFn = async (cmd) => {
        cmds.push(cmd);
        if (cmd.startsWith('pgrep')) return { stdout: '10\n11\n12\n', stderr: '' };
        return { stdout: '', stderr: '' };
      };
      const count = await reapAllOrphanTunnels(binary, exec);
      expect(count).to.equal(3);
      expect(cmds.some((c) => c.startsWith('pkill') && c.includes(binary))).to.equal(true);
    });

    it('does not pkill when nothing is running', async () => {
      const cmds: string[] = [];
      const exec: ExecFn = async (cmd) => {
        cmds.push(cmd);
        throw new Error('exit 1'); // pgrep no-match
      };
      const count = await reapAllOrphanTunnels('/bin/ios', exec);
      expect(count).to.equal(0);
      expect(cmds.some((c) => c.startsWith('pkill'))).to.equal(false);
    });
  });
});
