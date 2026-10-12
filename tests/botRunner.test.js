import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runBotRequest,
  resolvePython,
  resolveBotPath,
  parseSingleLineJson,
  BOT_ERROR_CODES,
} from '../server/judge/botRunner.js';
import { PLAYERS } from '../src/game/constants.js';
import {
  createTournamentGame,
  buildSetupRequest,
  validatePlacements,
  applySetup,
  buildMoveRequest,
  applyValidatedMove,
  listAllLegalMoves,
} from '../server/judge/gameAdapter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(here, 'fixtures');
const EXAMPLES_DIR = path.join(here, '..', 'examples');
const SAMPLE_BOT = path.join(EXAMPLES_DIR, 'sample_bot.py');

const python = resolvePython();
const skip = python ? false : 'Không tìm thấy Python 3 trên máy để chạy test bot runner';

function fixture(name) {
  return path.join(FIXTURES_DIR, name);
}

/** Dựng state đã setup xong bằng một bot file bất kỳ. */
async function runSetupBothSides(botPath, allowedRoot) {
  let state = createTournamentGame();
  const redLive = await runBotRequest({
    filePath: botPath,
    allowedRoot,
    payload: buildSetupRequest(state, PLAYERS.RED, 5),
    timeoutMs: 3000,
  });
  assert.equal(redLive.ok, true, redLive.message);
  const redValid = validatePlacements(PLAYERS.RED, redLive.response.placements);
  assert.equal(redValid.ok, true, redValid.message);
  state = applySetup(state, PLAYERS.RED, redValid.byId);

  const blueLive = await runBotRequest({
    filePath: botPath,
    allowedRoot,
    payload: buildSetupRequest(state, PLAYERS.BLUE, 5),
    timeoutMs: 3000,
  });
  assert.equal(blueLive.ok, true, blueLive.message);
  const blueValid = validatePlacements(PLAYERS.BLUE, blueLive.response.placements);
  assert.equal(blueValid.ok, true, blueValid.message);
  return applySetup(state, PLAYERS.BLUE, blueValid.byId);
}

test('M2: xác định được Python 3 trên máy', () => {
  if (!python) {
    console.warn('CẢNH BÁO: chưa có Python 3, các test bot runner sẽ bị skip');
    return;
  }
  assert.ok(python.cmd);
});

test('M2: sample bot xếp đúng 9 quân cho cả Đỏ và Xanh', { skip }, async () => {
  const state = await runSetupBothSides(SAMPLE_BOT, EXAMPLES_DIR);
  assert.equal(Object.keys(state.pieces).length, 18);
  const redPieces = Object.values(state.pieces).filter((p) => p.player === PLAYERS.RED);
  const bluePieces = Object.values(state.pieces).filter((p) => p.player === PLAYERS.BLUE);
  assert.equal(redPieces.length, 9);
  assert.equal(bluePieces.length, 9);
});

test('M2: sample bot trả nước đi hợp lệ và judge chấp nhận', { skip }, async () => {
  const state = await runSetupBothSides(SAMPLE_BOT, EXAMPLES_DIR);
  const moveLive = await runBotRequest({
    filePath: SAMPLE_BOT,
    allowedRoot: EXAMPLES_DIR,
    payload: buildMoveRequest(state, PLAYERS.RED, 7, 1),
    timeoutMs: 2000,
  });
  assert.equal(moveLive.ok, true, moveLive.message);
  const applied = applyValidatedMove(state, PLAYERS.RED, moveLive.response);
  assert.equal(applied.state.turn, PLAYERS.BLUE);
  assert.equal(applied.state.history.length, 1);
});

