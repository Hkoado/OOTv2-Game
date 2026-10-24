/** bot.v1 wire contract. No execution, network, database or legacy protocol changes. */
import { campusObservation } from '../judge/campusEngine.js';

export const BOT_PROTOCOL_VERSION = 'bot.v1';
export const BOT_WIRE_LIMITS = Object.freeze({ requestBytes: 65536, responseBytes: 16384,
  stdoutBytes: 4 * 1024 * 1024, stderrBytes: 256 * 1024, depth: 16 });
export class BotProtocolError extends Error {
  constructor(code, message) { super(message); this.name = 'BotProtocolError'; this.code = code; }
}
const invalid = (message) => { throw new BotProtocolError('INVALID_JSON', message); };

/** JSON.parse loses duplicate keys. Scan keys and structure before parsing any value. */
export function parseBotJson(buffer) {
  if (!(typeof buffer === 'string' || Buffer.isBuffer(buffer))) invalid('Expected UTF-8 JSON');
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer, 'utf8');
  if (bytes.length > BOT_WIRE_LIMITS.responseBytes) throw new BotProtocolError('OUTPUT_LIMIT', 'Response exceeds line limit');
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { invalid('Invalid UTF-8'); }
  let index = 0;
  const whitespace = () => { while (/[\x20\t\r\n]/.test(source[index] ?? '\0')) index++; };
  function string() {
    if (source[index++] !== '"') invalid('Expected string');
    const start = index - 1;
    while (index < source.length) {
      const char = source[index++];
      if (char === '"') {
        try { return JSON.parse(source.slice(start, index)); } catch { invalid('Invalid JSON string'); }
      }
      if (char === '\\') index++;
    }
    invalid('Unterminated string');
  }
  function value(depth) {
    if (depth > BOT_WIRE_LIMITS.depth) invalid('JSON nesting limit exceeded');
    whitespace();
    const char = source[index];
    if (char === '"') { string(); return; }
    if (char === '{' || char === '[') {
      const object = char === '{', end = object ? '}' : ']';
      const keys = new Set(); index++; whitespace();
      if (source[index] === end) { index++; return; }
      while (index < source.length) {
        if (object) {
          whitespace(); const key = string();
          if (keys.has(key)) invalid('Duplicate JSON key'); keys.add(key);
          whitespace(); if (source[index++] !== ':') invalid('Expected colon');
        }
        value(depth + 1); whitespace();
        const next = source[index++];
        if (next === end) return;
        if (next !== ',') invalid('Expected delimiter');
      }
      invalid('Unterminated container');
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(index));
    if (!token) invalid('Invalid JSON token');
    index += token[0].length;
  }
  value(0); whitespace();
  if (index !== source.length) invalid('Trailing JSON output');
  let parsed;
  try { parsed = JSON.parse(source); } catch { invalid('Malformed JSON'); }
  function finite(value) {
    if (typeof value === 'number' && !Number.isFinite(value)) invalid('Non-finite JSON number');
    if (value && typeof value === 'object') Object.values(value).forEach(finite);
  }
  finite(parsed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) invalid('Expected response object');
  return parsed;
}
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...fields].sort().join(',');
const pieceId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
const square = (value) => typeof value === 'string' && /^[a-i][1-9]$/.test(value);

export function validateBotResponse(request, response) {
  const fail = () => { throw new BotProtocolError('PROTOCOL_ERROR', 'Invalid bot.v1 response envelope'); };
  if (!response || response.protocolVersion !== BOT_PROTOCOL_VERSION || response.requestId !== request.requestId
    || response.kind !== request.kind) fail();
  if (request.kind === 'setup') {
    if (!exact(response, ['protocolVersion', 'requestId', 'kind', 'placements'])
      || !Array.isArray(response.placements) || response.placements.length !== 9
      || !response.placements.every((p) => exact(p, ['pieceId', 'square']) && pieceId(p.pieceId) && square(p.square))) fail();
    return { placements: structuredClone(response.placements) };
  }
  if (request.kind !== 'move' || !exact(response, ['protocolVersion', 'requestId', 'kind', 'pieceId', 'to'])
    || !pieceId(response.pieceId) || !square(response.to)) fail();
  return { pieceId: response.pieceId, to: response.to };
}

export function buildCampusBotRequest(state, player, sequence, { responseWallMs, cpuRemainingMs = 30000 }) {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || !Number.isSafeInteger(responseWallMs) || responseWallMs < 1
    || !Number.isSafeInteger(cpuRemainingMs) || cpuRemainingMs < 0) throw new Error('Invalid request budget/sequence');
  const game = campusObservation(state, player);
  const expected = state.phase === 'setup_red' ? 'red' : state.phase === 'setup_blue' ? 'blue'
    : state.phase === 'playing' ? state.turn : null;
  if (expected !== player) throw new Error('Request outside active player/phase');
  const kind = state.phase === 'playing' ? 'move' : 'setup';
  const request = { protocolVersion: BOT_PROTOCOL_VERSION, requestId: `${game.id}:${sequence}`, kind,
    game, limits: { responseWallMs, cpuRemainingMs } };
  if (request.requestId.length > 160 || Buffer.byteLength(JSON.stringify(request) + '\n') > BOT_WIRE_LIMITS.requestBytes) {
    throw new Error('Request exceeds bot.v1 input budget');
  }
  return request;
}