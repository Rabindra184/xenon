// Fails when a page is unfinished or uses a term that has been retired (rules
// in lib/checkContent.mjs). Run by hand with `npm run check`, which looks at
// every page under docs/ and the code under src/, or name files (paths are
// relative to website/): `npm run check -- docs/leases.md`. CI runs it before
// the build. Exits 1, with one line per problem, when it finds any.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findProblems } from './lib/checkContent.mjs';

const websiteRoot = fileURLToPath(new URL('..', import.meta.url));

// Every file under `dir` (relative to website/) whose name passes `wanted`,
// in a stable order, as website-relative paths with forward slashes.
function walk(dir, wanted) {
  const found = [];
  for (const entry of readdirSync(path.join(websiteRoot, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') found.push(...walk(relative, wanted));
    } else if (wanted(entry.name)) {
      found.push(relative);
    }
  }
  return found.sort();
}

const isPage = (name) => /\.mdx?$/.test(name);
const isSource = (name) => /\.(tsx|ts|css)$/.test(name);

const named = process.argv.slice(2);
const paths = named.length > 0 ? named : [...walk('docs', isPage), ...walk('src', isSource)];

const files = paths.map((filePath) => {
  try {
    return { path: filePath.split(path.sep).join('/'), text: readFileSync(path.resolve(websiteRoot, filePath), 'utf8') };
  } catch (error) {
    console.error(`cannot read ${filePath}: ${error.message}`);
    process.exit(2);
  }
});

const problems = findProblems(files);
for (const { path: filePath, line, problem } of problems) {
  console.log(`${filePath}:${line}: ${problem}`);
}

if (problems.length > 0) {
  const pages = new Set(problems.map((p) => p.path)).size;
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'} in ${pages} file${pages === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log(`checked ${files.length} file${files.length === 1 ? '' : 's'}, no problems`);
