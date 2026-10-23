/**
 * publicationApi.js — Client methods for official broadcast and scheduled viewer endpoints (H3).
 * Interacts with /api/local broadcast routes.
 */

import { apiRequest } from '../portalApi.js';

/**
 * Loads the viewer package for a match, including phase, plies up to visible_plies,
 * and result (only when reveal_result = true).
 */
export async function fetchViewerPackage(matchId, afterSeq = 0, { signal } = {}) {
  if (!matchId) return null;
  const safeSeq = Number.isFinite(Number(afterSeq)) && Number(afterSeq) > 0 ? Math.floor(Number(afterSeq)) : 0;
  return await apiRequest(`/broadcasts/${encodeURIComponent(matchId)}?afterSeq=${safeSeq}`, {
    signal,
  });
}

/**
 * Lists broadcast schedules for an event.
 * Members only see published matches; Admin sees all.
 */
export async function fetchEventBroadcasts(eventId, { signal } = {}) {
  if (!eventId) return [];
  const data = await apiRequest(`/events/${encodeURIComponent(eventId)}/broadcasts`, {
    signal,
  });
  return Array.isArray(data?.broadcasts) ? data.broadcasts : [];
}

/**
 * Admin: Schedules a broadcast for a finished match.
 */
export async function scheduleBroadcast({ matchId, startsAt, plyIntervalMs = 2000, releaseMode = 'full' }) {
  if (!matchId) throw new Error('Cần mã ván đấu (matchId).');
  return await apiRequest('/admin/broadcasts', {
    method: 'POST',
    body: {
      match_id: matchId,
      starts_at: startsAt,
      ply_interval_ms: plyIntervalMs,
      release_mode: releaseMode,
    },
  });
}

/**
 * Admin: Cancels a scheduled broadcast before it starts.
 */
export async function cancelBroadcast(matchId) {
  if (!matchId) throw new Error('Cần mã ván đấu (matchId).');
  return await apiRequest(`/admin/broadcasts/${encodeURIComponent(matchId)}/cancel`, {
    method: 'POST',
  });
}

export default {
  fetchViewerPackage,
  fetchEventBroadcasts,
  scheduleBroadcast,
  cancelBroadcast,
};
