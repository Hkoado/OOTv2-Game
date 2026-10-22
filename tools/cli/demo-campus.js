import { readFile, writeFile } from 'node:fs/promises';
import { createCampusGame, applyCampusSetup, applyCampusMove, campusLegalMoves, campusObservation } from '../../server/judge/campusEngine.js';
import { recordCampusReplay, verifyCampusReplay } from '../../server/replay/campusReplay.js';

// Engine smoke demo only: fixed first-legal decisions; never executes Python source.
try {
  if (process.argv.length !== 4) throw new Error('Usage: node tools/cli/demo-campus.js <map.json> <output-replay.json>');
  const map = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const config = { map, seed: 1731, id: 'engine-demo' };
  let state = createCampusGame(config);
  const actions = [];
  for (const player of ['red', 'blue']) {
    const obs = campusObservation(state, player);
    const placements = obs.unplaced.map((p, i) => ({ pieceId: p.id, square: obs.availableSquares[i] }));
    state = applyCampusSetup(state, player, placements);
    actions.push({ kind: 'setup', player, placements });
  }
  while (state.phase === 'playing') {
    const player = state.turn;
    const move = campusLegalMoves(state)[0];
    state = applyCampusMove(state, player, move);
    actions.push({ kind: 'move', player, move });
  }
  const replay = recordCampusReplay(config, actions);
  const verified = verifyCampusReplay(replay);
  if (!verified.ok) throw new Error(verified.error);
  await writeFile(process.argv[3], JSON.stringify(replay, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({ ...verified, terminationReason: state.terminationReason, plies: state.ply, replay: process.argv[3] }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
