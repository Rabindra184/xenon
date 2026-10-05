const REPO = 'https://github.com/Rabindra184/xenon';

const FRONT_MATTER = [
  '---',
  'title: Release notes',
  'description: What changed in each Xenon release.',
  'toc_max_heading_level: 2',
  `custom_edit_url: ${REPO}/blob/main/CHANGELOG.md`,
  '---',
  '',
].join('\n');

const prLink = (n) => `[#${n}](${REPO}/pull/${n})`;

// A parenthetical that opens with a PR number: "(#444)", "(#373, #377)" or
// "(#157 — closes #149, #150)". It has no nested parentheses or backticks, so
// it never reaches into a code span.
const PR_GROUP = /\(#\d+[^()`]*\)/g;

const linkPullRequests = (text) =>
  text.replace(PR_GROUP, (group) => group.replace(/#(\d+)/g, (_, n) => prLink(n)));

// Splits a paragraph into text and inline code spans, the way CommonMark reads
// them: a run of N backticks opens a span that the next run of exactly N
// backticks closes. A run with no partner is plain text.
function mapOutsideInlineCode(paragraph, fn) {
  let out = '';
  let text = '';
  let i = 0;
  while (i < paragraph.length) {
    if (paragraph[i] !== '`') {
      text += paragraph[i++];
      continue;
    }
    let runEnd = i;
    while (paragraph[runEnd] === '`') runEnd++;
    const run = paragraph.slice(i, runEnd);
    let close = -1;
    for (let j = runEnd; j < paragraph.length; ) {
      if (paragraph[j] !== '`') {
        j++;
        continue;
      }
      let k = j;
      while (paragraph[k] === '`') k++;
      if (k - j === run.length) {
        close = k;
        break;
      }
      j = k;
    }
    if (close === -1) {
      text += run;
      i = runEnd;
    } else {
      out += fn(text) + paragraph.slice(i, close);
      text = '';
      i = close;
    }
  }
  return out + fn(text);
}

// Applies fn to prose only: not to fenced code blocks, and not to inline code.
// Inline code can wrap across lines but never across a blank line, so each
// paragraph is read on its own.
function mapProse(markdown, fn) {
  const lines = markdown.split('\n');
  const result = [];
  let paragraph = [];
  let fence = null;

  const flush = () => {
    if (paragraph.length === 0) return;
    result.push(mapOutsideInlineCode(paragraph.join('\n'), fn));
    paragraph = [];
  };

  for (const line of lines) {
    if (fence) {
      result.push(line);
      const closing = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) fence = null;
      continue;
    }
    const opening = line.match(/^\s*(`{3,}|~{3,})/);
    if (opening) {
      flush();
      fence = opening[1];
      result.push(line);
    } else if (line.trim() === '') {
      flush();
      result.push(line);
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return result.join('\n');
}

export function renderReleaseNotes(changelog) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const titleAt = lines.findIndex((line) => /^# /.test(line));
  const before = titleAt === -1 ? lines : lines.slice(0, titleAt);
  const after = titleAt === -1 ? [] : lines.slice(titleAt + 1);
  const body = [...before, ...after].join('\n').replace(/^\n+/, '');
  return FRONT_MATTER + '\n' + mapProse(body, linkPullRequests);
}
