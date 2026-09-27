import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import util from 'util';
import _ from 'lodash';
import YAML from 'yaml';
import { SecureValuesPreprocessor } from '@appium/logger/build/lib/secure-values-preprocessor';
import { MAX_LOG_BODY_LENGTH } from '@appium/base-driver/build/lib/constants';
import { generateToken } from '../../../src/services/lease/leaseToken';

// Appium logs the POST /session body before any plugin sees it, so Xenon
// can't strip the lease token from that line; the documented Appium log
// filter has to. This runs the filter exactly as documented — the JSON for
// --log-filters and the YAML for a --config file, read straight out of the
// doc — through Appium's own preprocessor, over the forms Appium logs.

const DOC = path.resolve(
  __dirname,
  '../../../docs/superpowers/specs/2026-05-14-server-side-lease-api-design.md',
);
const HEADING = "#### Keeping the lease token out of Appium's own log";

function fencedBlock(language: 'json' | 'yaml'): string {
  const doc = fs.readFileSync(DOC, 'utf8');
  const section = doc.slice(doc.indexOf(HEADING));
  expect(doc.indexOf(HEADING), `${HEADING} in ${DOC}`).to.be.greaterThan(-1);
  const match = section.match(new RegExp('```' + language + '\\n([\\s\\S]*?)\\n```'));
  if (!match) throw new Error(`no ${language} block under ${HEADING}`);
  return match[1];
}

async function filterFrom(rules: unknown): Promise<SecureValuesPreprocessor> {
  const pre = new SecureValuesPreprocessor();
  expect(await pre.loadRules(rules as any)).to.deep.equal([]);
  return pre;
}

const TOKEN = generateToken();

function sessionBody(padding = 0) {
  return JSON.stringify({
    capabilities: {
      alwaysMatch: {
        platformName: 'Android',
        'appium:padding': 'x'.repeat(padding),
        'xenon:options': { leaseId: 'lse_1', leaseToken: TOKEN },
      },
      firstMatch: [{}],
    },
  });
}

// Appium's own cut: _.truncate to MAX_LOG_BODY_LENGTH, "..." included.
const appiumCut = (body: string) => _.truncate(body, { length: MAX_LOG_BODY_LENGTH });

// A body whose cut lands `into` characters inside the token.
function truncatedInsideToken(into: number): string {
  const at = sessionBody().indexOf(TOKEN);
  const cutAt = MAX_LOG_BODY_LENGTH - '...'.length;
  const cut = appiumCut(sessionBody(cutAt - at - into));
  expect(cut).to.include(TOKEN.slice(0, into));
  expect(cut).to.not.include(TOKEN);
  return cut;
}

const LOGGED: Array<[string, () => string]> = [
  ['the full JSON body', () => `--> POST /session ${sessionBody()}`],
  [
    'the colourised body Appium prints',
    () => `--> POST /session \u001b[90m${sessionBody()}\u001b[39m`,
  ],
  [
    'the createSession args line',
    () =>
      `Calling AppiumDriver.createSession() with args: ${appiumCut(JSON.stringify([null, null, JSON.parse(sessionBody()).capabilities]))}`,
  ],
  ['a util.inspect form', () => util.inspect(JSON.parse(sessionBody()), { depth: 5 })],
  ['doubly-escaped JSON', () => JSON.stringify(sessionBody())],
  ['a body Appium cut 30 characters into the token', () => truncatedInsideToken(30)],
  ['a body Appium cut 1 character into the token', () => truncatedInsideToken(1)],
];

describe("the documented Appium log filter keeps the lease token out of Appium's log", () => {
  const forms: Array<[string, () => unknown]> = [
    ['--log-filters JSON', () => JSON.parse(fencedBlock('json'))],
    [
      '--config YAML (server.log-filters)',
      () => YAML.parse(fencedBlock('yaml')).server['log-filters'],
    ],
  ];

  for (const [form, rules] of forms) {
    describe(form, () => {
      for (const [name, line] of LOGGED) {
        it(`redacts ${name}`, async () => {
          const pre = await filterFrom(rules());
          const raw = line();
          const out = pre.preprocess(raw);
          // No run of the token's characters survives, not even its first one
          // beside the key.
          expect(out).to.include('**LEASE TOKEN**');
          expect(out).to.not.match(
            new RegExp(`leaseToken\\\\?["']?\\s*:\\s*\\\\?["']?${TOKEN[0]}`),
          );
          expect(out).to.not.include(TOKEN.slice(0, 8));
          // The lease id is not a secret, and the rest of the line is kept.
          expect(out).to.include('lse_1');
        });
      }
    });
  }

  it('reads the same rule in both forms', () => {
    expect(YAML.parse(fencedBlock('yaml')).server['log-filters']).to.deep.equal(
      JSON.parse(fencedBlock('json')),
    );
  });
});
