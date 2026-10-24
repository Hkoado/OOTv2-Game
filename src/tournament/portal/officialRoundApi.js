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
export async function syncGithubCutoff(eventId) {
  if (!eventId) throw new Error('Cần mã giải.');
  return await apiRequest(`/events/${encodeURIComponent(eventId)}/github-cutoff-sync`, { method: 'POST' });
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

export default {
  fetchOfficialRound,
  openOfficialRound,
  syncGithubCutoff,
  fetchOfficialProgress,
  fetchOfficialStandings,
  publishNextOfficialGame,
  freezeOfficialRound,
  fetchOfficialBracket,
  openNextKnockoutSeries,
  fetchOfficialTickets,
  cancelOfficialJob,
  requeueOfficialJob,
};
