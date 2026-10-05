import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { renderReleaseNotes } from './releaseNotes.mjs';

const fixture = () => readFileSync(new URL('./fixtures/CHANGELOG.md', import.meta.url), 'utf8');

test('version headings survive, in order', () => {
  const out = renderReleaseNotes(fixture());
  const a = out.indexOf('\n## 2.13.1\n');
  const b = out.indexOf('\n## 2.13.0\n');
  assert.ok(a > -1 && b > a);
});

test('a PR number becomes a link', () => {
  const out = renderReleaseNotes(fixture());
  assert.ok(out.includes('([#444](https://github.com/Rabindra184/xenon/pull/444))'));
});

test('a PR number inside inline code is left alone', () => {
  const out = renderReleaseNotes(fixture());
  assert.ok(out.includes('`fix (#12)`'));
  assert.ok(!out.includes('pull/12'));
});

test('a PR number inside a fenced block is left alone', () => {
  const out = renderReleaseNotes(fixture());
  assert.ok(out.includes('a fenced line (#99) stays as it is'));
  assert.ok(!out.includes('pull/99'));
});

test('the title becomes front matter and the intro is kept', () => {
  const out = renderReleaseNotes(fixture());
  assert.ok(out.startsWith('---\n'));
  assert.ok(out.includes('title: Release notes'));
  assert.ok(out.includes('description: What changed in each Xenon release.'));
  assert.ok(out.includes('toc_max_heading_level: 2'));
  assert.ok(!out.includes('# Changelog'));
  assert.ok(out.includes('All notable changes to the plugin.'));
});

test('angle brackets and braces are unchanged', () => {
  const out = renderReleaseNotes(fixture());
  assert.ok(out.includes('`<basePath>/session`'));
  assert.ok(out.includes('{}'));
});

test('the edit link points at CHANGELOG.md', () => {
  const out = renderReleaseNotes(fixture());
  assert.ok(
    out.includes('custom_edit_url: https://github.com/Rabindra184/xenon/blob/main/CHANGELOG.md'),
  );
});

test('a PR number with a second one in the same line links both', () => {
  const out = renderReleaseNotes('# Changelog\n\n## 1.0.0\n\n- both (#1) and (#2).\n');
  assert.ok(out.includes('([#1](https://github.com/Rabindra184/xenon/pull/1))'));
  assert.ok(out.includes('([#2](https://github.com/Rabindra184/xenon/pull/2))'));
});

test('a parenthesised list of PR numbers links each one', () => {
  const out = renderReleaseNotes('# Changelog\n\n## 1.0.0\n\n- both (#373, #377) and (#1 — closes #2).\n');
  assert.ok(out.includes('([#373](https://github.com/Rabindra184/xenon/pull/373), [#377](https://github.com/Rabindra184/xenon/pull/377))'));
  assert.ok(out.includes('closes [#2](https://github.com/Rabindra184/xenon/pull/2))'));
});

test('a list that wraps onto the next line is still linked', () => {
  const out = renderReleaseNotes('# Changelog\n\n## 1.0.0\n\n- a change (#345,\n  #347). More.\n');
  assert.ok(out.includes('pull/345'));
  assert.ok(out.includes('pull/347'));
});

test('inline code that wraps over two lines is left alone', () => {
  const out = renderReleaseNotes('# Changelog\n\n## 1.0.0\n\n- see `a (#5)\n  b` and (#6).\n');
  assert.ok(out.includes('`a (#5)\n  b`'));
  assert.ok(out.includes('pull/6'));
  assert.ok(!out.includes('pull/5'));
});

test('a tilde fence is a fence too', () => {
  const out = renderReleaseNotes('# Changelog\n\n## 1.0.0\n\n~~~\n(#7)\n~~~\n\n(#8)\n');
  assert.ok(!out.includes('pull/7'));
  assert.ok(out.includes('pull/8'));
});
