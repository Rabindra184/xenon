// Loaded with --require by `npm run test:all`, before any spec.
//
// src/config.ts reads DATABASE_URL once, at import time, and falls back to
// ~/.cache/xenon/xenon.db. Specs that don't stub the store (EventLogService,
// MetricsService and others writing in passing) used to write their rows into
// that file, the database a developer's own server uses. This points the whole
// run at a freshly migrated scratch file instead, and removes it at exit.
// Specs that need a database of their own still use useScratchDatabase().
/* eslint-disable @typescript-eslint/no-var-requires -- plain CommonJS, loaded before ts-node */
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbPath = path.join(os.tmpdir(), `xenon-test-run-${process.pid}-${Date.now()}.db`);
const url = `file:${dbPath}`;

execSync('npx prisma migrate deploy', {
  cwd: path.resolve(__dirname, '../..'),
  env: { ...process.env, DATABASE_URL: url },
  stdio: 'pipe',
});
process.env.DATABASE_URL = url;

process.on('exit', () => {
  for (const f of [dbPath, `${dbPath}-journal`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      // already gone
    }
  }
});
