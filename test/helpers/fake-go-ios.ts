import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * A stand-in for the go-ios binary: a script that prints `output` when it is
 * run with exactly `args` and `ENABLE_GO_IOS_AGENT=yes`, and otherwise says
 * what it got on stderr and exits 3.
 *
 * go-ios comes with the plugin, under the user's `APPIUM_HOME`, which can be
 * any folder name. This one's folder holds a double quote, a `$` and
 * backticks, so only a call that runs the path as the command, with its
 * arguments in a list, can run it: in a shell string the quote ends early
 * and the rest is expanded. Remove it with `remove()`.
 */
export interface FakeGoIos {
  binary: string;
  remove(): void;
}

export function fakeGoIos(args: string[], output: string): FakeGoIos {
  for (const arg of args) {
    if (!/^[\w.@=-]+$/.test(arg)) throw new Error(`fakeGoIos: keep arguments plain: ${arg}`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon go-ios "q" $HOME `echo x` '));
  const binary = path.join(dir, 'ios');
  fs.writeFileSync(
    binary,
    [
      '#!/bin/sh',
      `if [ "$*" = '${args.join(' ')}' ] && [ "$ENABLE_GO_IOS_AGENT" = yes ]; then`,
      "  cat <<'GO_IOS_OUTPUT'",
      output,
      'GO_IOS_OUTPUT',
      '  exit 0',
      'fi',
      'echo "unexpected: $* (ENABLE_GO_IOS_AGENT=$ENABLE_GO_IOS_AGENT)" >&2',
      'exit 3',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  return { binary, remove: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
