/**
 * manualFinalApi.js — Client gọi API Chung kết thủ công (/api/local/manual-finals/*).
 *
 * Tương tác trực tiếp với router `server/routes/manualFinal.js` do Huy implement.
 * Toàn bộ request tự động đính kèm cookie phiên đăng nhập và header `x-csrf-token`.
 */

import { apiRequest } from './portalApi.js';

export async function fetchManualEvents() {
  return apiRequest('/manual-finals');
}

export async function createManualEvent({ name, level, roundNo = 1, teamIds = [], map, seed }) {
  return apiRequest('/manual-finals', {
    method: 'POST',
    body: {
      name,
      level,
      round_no: roundNo,
      team_ids: teamIds,
      map,
      seed,
    },
  });
}

export async function fetchManualEventDetail(id) {
  return apiRequest(`/manual-finals/${encodeURIComponent(id)}`);
}

export async function updateManualEventStatus(id, status, reason = null) {
  return apiRequest(`/manual-finals/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    body: { status, reason },
  });
}

export async function closeManualEvent(id, reason = null) {
  return apiRequest(`/manual-finals/${encodeURIComponent(id)}/close`, {
    method: 'POST',
    body: { reason },
  });
}

export async function uploadManualSubmission(id, { teamId, file }) {
  const formData = new FormData();
  formData.append('team_id', teamId);
  formData.append('file', file);

  return apiRequest(`/manual-finals/${encodeURIComponent(id)}/submissions`, {
    method: 'POST',
    body: formData,
  });
}

export async function selectManualSubmission(id, submissionId) {
  return apiRequest(
    `/manual-finals/${encodeURIComponent(id)}/submissions/${encodeURIComponent(submissionId)}/select`,
    { method: 'POST' }
  );
}

export async function lockManualTeam(id, teamId) {
  return apiRequest(`/manual-finals/${encodeURIComponent(id)}/lock`, {
    method: 'POST',
    body: { team_id: teamId },
  });
}

export async function createManualMatch(id, { redTeamId, blueTeamId, seriesId, gameNo = 1, seed, note }) {
  return apiRequest(`/manual-finals/${encodeURIComponent(id)}/matches`, {
    method: 'POST',
    body: {
      red_team_id: redTeamId,
      blue_team_id: blueTeamId,
      series_id: seriesId,
      game_no: gameNo,
      seed,
      note,
    },
  });
}

export async function fetchManualMatchReplay(id, matchId) {
  return apiRequest(
    `/manual-finals/${encodeURIComponent(id)}/matches/${encodeURIComponent(matchId)}/replay`
  );
}

export async function cancelManualMatch(id, matchId, reason) {
  return apiRequest(
    `/manual-finals/${encodeURIComponent(id)}/matches/${encodeURIComponent(matchId)}/cancel`,
    {
      method: 'POST',
      body: { reason },
    }
  );
}

export async function rerunManualMatch(id, matchId, reason) {
  return apiRequest(
    `/manual-finals/${encodeURIComponent(id)}/matches/${encodeURIComponent(matchId)}/rerun`,
    {
      method: 'POST',
      body: { reason },
    }
  );
}

export default {
  fetchManualEvents,
  createManualEvent,
  fetchManualEventDetail,
  updateManualEventStatus,
  closeManualEvent,
  uploadManualSubmission,
  selectManualSubmission,
  lockManualTeam,
  createManualMatch,
  fetchManualMatchReplay,
  cancelManualMatch,
  rerunManualMatch,
};
