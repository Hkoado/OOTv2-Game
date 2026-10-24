#!/usr/bin/env node
/** Explicit trusted-fixture demo only; no DB, credentials, API or remote bot input. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runCampusMatch } from '../../server/judge/campusMatchRunner.js';

try {
  const [flag, mapPath, outputPath] = process.argv.slice(2);
  if (flag !== '--trusted-dev' || !mapPath || !outputPath || process.argv.length !== 5) {
    throw new Error('Usage: node tools/cli/demo-campus-bots.js --trusted-dev <map.json> <new-replay.json>');
  }
  const root = fileURLToPath(new URL('../../examples/', import.meta.url));
  const bot = { filePath: path.join(root, 'campus_bot.py'), allowedRoot: root };
  const map = JSON.parse(readFileSync(path.resolve(mapPath), 'utf8'));
  const outcome = await runCampusMatch({ id: 'trusted-campus-demo', map, seed: 1731,
    red: bot, blue: bot, trusted: true });
  writeFileSync(path.resolve(outputPath), JSON.stringify(outcome.replay, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ profile: outcome.profile, productionReady: outcome.productionReady,
    result: outcome.result, reason: outcome.reason, plies: outcome.plyCount,
    replay: path.resolve(outputPath), limitations: outcome.limitations }));
} catch (error) {
  console.error(error.code || error.message);
  process.exitCode = 1;
}