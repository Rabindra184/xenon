import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import util from 'util';
import _ from 'lodash';
import YAML from 'yaml';
import { SecureValuesPreprocessor } from '@appium/logger/build/lib/secure-values-preprocessor';
import { MAX_LOG_BODY_LENGTH } from '@appium/base-driver/build/lib/constants';
import { generateToken } from '../../../src/services/lease/leaseToken';

// Appium logs every request body before any plugin sees it: the POST /session
// capabilities with their tokens, and the dashboard's login body with its
// password. Xenon can't strip them from those lines, so the documented Appium
// log filters have to. This runs the filters exactly as documented — the JSON
// for --log-filters and the YAML for a --config file, read straight out of the
// doc — through Appium's own preprocessor, over the forms Appium logs.

const ROOT = path.resolve(__dirname, '../../..');
const DOC = path.join(ROOT, 'docs/superpowers/specs/2026-05-14-server-side-lease-api-design.md');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');
const HEADING = "#### Keeping tokens and passwords out of Appium's own log";
const REDACTED = '**REDACTED**';

type Language = 'json' | 'yaml';

// The text from `heading` to the next heading of any level.
function sectionAfter(text: string, heading: string): string {
  const start = text.indexOf(heading);
  expect(start, `${heading.trim()} found`).to.be.greaterThan(-1);
  const rest = text.slice(start + heading.length);
  const end = rest.search(/\n#+ /);
  return end === -1 ? rest : rest.slice(0, end);
}

// Every ```language block in `text`, dedented by its fence's indent.
function fencedBlocks(text: string, language: Language): string[] {
  const fence = new RegExp('^( *)```' + language + '\\n([\\s\\S]*?)\\n\\1```', 'gm');
  return [...text.matchAll(fence)].map(([, indent, body]) =>
    body
      .split('\n')
      .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
      .join('\n'),
  );
}

// The doc's blocks: the token rule, then the password rule.
const docBlocks = (language: Language) =>
  fencedBlocks(sectionAfter(fs.readFileSync(DOC, 'utf8'), HEADING), language);
const RULE_INDEX = { token: 0, password: 1 };

function docBlock(language: Language, rule: keyof typeof RULE_INDEX): string {
  const block = docBlocks(language)[RULE_INDEX[rule]];
  expect(block, `the ${rule} rule's ${language} block under ${HEADING}`).to.be.a('string');
  return block;
}

const RULE_FORMS: Array<[string, Language, (block: string) => unknown[]]> = [
  ['--log-filters JSON', 'json', (block) => JSON.parse(block)],
  [
    '--config YAML (server.log-filters)',
    'yaml',
    (block) => YAML.parse(block).server['log-filters'],
  ],
];

async function filterFrom(rules: unknown[]): Promise<SecureValuesPreprocessor> {
  const pre = new SecureValuesPreprocessor();
  expect(await pre.loadRules(rules as any)).to.deep.equal([]);
  expect(pre.rules).to.have.length(rules.length);
  return pre;
}

// Appium's own cut: _.truncate to MAX_LOG_BODY_LENGTH, "..." included.
const appiumCut = (body: string) => _.truncate(body, { length: MAX_LOG_BODY_LENGTH });

/**
 * `body(padding)` cut by Appium `into` characters inside `secret` (the secret
 * as the body spells it). Returns the cut body and where the secret starts.
 */
function cutInside(body: (padding: number) => string, secret: string, into: number) {
  const at = body(0).indexOf(secret);
  expect(at).to.be.greaterThan(-1);
  const start = MAX_LOG_BODY_LENGTH - '...'.length - into;
  const cut = appiumCut(body(start - at));
  expect(cut.slice(start)).to.equal(secret.slice(0, into) + '...');
  return { cut, start };
}

/** A logged line, and the same line as it must read once filtered. */
interface Logged {
  raw: string;
  expected: string;
}

// `raw` with `length` characters at `start` replaced by the redaction mark.
function redacted(raw: string, start: number, length: number): Logged {
  expect(start).to.be.greaterThan(-1);
  return { raw, expected: raw.slice(0, start) + REDACTED + raw.slice(start + length) };
}

// An [HTTP] request line: Appium logs the body, cut, after the method and URL.
const httpLine = (url: string, body: string) => `[HTTP] --> POST ${url} ${body}`;
// The same line as Appium colours it on a terminal.
const colouredHttpLine = (url: string, body: string) =>
  `[HTTP] \u001b[37m-->\u001b[39m \u001b[37mPOST\u001b[39m \u001b[37m${url}\u001b[39m ` +
  `\u001b[90m${body}\u001b[39m`;

// A line whose body Appium cut inside the secret: everything from the secret
// on, the cut's "..." included, is redacted, and nothing before it changes.
function cutLine(url: string, body: (padding: number) => string, secret: string, into: number) {
  const { cut, start } = cutInside(body, secret, into);
  const raw = httpLine(url, cut);
  const at = raw.length - cut.length + start;
  return { raw, expected: raw.slice(0, at) + REDACTED };
}

const cutInto = (into: number) =>
  `a body Appium cut ${into} character${into === 1 ? '' : 's'} into it`;

// ---------------------------------------------------------------------------
// Tokens: the API token, a session JWT and a lease token.

const ACCESS_KEY = 'xen_AbC123dEf456';
const TOKENS: Array<{ key: string; value: string; options: Record<string, string> }> = [
  {
    key: 'token',
    value: generateToken(),
    options: { accessKey: ACCESS_KEY },
  },
  {
    key: 'sessionToken',
    value: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1In0.sig_-x',
    options: {},
  },
  {
    key: 'leaseToken',
    value: generateToken(),
    options: { accessKey: ACCESS_KEY, leaseId: 'lse_1' },
  },
];

function sessionRequest(options: Record<string, string>, padding = 0) {
  return {
    capabilities: {
      alwaysMatch: {
        platformName: 'Android',
        'appium:padding': 'x'.repeat(padding),
        'xe:options': options,
      },
      firstMatch: [{}],
    },
  };
}

function tokenLines(key: string, token: string, others: Record<string, string>) {
  const options = { ...others, [key]: token };
  const body = (padding = 0) => JSON.stringify(sessionRequest(options, padding));
  const once = (raw: string) => redacted(raw, raw.indexOf(token), token.length);
  const lines: Array<[string, () => Logged]> = [
    ['the JSON body', () => once(body())],
    ['the [HTTP] request line', () => once(httpLine('/session', appiumCut(body())))],
    ['the coloured [HTTP] request line', () => once(colouredHttpLine('/session', body()))],
    [
      'the createSession args line',
      () =>
        once(
          'Calling AppiumDriver.createSession() with args: ' +
            appiumCut(JSON.stringify([null, null, sessionRequest(options).capabilities])),
        ),
    ],
    ['util.inspect output', () => once(util.inspect(sessionRequest(options), { depth: 5 }))],
    ['doubly-escaped JSON', () => once(JSON.stringify(body()))],
  ];
  for (const into of [1, 10, 30]) {
    lines.push([cutInto(into), () => cutLine('/session', body, token, into)]);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Passwords: the dashboard's POST /xenon/api/auth/login body.

const LOGIN_URL = '/xenon/api/auth/login';

// A password can hold any character. Most of these would get past a rule that
// stops at the first quote, or make one that doesn't read escapes eat the rest
// of the line.
const PASSWORDS = [
  'hunter2-Hunter2',
  "it's mine", // util.inspect switches to "..."
  'say "hi", } then', // escaped quotes and JSON punctuation
  'it\'s "all" `three`', // util.inspect escapes its own quote
  'ends in a backslash\\',
  '","password":"decoy', // reads like the next field
  "password: 'decoy", // reads like the util.inspect key
  'my token: abc"def', // the token rule rewrites part of it first
  'tab\tnew\nline\u001bescape', // control characters are escaped
  'pässwörd 🔑 ok',
];

// Long enough to cut 30 characters in, with an escape early on. No astral
// characters: lodash counts those as one when it cuts.
const LONG_PASSWORD = 'c"x\\y it\'s, }] "correct horse" `battery` staple ä\n';

function loginBody(password: string, padding = 0) {
  // Padding the address moves the password, keeping the body's shape.
  return { email: `${'x'.repeat(padding)}qa@example.com`, password };
}

function passwordLines(password: string) {
  const body = (padding = 0) => JSON.stringify(loginBody(password, padding));
  const json = JSON.stringify(password).slice(1, -1);
  const inspected = util.inspect(password);
  // Anchored on what follows the password: it is the body's last field.
  const at = (raw: string, spelled: string, after: string) =>
    redacted(raw, raw.lastIndexOf(spelled + after), spelled.length);
  const lines: Array<[string, () => Logged]> = [
    ['the JSON body', () => at(body(), json, '"}')],
    ['the [HTTP] request line', () => at(httpLine(LOGIN_URL, appiumCut(body())), json, '"}')],
    ['the coloured [HTTP] request line', () => at(colouredHttpLine(LOGIN_URL, body()), json, '"}')],
    [
      'util.inspect output',
      () => at(util.inspect(loginBody(password)), inspected.slice(1, -1), inspected[0]),
    ],
    [
      'doubly-escaped JSON',
      () => at(JSON.stringify(body()), JSON.stringify(json).slice(1, -1), '\\"}"'),
    ],
  ];
  return lines;
}

function passwordCutLines() {
  const body = (padding = 0) => JSON.stringify(loginBody(LONG_PASSWORD, padding));
  const json = JSON.stringify(LONG_PASSWORD).slice(1, -1);
  return [1, 10, 30].map((into): [string, () => Logged] => [
    cutInto(into),
    () => cutLine(LOGIN_URL, body, json, into),
  ]);
}

describe("the documented Appium log filters keep tokens and passwords out of Appium's log", () => {
  for (const [form, language, parse] of RULE_FORMS) {
    describe(form, () => {
      const tokenRule = () => parse(docBlock(language, 'token'));
      const passwordRule = () => parse(docBlock(language, 'password'));
      // An operator may run the token rule alone (it shipped first) or both.
      const withTokenRule: Array<[string, () => unknown[]]> = [
        ['the token rule', tokenRule],
        ['both rules', () => [...tokenRule(), ...passwordRule()]],
      ];

      for (const { key, value, options } of TOKENS) {
        describe(`a ${key}`, () => {
          for (const [name, line] of tokenLines(key, value, options)) {
            it(`is redacted from ${name}`, async () => {
              const { raw, expected } = line();
              for (const [rules, load] of withTokenRule) {
                const out = (await filterFrom(load())).preprocess(raw);
                // Only the token changes: the access key, the lease id and
                // the rest of the line are kept.
                expect(out, rules).to.equal(expected);
                expect(out, rules).to.not.include(value.slice(0, 8));
                expect(out, rules).to.not.match(
                  new RegExp(`${key}\\\\?["']?\\s*:\\s*\\\\?["']?${_.escapeRegExp(value[0])}`),
                );
              }
            });
          }
        });
      }

      it('keeps the access key, which names a key without proving it', async () => {
        const raw = JSON.stringify(sessionRequest({ accessKey: ACCESS_KEY }));
        const pre = await filterFrom([...tokenRule(), ...passwordRule()]);
        expect(pre.preprocess(raw)).to.equal(raw);
      });

      describe('a password', () => {
        for (const password of PASSWORDS) {
          for (const [name, line] of passwordLines(password)) {
            it(`${JSON.stringify(password)} is redacted from ${name}`, async () => {
              const { raw, expected } = line();
              for (const [rules, load] of [
                ['the password rule', passwordRule],
                ['both rules', () => [...tokenRule(), ...passwordRule()]],
              ] as Array<[string, () => unknown[]]>) {
                const out = (await filterFrom(load())).preprocess(raw);
                // Exactly the password goes: the address, the closing quote
                // and everything after it stay.
                expect(out, rules).to.equal(expected);
                expect(out, rules).to.include('qa@example.com');
              }
            });
          }
        }

        for (const [name, line] of passwordCutLines()) {
          it(`is redacted from ${name}`, async () => {
            const { raw, expected } = line();
            const out = (await filterFrom([...tokenRule(), ...passwordRule()])).preprocess(raw);
            expect(out).to.equal(expected);
          });
        }
      });
    });
  }

  it('shows each rule once in each form, and reads the same in both', () => {
    expect(docBlocks('json')).to.have.length(2);
    expect(docBlocks('yaml')).to.have.length(2);
    for (const rule of ['token', 'password'] as const) {
      expect(YAML.parse(docBlock('yaml', rule)).server['log-filters'], rule).to.deep.equal(
        JSON.parse(docBlock('json', rule)),
      );
    }
  });

  it('shows the token rule exactly as the 2.0.0 CHANGELOG publishes it', () => {
    const changelog = fs.readFileSync(CHANGELOG, 'utf8');
    const release = changelog.indexOf('\n## 2.0.0\n');
    const entry = changelog.indexOf("**Keep tokens out of Appium's own request log.**", release);
    expect(release).to.be.greaterThan(-1);
    expect(entry).to.be.greaterThan(release);
    for (const language of ['json', 'yaml'] as Language[]) {
      const published = fencedBlocks(changelog.slice(entry), language)[0];
      expect(docBlock(language, 'token'), language).to.equal(published);
    }
  });
});
