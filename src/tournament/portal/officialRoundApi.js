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

export default { fetchOfficialRound, openOfficialRound, syncGithubCutoff };
