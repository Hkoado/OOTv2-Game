/** Campus match orchestration; persistence/accepted-attempt fencing stays outside. */
import { createCampusGame, applyCampusSetup, applyCampusMove, validateCampusSetup,
  campusLegalMoves, adjudicateCampusBotFault, BOT_FAULTS } from './campusEngine.js';
import { buildCampusBotRequest, BotProtocolError } from '../contracts/botProtocol.js';
import { recordCampusReplay, verifyCampusReplay } from '../replay/campusReplay.js';
import { createTrustedCampusSession, CampusInfrastructureError } from './campusTrustedSession.js';

/**
 * startSession is an adapter boundary, not a sandbox attestation. Launch each side
 * lazily on its first request so startup bot faults are adjudicated in color order.
 * Infrastructure errors never return a terminal result. No observer writes to DB.
 */
export async function runCampusMatch({ id, map, seed, red, blue, trusted = false,
  setupWallMs = 5000, moveWallMs = 1000, responseTotalMs = 45000,
  startSession = createTrustedCampusSession, signal }) {
  if (trusted !== true && startSession === createTrustedCampusSession) throw new CampusInfrastructureError('trusted_dev_required');
  if (![setupWallMs, moveWallMs, responseTotalMs].every((n) => Number.isSafeInteger(n) && n > 0)) {
    throw new CampusInfrastructureError('invalid_budget');
  }
  let state = createCampusGame({ id, map, seed });
  const actions = [], sessions = new Map(), elapsed = { red: 0, blue: 0 };
  let sequence = 0, cleanupFailure = null, deadlineReached = false;
  const cancel = () => { for (const session of sessions.values()) session.close().catch(() => {}); };
  const watchdog = setTimeout(() => { deadlineReached = true; cancel(); }, 120000);
  const checkCancellation = () => {
    if (signal?.aborted) throw new CampusInfrastructureError('match_cancelled');
    if (deadlineReached) throw new CampusInfrastructureError('match_watchdog');
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (state.phase !== 'finished') {
      checkCancellation();
      const player = state.phase === 'setup_red' ? 'red' : state.phase === 'setup_blue' ? 'blue' : state.turn;
      const kind = state.phase === 'playing' ? 'move' : 'setup';
      let action;
      try {
        if (!sessions.has(player)) {
          const side = player === 'red' ? red : blue;
          sessions.set(player, await startSession({ ...side, trusted, responseTotalMs }));
        }
        checkCancellation();
        const request = buildCampusBotRequest(state, player, ++sequence, {
          responseWallMs: kind === 'setup' ? setupWallMs : moveWallMs,
          // Trusted adapter does not measure CPU; never describe this field as a measurement.
          cpuRemainingMs: 30000,
        });
        const response = await sessions.get(player).request(request);
        checkCancellation();
        if (kind === 'setup') {
          if (!validateCampusSetup(state, player, response?.placements).ok) throw new BotProtocolError('INVALID_SETUP', 'Illegal setup');
          state = applyCampusSetup(state, player, response.placements);
          action = { kind: 'setup', player, placements: response.placements };
        } else {
          if (!response || Object.keys(response).sort().join(',') !== 'pieceId,to'
            || !campusLegalMoves(state, player).some((move) => move.pieceId === response.pieceId && move.to === response.to)) {
            throw new BotProtocolError('ILLEGAL_MOVE', 'Illegal move');
          }
          state = applyCampusMove(state, player, response);
          action = { kind: 'move', player, move: response };
        }
      } catch (error) {
        checkCancellation();
        if (!(error instanceof BotProtocolError) || !BOT_FAULTS.includes(error.code)) throw error;
        state = adjudicateCampusBotFault(state, player, error.code);
        action = { kind: 'bot_fault', player, fault: error.code };
      }
      actions.push(action);
    }
    for (const [player, session] of sessions) elapsed[player] = session.metrics();
  } finally {
    clearTimeout(watchdog);
    signal?.removeEventListener('abort', cancel);
    const cleanup = await Promise.allSettled([...sessions.values()].map((session) => session.close()));
    cleanupFailure = cleanup.find((result) => result.status === 'rejected');
    if (cleanupFailure) throw new CampusInfrastructureError('cleanup_not_confirmed');
  }
  const replay = recordCampusReplay({ id, map, seed }, actions);
  if (!verifyCampusReplay(replay).ok) throw new CampusInfrastructureError('replay_verification_failed');
  const profiles = [...new Set([...sessions.values()].map((session) => session.profile).filter(Boolean))];
  const reported = [...sessions.values()].flatMap((session) => session.limitations ?? []);
  const limitations = new Set(reported.length > 0 ? reported
    : ['No OS sandbox', 'CPU/RAM not measured', 'No cgroup freeze']);
  limitations.add('No DB attempt fencing');
  return { profile: 'campus-engine-trusted.v1', productionReady: false,
    result: state.result, reason: state.terminationReason, plyCount: state.ply, replay,
    sandboxProfiles: profiles, metrics: elapsed, limitations: [...limitations] };
}