// The plugin's option list as the repo keeps it: the root schema.json that `npm run sync:schema`
// copies into resources/ (git-ignored) at build time. The copy is byte for byte the same, so unit
// tests read this one and need no build, as CI runs them before any build does.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { XenonSchema } from '../src/shared/types';

export const REPO_SCHEMA_PATH = resolve(__dirname, '..', '..', 'schema.json');

export function readRepoSchema(): XenonSchema {
  return JSON.parse(readFileSync(REPO_SCHEMA_PATH, 'utf8')) as XenonSchema;
}
