import { RULES_VERSION } from '../../src/game/maps.js';
import { createCampusGame, applyCampusSetup, applyCampusMove, adjudicateCampusBotFault, campusStateHash } from '../judge/campusEngine.js';
import { contentHash } from '../contracts/canonical.js';

// Engine-only transcript for M1 tooling. Production replay.v1 also needs the M2
// supervisor's runtime/source provenance, bounded private transcript and faults.
export const ENGINE_REPLAY_VERSION = 'campus-engine-replay.v1';

function applyAction(state, action) {
  if (!action || typeof action !== 'object') throw new Error('Invalid action');
  const keys = Object.keys(action).sort().join(',');
  if (action.kind === 'setup' && keys === 'kind,placements,player') return applyCampusSetup(state, action.player, action.placements);
  if (action.kind === 'move' && keys === 'kind,move,player') return applyCampusMove(state, action.player, action.move);
  if (action.kind === 'bot_fault' && keys === 'fault,kind,player') return adjudicateCampusBotFault(state, action.player, action.fault);
  throw new Error('Invalid action schema');
}

export function recordCampusReplay(config, actions) {
  let state = createCampusGame(config);
  const initialStateHash = campusStateHash(state);
  const events = actions.map((action, index) => {
    state = applyAction(state, action);
    return { seq: index + 1, action: structuredClone(action), resultingStateHash: campusStateHash(state) };
  });
  const record = {
    schemaVersion: ENGINE_REPLAY_VERSION, rulesVersion: RULES_VERSION,
    config: { id: state.roomId, seed: state.seed, map: state.map }, mapHash: state.mapHash,
    initialStateHash, events, result: state.result, terminationReason: state.terminationReason,
  };
  return { ...record, contentHash: contentHash(record) };
}

export function verifyCampusReplay(replay) {
  try {
    if (replay.schemaVersion !== ENGINE_REPLAY_VERSION || replay.rulesVersion !== RULES_VERSION) throw new Error('Unsupported replay/rules version');
    const { contentHash: expectedHash, ...content } = replay;
    if (contentHash(content) !== expectedHash) throw new Error('Replay content hash mismatch');
    let state = createCampusGame(replay.config);
    if (replay.mapHash !== state.mapHash || replay.initialStateHash !== campusStateHash(state)) throw new Error('Initial state/map hash mismatch');
    if (!Array.isArray(replay.events)) throw new Error('Events must be an array');
    for (const [index, event] of replay.events.entries()) {
      if (event.seq !== index + 1) throw new Error(`Sequence gap at event ${index + 1}`);
      state = applyAction(state, event.action);
      if (campusStateHash(state) !== event.resultingStateHash) throw new Error(`State hash mismatch at event ${event.seq}`);
    }
    if (replay.result !== state.result || replay.terminationReason !== state.terminationReason) throw new Error('Terminal result mismatch');
    return { ok: true, finished: state.phase === 'finished', stateHash: campusStateHash(state), result: state.result };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