test('M2: bot in rác ra stdout bị coi là bad_json', { skip }, async () => {
  const result = await runBotRequest({
    filePath: fixture('bot_noisy_stdout.py'),
    allowedRoot: FIXTURES_DIR,
    payload: { protocol_version: 1, request: 'setup' },
    timeoutMs: 3000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, BOT_ERROR_CODES.BAD_JSON);
});

test('M2: bot in nhiều dòng ra stdout bị coi là bad_json', { skip }, async () => {
  const result = await runBotRequest({
    filePath: fixture('bot_multiline.py'),
    allowedRoot: FIXTURES_DIR,
    payload: { protocol_version: 1, request: 'setup' },
    timeoutMs: 3000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, BOT_ERROR_CODES.BAD_JSON);
});

test('M2: bot thoát mã lỗi bị coi là nonzero_exit', { skip }, async () => {
  const result = await runBotRequest({
    filePath: fixture('bot_exit_error.py'),
    allowedRoot: FIXTURES_DIR,
    payload: { protocol_version: 1, request: 'setup' },
    timeoutMs: 3000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, BOT_ERROR_CODES.NONZERO_EXIT);
});


test('M2: bot treo vô hạn bị timeout và bị kill, không treo caller', { skip }, async () => {
  const started = Date.now();
  const result = await runBotRequest({
    filePath: fixture('bot_hang.py'),
    allowedRoot: FIXTURES_DIR,
    payload: { protocol_version: 1, request: 'setup' },
    timeoutMs: 800,
  });
  const elapsed = Date.now() - started;
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, BOT_ERROR_CODES.TIMEOUT);
  assert.ok(elapsed < 15000, `timeout xử lý quá chậm: ${elapsed}ms`);
});

test('M2: bot ghi quá nhiều ra stdout bị chặn bằng output_limit', { skip }, async () => {
  const result = await runBotRequest({
    filePath: fixture('bot_flood.py'),
    allowedRoot: FIXTURES_DIR,
    payload: { protocol_version: 1, request: 'setup' },
    timeoutMs: 3000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, BOT_ERROR_CODES.OUTPUT_LIMIT);
});

test('M2: bot trả nước ngoài legal_moves bị judge từ chối', { skip }, async () => {
  const state = await runSetupBothSides(fixture('bot_illegal_move.py'), FIXTURES_DIR);
  const moveLive = await runBotRequest({
    filePath: fixture('bot_illegal_move.py'),
    allowedRoot: FIXTURES_DIR,
    payload: buildMoveRequest(state, PLAYERS.RED, 3, 1),
    timeoutMs: 2000,
  });
  assert.equal(moveLive.ok, true, moveLive.message);
  assert.throws(() => applyValidatedMove(state, PLAYERS.RED, moveLive.response));

  const legal = listAllLegalMoves(state, PLAYERS.RED);
  assert.ok(legal.length > 0);
});

test('M2: bot setup thiếu quân bị validatePlacements từ chối', { skip }, async () => {
  const result = await runBotRequest({
    filePath: fixture('bot_bad_setup.py'),
    allowedRoot: FIXTURES_DIR,
    payload: buildSetupRequest(createTournamentGame(), PLAYERS.RED, 3),
    timeoutMs: 3000,
  });
  assert.equal(result.ok, true, result.message);
  const check = validatePlacements(PLAYERS.RED, result.response.placements);
  assert.equal(check.ok, false);
  assert.equal(check.error, 'bad_placement_count');
});

test('M2: chặn path traversal, symlink và file không phải .py', async () => {
  assert.throws(() => resolveBotPath(SAMPLE_BOT, FIXTURES_DIR));
  assert.throws(() => resolveBotPath(path.join(FIXTURES_DIR, 'nothing.txt'), FIXTURES_DIR));
  assert.throws(() => resolveBotPath('', FIXTURES_DIR));

  const result = await runBotRequest({
    filePath: SAMPLE_BOT,
    allowedRoot: FIXTURES_DIR,
    payload: { protocol_version: 1 },
    timeoutMs: 500,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, BOT_ERROR_CODES.BAD_PATH);
});

test('M2: parseSingleLineJson từ chối stdout rỗng, mảng và JSON không hợp lệ', () => {
  assert.equal(parseSingleLineJson('').ok, false);
  assert.equal(parseSingleLineJson('   \n').ok, false);
  assert.equal(parseSingleLineJson('[1,2]').ok, false);
  assert.equal(parseSingleLineJson('{"a":').ok, false);
  assert.equal(parseSingleLineJson('{"a":1}\n').ok, true);
  assert.equal(parseSingleLineJson('{"a":1}\r\n').ok, true);
});
