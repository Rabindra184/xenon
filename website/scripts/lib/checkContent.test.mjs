import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findProblems } from './checkContent.mjs';

const STALE_TERMS = [
  'df:options',
  'x-xenon-api-key',
  'xe:priority',
  'max_thermal_status',
  '5-tier',
  'Florence',
  'gRPC',
  'Appium 2.x',
  'estCostUsd',
  'bootstrap-key',
  'xenon-platform/xenon',
];

const check = (path, text) => findProblems([{ path, text }]);

test('a clean file has no problems', () => {
  assert.deepEqual(check('docs/foo.md', '# Foo\n\nAll good here.\n'), []);
});

test('no files, no problems', () => {
  assert.deepEqual(findProblems([]), []);
});

test('the stub marker is an unfinished page, with its line', () => {
  const problems = check('docs/foo.md', '# Foo\n\n> XENON-DOCS-STUB: write this page\n');
  assert.equal(problems.length, 1);
  assert.equal(problems[0].path, 'docs/foo.md');
  assert.equal(problems[0].line, 3);
  assert.match(problems[0].problem, /unfinished page/);
});

for (const term of STALE_TERMS) {
  test(`stale term "${term}" is caught, on the right line`, () => {
    const problems = check('docs/foo.md', `# Foo\n\nclean line\nsome ${term} here\nclean again\n`);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].path, 'docs/foo.md');
    assert.equal(problems[0].line, 4);
    assert.ok(problems[0].problem.includes(term), problems[0].problem);
  });
}

test('5-Tier in mixed case is caught', () => {
  for (const text of ['The 5-Tier ladder', 'THE 5-TIER LADDER', 'a 5-tier ladder']) {
    const problems = check('docs/foo.md', text);
    assert.equal(problems.length, 1, text);
    assert.ok(problems[0].problem.includes('5-tier'));
  }
});

test('the other terms are matched exactly, not in any case', () => {
  assert.deepEqual(check('docs/foo.md', 'florence and grpc and appium 2.x'), []);
});

test('each occurrence on its own line is its own problem', () => {
  const problems = check('docs/foo.md', 'gRPC\nclean\nFlorence and gRPC\n');
  assert.deepEqual(
    problems.map((p) => [p.line, p.problem.includes('gRPC'), p.problem.includes('Florence')]),
    [
      [1, true, false],
      [3, false, true],
      [3, true, false],
    ],
  );
});

test('a term twice on one line is one problem', () => {
  assert.equal(check('docs/foo.md', 'gRPC and gRPC again').length, 1);
});

test('Windows line endings do not shift line numbers', () => {
  const problems = check('docs/foo.md', 'one\r\ntwo\r\ngRPC\r\n');
  assert.equal(problems[0].line, 3);
});

test('release-notes.md may contain every stale term', () => {
  const text = STALE_TERMS.map((t) => `- ${t}`).join('\n');
  assert.deepEqual(check('docs/release-notes.md', text), []);
});

test('release-notes.md is exempt by its name, wherever it sits', () => {
  assert.deepEqual(check('/abs/website/docs/release-notes.md', 'gRPC'), []);
  assert.deepEqual(check('docs\\release-notes.md', 'gRPC'), []);
});

test('release-notes.md is not exempt from the unfinished-page marker', () => {
  assert.equal(check('docs/release-notes.md', 'XENON-DOCS-STUB').length, 1);
});

test('upgrading.md may say df:options, and nothing else stale', () => {
  assert.deepEqual(check('docs/upgrading.md', 'Xenon no longer reads df:options.'), []);
  const problems = check('docs/upgrading.md', 'line one\nxe:priority is gone\ndf:options too\n');
  assert.equal(problems.length, 1);
  assert.equal(problems[0].line, 2);
  assert.ok(problems[0].problem.includes('xe:priority'));
});

test('df:options is a problem on any other page', () => {
  assert.equal(check('docs/capabilities.md', 'df:options').length, 1);
  assert.equal(check('src/pages/index.tsx', 'df:options').length, 1);
});

test('problems come back file by file, line by line', () => {
  const problems = findProblems([
    { path: 'docs/a.md', text: 'ok\ngRPC\n' },
    { path: 'docs/b.md', text: 'XENON-DOCS-STUB\n' },
  ]);
  assert.deepEqual(
    problems.map((p) => [p.path, p.line]),
    [
      ['docs/a.md', 2],
      ['docs/b.md', 1],
    ],
  );
});
