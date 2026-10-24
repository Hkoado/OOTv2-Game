/** Official setup contract. Planning only: never enqueue matches on the MVP runner. */
import { EMPTY_TERRAIN_MAP, normalizeMap } from './maps.js';
import { TERRAIN_RULES_VERSION } from './terrain.js';

export const OFFICIAL_PROFILE = 'campus-setup.v1';
export const MAX_OFFICIAL_TEAMS = 56;
export const LEVEL_LABELS = Object.freeze({ weekly: 'Tuần', monthly: 'Tháng', semester: 'Kỳ' });

export function normalizeCompetition(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Thiết lập giải không hợp lệ.');
  const level = input.level ?? 'weekly';
  if (!Object.hasOwn(LEVEL_LABELS, level)) throw new Error('Cấp giải phải là tuần, tháng hoặc kỳ.');
  const mapPackVersion = input.mapPackVersion ?? '';
  if (typeof mapPackVersion !== 'string' || mapPackVersion.length > 80) throw new Error('Phiên bản map pack tối đa 80 ký tự.');
  let cutoff = null;
  if (input.cutoff !== undefined && input.cutoff !== null && input.cutoff !== '') {
    if (typeof input.cutoff !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(input.cutoff)
      || !Number.isFinite(Date.parse(input.cutoff))) throw new Error('Cutoff cần ngày giờ ISO có múi giờ.');
    cutoff = new Date(input.cutoff).toISOString();
  }
  const weeksPerMonth = input.weeksPerMonth ?? 4, monthsPerSemester = input.monthsPerSemester ?? 4;
  if (!Number.isInteger(weeksPerMonth) || weeksPerMonth < 1 || weeksPerMonth > 6) throw new Error('Số tuần mỗi tháng phải từ 1 đến 6.');
  if (![3, 4].includes(monthsPerSemester)) throw new Error('Kỳ thi đấu có 3 hoặc 4 tháng; thể thức khác cần BTC sửa điều lệ.');
  return {
    schemaVersion: OFFICIAL_PROFILE, level, cutoff, mapPackVersion: mapPackVersion.trim(),
    weeksPerMonth, monthsPerSemester,
    mapsPublished: input.mapsPublished === true,
    primaryMap: normalizeMap(input.primaryMap ?? EMPTY_TERRAIN_MAP),
    reserveMap: normalizeMap(input.reserveMap ?? EMPTY_TERRAIN_MAP),
  };
}

/** Fisher-Yates on canonical roster, reproducible even if UI selection order changes. */
export function drawCompetition(ids, seed, level = 'weekly') {
  if (!Array.isArray(ids) || ids.length > MAX_OFFICIAL_TEAMS || new Set(ids).size !== ids.length
    || ids.some((id) => typeof id !== 'string' || !id)) throw new Error('Danh sách tối đa 56 đội không trùng.');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed phải là uint32.');
  if (!Object.hasOwn(LEVEL_LABELS, level)) throw new Error('Cấp giải không hợp lệ.');
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = [...ids].sort();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const count = ids.length;
  if (level !== 'weekly') {
    return { eligible: [6, 8].includes(count), reason: [6, 8].includes(count) ? null : 'Chung kết tháng/kỳ cần 8 đội có vé; 6 đội dùng bracket 8 với 2 bye.',
      groupCount: 0, groups: [], qualifierPairs: 0, qualifierGames: 0,
      finalists: [6, 8].includes(count) ? count : 0, bracketSize: 8,
      byes: count === 6 ? 2 : 0, drawOrder: order,
      // No seeds assigned here: ticket achievement ranking is a later scheduler gate.
      seeding: 'ticket-achievement-required' };
  }
  const groupCount = count >= 32 ? 8 : count >= 16 ? 4 : count >= 8 ? 2 : count >= 4 ? 1 : 0;
  const groups = Array.from({ length: groupCount }, (_, i) => ({ name: String.fromCharCode(65 + i), participantIds: [] }));
  order.forEach((id, i) => { if (groupCount) groups[i % groupCount].participantIds.push(id); });
  const qualifierPairs = groups.reduce((sum, group) => sum + group.participantIds.length * (group.participantIds.length - 1) / 2, 0);
  return { eligible: count >= 4, reason: count >= 4 ? null : 'Dưới 4 đội: giao lưu, BTC phải công bố lại giải thưởng.',
    groupCount, groups, qualifierPairs, qualifierGames: qualifierPairs * 2,
    finalists: groupCount === 1 ? 4 : groupCount * 2, bracketSize: groupCount === 1 ? 4 : groupCount * 2,
    byes: 0, drawOrder: order, seeding: 'group-winners-before-runners-up' };
}

export function competitionPreview(ids, seed, config) {
  const normalized = normalizeCompetition(config);
  const plan = drawCompetition(ids, seed, normalized.level);
  const blockers = [];
  if (!plan.eligible) blockers.push(plan.reason);
  if (normalized.level !== 'weekly' && ids.length === 6 && !(normalized.level === 'semester' && normalized.monthsPerSemester === 3)) {
    blockers.push('Ngoại lệ 6 đội / 2 bye chỉ áp dụng giải kỳ có 3 tháng.');
  }
  if (!normalized.cutoff) blockers.push('Chưa đặt cutoff.');
  if (!normalized.mapPackVersion) blockers.push('Chưa ghi phiên bản map pack để công bố.');
  if (normalized.primaryMap.rulesVersion !== normalized.reserveMap.rulesVersion) blockers.push('Map chính/dự phòng phải cùng phiên bản luật.');
  if ([normalized.primaryMap, normalized.reserveMap].some((map) => map.rulesVersion !== TERRAIN_RULES_VERSION)) blockers.push('Giải mới chỉ dùng map.v2; map.v1 chỉ để đọc lịch sử.');
  return { ...plan, blockers, setupReady: blockers.length === 0, executionReady: false,
    executionBlocker: 'Chưa nối scheduler chính thức, snapshot GitHub và runner; không chạy bằng lịch MVP.',
    scoring: { gameWin: 1, gameDraw: 0.5, seriesWin: 3, seriesDraw: 1 },
    knockout: { mainGamesPerSeries: 4, finalGames: 6, extraGamesIfTied: 2, thirdPlace: true, earlyStop: false },
    rulesVersion: normalized.primaryMap.rulesVersion,
    setupVisibility: normalized.primaryMap.rulesVersion === TERRAIN_RULES_VERSION ? 'sealed' : 'legacy',
    maxPlies: 400, sourceKind: 'github', filePath: 'bot.py' };
}