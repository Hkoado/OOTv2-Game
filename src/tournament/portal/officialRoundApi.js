import { apiRequest } from './portalApi.js';

/** Admin: persisted weekly group round. 404 means the round has not been opened. */
export async function fetchOfficialRound(eventId, { signal } = {}) {
  if (!eventId) return null;
  try {
    return await apiRequest(`/events/${encodeURIComponent(eventId)}/official-round`, { signal });
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

/** Admin: pin the cutoff snapshot and open the group round once (idempotent server-side). */
export async function openOfficialRound(eventId) {
  if (!eventId) throw new Error('Cần mã giải.');
  return await apiRequest(`/events/${encodeURIComponent(eventId)}/official-round`, { method: 'POST' });
}

/** Admin: enqueue one pinned pull per approved repo at/after cutoff. */
export async function syncGithubCutoff(eventId, { teamIds, limit } = {}) {
  if (!eventId) throw new Error('Cần mã giải.');
  const body = {};
  if (Array.isArray(teamIds) && teamIds.length > 0) body.team_ids = teamIds;
  if (Number.isInteger(limit) && limit > 0) body.limit = limit;
  return await apiRequest(`/events/${encodeURIComponent(eventId)}/github-cutoff-sync`, {
    method: 'POST',
    body: Object.keys(body).length > 0 ? body : undefined,
  });
}

/** Admin: fetch detailed progress of github cutoff batch. */
export async function fetchOfficialCutoffStatus(eventId, { signal } = {}) {
  if (!eventId) return null;
  try {
    return await apiRequest(`/events/${encodeURIComponent(eventId)}/github-cutoff-status`, { signal });
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

/** §7 Admin: fetch round progress & jobs overview. */
export async function fetchOfficialProgress(eventId, { signal } = {}) {
  if (!eventId) return null;
  try {
    return await apiRequest(`/events/${encodeURIComponent(eventId)}/official/progress`, { signal });
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

/** §7 Admin: fetch group standings (pure display, calculated strictly by server). */
export async function fetchOfficialStandings(eventId, { signal } = {}) {
  if (!eventId) return null;
  try {
    return await apiRequest(`/events/${encodeURIComponent(eventId)}/official/standings`, { signal });
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

/** §7 Admin: publish & enqueue the next pinned game in round schedule. */
export async function publishNextOfficialGame(eventId) {
  if (!eventId) throw new Error('Cần mã giải.');
  return await apiRequest(`/events/${encodeURIComponent(eventId)}/official/publish`, { method: 'POST' });
}

/** §7 Admin: freeze the round when all games have terminal results. */
export async function freezeOfficialRound(eventId, { expectedGames } = {}) {
  if (!eventId) throw new Error('Cần mã giải.');
  const body = expectedGames ? { expected_games: expectedGames } : undefined;
  return await apiRequest(`/events/${encodeURIComponent(eventId)}/official/freeze`, {
    method: 'POST',
    body,
  });
}

/** §7 Admin: fetch official knockout bracket progress & matchups. */
export async function fetchOfficialBracket(eventId, { signal } = {}) {
  if (!eventId) return null;
  try {
    return await apiRequest(`/events/${encodeURIComponent(eventId)}/official/bracket`, { signal });
  } catch (error) {
    if (error?.status === 404 || error?.status === 409) return null;
    throw error;
  }
}

/** §7 Admin: open or advance the next series in knockout bracket. */
export async function openNextKnockoutSeries(eventId) {
  if (!eventId) throw new Error('Cần mã giải.');
  return await apiRequest(`/events/${encodeURIComponent(eventId)}/official/bracket/open`, { method: 'POST' });
}

/** §7 Admin: fetch final qualification tickets allocation. */
export async function fetchOfficialTickets(eventId, { signal } = {}) {
  if (!eventId) return null;
  try {
    return await apiRequest(`/events/${encodeURIComponent(eventId)}/official/tickets`, { signal });
  } catch (error) {
    if (error?.status === 404 || error?.status === 409) return null;
    throw error;
  }
}

/** §7 Admin: cancel a queued/running job with mandatory reason (5..400 chars). */
export async function cancelOfficialJob(jobId, reason) {
  if (!jobId) throw new Error('Cần mã job.');
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  if (trimmed.length < 5 || trimmed.length > 400) {
    throw new Error('Lý do hủy job phải từ 5 đến 400 ký tự.');
  }
  return await apiRequest(`/official/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    body: { reason: trimmed },
  });
}

/** §7 Admin: requeue a failed job with mandatory reason (5..400 chars). */
export async function requeueOfficialJob(jobId, reason) {
  if (!jobId) throw new Error('Cần mã job.');
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  if (trimmed.length < 5 || trimmed.length > 400) {
    throw new Error('Lý do chấm lại job phải từ 5 đến 400 ký tự.');
  }
  return await apiRequest(`/official/jobs/${encodeURIComponent(jobId)}/requeue`, {
    method: 'POST',
    body: { reason: trimmed },
  });
}

/** §7 Admin/Team: fetch broadcast state of an official game. */
export async function fetchOfficialBroadcastState(roundPk, gameKey, { signal } = {}) {
  if (!roundPk || !gameKey) return null;
  return await apiRequest(
    `/official/rounds/${encodeURIComponent(roundPk)}/games/${encodeURIComponent(gameKey)}/broadcast`,
    { signal }
  );
}

/** §7 Admin: schedule or update broadcast of an official finished game. */
export async function scheduleOfficialBroadcast(roundPk, gameKey, { startsAt, plyIntervalMs = 2000, releaseMode = 'window', state = 'scheduled' }) {
  if (!roundPk || !gameKey) throw new Error('Cần mã vòng (roundPk) và mã ván (gameKey).');
  return await apiRequest(
    `/official/rounds/${encodeURIComponent(roundPk)}/games/${encodeURIComponent(gameKey)}/broadcast`,
    {
      method: 'PUT',
      body: {
        starts_at: startsAt,
        ply_interval_ms: Number(plyIntervalMs) || 2000,
        release_mode: releaseMode,
        state,
      },
    }
  );
}

/** §7 Viewer: fetch official game broadcast stream package (scoped by membership, timed plies). */
export async function fetchOfficialGameViewer(roundPk, gameKey, afterSeq = 0, { signal } = {}) {
  if (!roundPk || !gameKey) return null;
  const safeSeq = Number.isFinite(Number(afterSeq)) && Number(afterSeq) > 0 ? Math.floor(Number(afterSeq)) : 0;
  return await apiRequest(
    `/official/rounds/${encodeURIComponent(roundPk)}/games/${encodeURIComponent(gameKey)}/viewer?after_seq=${safeSeq}`,
    { signal }
  );
}

const extractErrorCode = (error, fallback) => {
  if (typeof error?.code === 'string') return error.code;
  if (typeof error?.code?.code === 'string') return error.code.code;
  return fallback;
};

/** §7 Đội thi / Thành viên giải: Xem Bảng xếp hạng đã công bố (yêu cầu round freeze). */
export async function fetchOfficialPublishedStandings(eventId, { signal } = {}) {
  if (!eventId) return null;
  try {
    return await apiRequest(`/events/${encodeURIComponent(eventId)}/official/published/standings`, { signal });
  } catch (error) {
    if (error?.status === 409) return { published: false, error: extractErrorCode(error, 'round_not_published') };
    if (error?.status === 404) return null;
    throw error;
  }
}

/** §7 Đội thi / Thành viên giải: Xem Nhánh Knockout đã công bố (yêu cầu round freeze). */
export async function fetchOfficialPublishedBracket(eventId, { signal } = {}) {
  if (!eventId) return null;
  try {
    return await apiRequest(`/events/${encodeURIComponent(eventId)}/official/published/bracket`, { signal });
  } catch (error) {
    if (error?.status === 409) return { published: false, error: extractErrorCode(error, 'round_not_published') };
    if (error?.status === 404) return null;
    throw error;
  }
}

/** §7 Đội thi / Thành viên giải: Xem Vé chung kết đã công bố (yêu cầu knockout complete). */
export async function fetchOfficialPublishedTickets(eventId, { signal } = {}) {
  if (!eventId) return null;
  try {
    return await apiRequest(`/events/${encodeURIComponent(eventId)}/official/published/tickets`, { signal });
  } catch (error) {
    if (error?.status === 409) return { published: false, error: extractErrorCode(error, 'tickets_not_published') };
    if (error?.status === 404) return null;
    throw error;
  }
}

/** §7 Đội thi / Thành viên giải: Danh sách ván official đã công bố hoặc đang phát sóng. */
export async function fetchOfficialPublishedGames(eventId, { signal } = {}) {
  if (!eventId) return null;
  try {
    return await apiRequest(`/events/${encodeURIComponent(eventId)}/official/published/games`, { signal });
  } catch (error) {
    if (error?.status === 404 || error?.status === 409) return null;
    throw error;
  }
}

export default {
  fetchOfficialRound,
  openOfficialRound,
  syncGithubCutoff,
  fetchOfficialCutoffStatus,
  fetchOfficialProgress,
  fetchOfficialStandings,
  publishNextOfficialGame,
  freezeOfficialRound,
  fetchOfficialBracket,
  openNextKnockoutSeries,
  fetchOfficialTickets,
  cancelOfficialJob,
  requeueOfficialJob,
  fetchOfficialBroadcastState,
  scheduleOfficialBroadcast,
  fetchOfficialGameViewer,
  fetchOfficialPublishedStandings,
  fetchOfficialPublishedBracket,
  fetchOfficialPublishedTickets,
  fetchOfficialPublishedGames,
};
