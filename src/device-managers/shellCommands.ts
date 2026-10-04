/**
 * What the device control Shell tab may run.
 *
 * Android runs a command through `adb shell`, which joins the words and hands
 * them to the phone's `sh`. Through 2.13.2 the allow-list was a `startsWith`
 * test on the whole line, so `ls; reboot`, `ls && pm uninstall …` and `lsof`
 * all ran. Now a command must begin with an allowed command word for word, and
 * every word of it may only use characters a shell gives no meaning to, so the
 * phone's shell can't read anything into it. A command that changes or reads
 * more than the entry is for (`dumpsys battery set …`, `cat` of another file)
 * takes no arguments.
 */

export interface ShellCommand {
  /** The command's words, matched exactly. */
  words: string[];
  /** Whether the user may add plain arguments after them. */
  args: 'none' | 'plain';
}

/** Letters, digits and `._/:=@%+,-`: nothing `sh` expands, splits or redirects on. */
const PLAIN_WORD = /^[A-Za-z0-9._/:=@%+,-]+$/;

export const ANDROID_SHELL_COMMANDS: ShellCommand[] = [
  { words: ['ls'], args: 'plain' },
  { words: ['ps'], args: 'plain' },
  { words: ['top'], args: 'plain' },
  { words: ['dumpsys', 'battery'], args: 'none' },
  { words: ['dumpsys', 'wifi'], args: 'none' },
  { words: ['dumpsys', 'power'], args: 'none' },
  { words: ['whoami'], args: 'none' },
  { words: ['getprop'], args: 'plain' },
  { words: ['pm', 'list', 'packages'], args: 'plain' },
  { words: ['ip', 'addr'], args: 'plain' },
  { words: ['cat', '/proc/meminfo'], args: 'none' },
  { words: ['cat', '/proc/cpuinfo'], args: 'none' },
  { words: ['date'], args: 'plain' },
  { words: ['uptime'], args: 'none' },
  { words: ['netstat'], args: 'plain' },
];

/** `xcrun simctl <command> <udid> [args]` on a simulator. */
export const IOS_SIMCTL_COMMANDS: ShellCommand[] = [
  { words: ['listapps'], args: 'none' },
  { words: ['get_app_container'], args: 'plain' },
  { words: ['getenv'], args: 'plain' },
];

/**
 * `xcrun simctl spawn <udid> <command>` on a simulator. A simulator's processes
 * see this Mac's file system, so these take no arguments.
 */
export const IOS_SPAWN_COMMANDS: ShellCommand[] = [
  { words: ['ls'], args: 'none' },
  { words: ['ps'], args: 'none' },
  { words: ['whoami'], args: 'none' },
  { words: ['date'], args: 'none' },
  { words: ['uptime'], args: 'none' },
  { words: ['id'], args: 'none' },
];

export const IOS_SIMULATOR_COMMANDS: ShellCommand[] = [
  ...IOS_SIMCTL_COMMANDS,
  ...IOS_SPAWN_COMMANDS,
];

/**
 * go-ios commands on a real iPhone (`ios <command> [args] --udid <udid>`). None
 * may name a device itself: Xenon adds this phone's `--udid`.
 */
export const IOS_DEVICE_COMMANDS: ShellCommand[] = [
  { words: ['apps'], args: 'plain' },
  { words: ['info'], args: 'none' },
];

/**
 * The command's argv when it is allowed, or why it isn't. Words are split on
 * spaces; quoting is not supported, since a quote is refused anyway.
 */
export function parseShellCommand(
  input: string,
  commands: ShellCommand[],
): { argv: string[] } | { refused: string } {
  const shown = input.trim();
  // Words are separated by spaces only: a newline or tab means another line.
  if (/[^\S ]/.test(shown)) {
    return {
      refused: `Command '${shown.split(/\s/)[0]}…' is not allowed: one line, words separated by spaces.`,
    };
  }
  const argv = shown.split(/ +/).filter(Boolean);
  if (argv.length === 0) return { refused: 'Type a command.' };

  const bad = argv.find((word) => !PLAIN_WORD.test(word));
  if (bad !== undefined) {
    return {
      refused: `Command '${shown}' is not allowed: '${bad}' contains characters the shell would interpret.`,
    };
  }

  const match = commands.find(
    (command) =>
      command.words.length <= argv.length && command.words.every((word, i) => argv[i] === word),
  );
  if (!match) return { refused: `Command '${shown}' is not allowed for security reasons.` };
  if (match.args === 'none' && argv.length > match.words.length) {
    return {
      refused: `Command '${shown}' is not allowed: '${match.words.join(' ')}' takes no arguments here.`,
    };
  }
  return { argv };
}
