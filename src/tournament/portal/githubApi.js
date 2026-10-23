/**
 * githubApi.js — Client methods for official GitHub intake endpoints.
 * Interacts with /api/local routes implemented in H1 (server/shared/router.js).
 */

import { apiRequest } from './portalApi.js';

export async function fetchRepositoryConnection(eventId, teamId = null) {
  if (!eventId) return null;
  const query = teamId ? `?team=${encodeURIComponent(teamId)}` : '';
  const data = await apiRequest(`/events/${encodeURIComponent(eventId)}/repository${query}`);
  return data?.connection || null;
}

export async function saveRepositoryConnection(eventId, { repository, branch = 'main', team = null } = {}) {
  if (!eventId) throw new Error('Cần mã giải đấu (eventId).');
  const body = { repository, branch };
  if (team) body.team = team;
  const data = await apiRequest(`/events/${encodeURIComponent(eventId)}/repository`, {
    method: 'PUT',
    body,
  });
  return data?.connection || null;
}

export async function revokeRepositoryConnection(eventId, teamId) {
  if (!eventId) throw new Error('Cần mã giải đấu (eventId).');
  const query = teamId ? `?team=${encodeURIComponent(teamId)}` : '';
  const data = await apiRequest(`/events/${encodeURIComponent(eventId)}/repository${query}`, {
    method: 'DELETE',
  });
  return data?.connection || null;
}

export async function fetchEventRepositories(eventId) {
  if (!eventId) return [];
  const data = await apiRequest(`/events/${encodeURIComponent(eventId)}/repositories`);
  return Array.isArray(data?.connections) ? data.connections : [];
}

export async function requestGithubSubmission(eventId, { repository, branch, team = null } = {}) {
  if (!eventId) throw new Error('Cần mã giải đấu (eventId).');
  const body = {};
  if (repository) body.repository = repository;
  if (branch) body.branch = branch;
  if (team) body.team = team;
  return await apiRequest(`/events/${encodeURIComponent(eventId)}/submissions/from-github`, {
    method: 'POST',
    body,
  });
}

export async function fetchLatestGithubSubmission(eventId, teamId = null) {
  if (!eventId) return null;
  const query = teamId ? `?team=${encodeURIComponent(teamId)}` : '';
  return await apiRequest(`/events/${encodeURIComponent(eventId)}/submissions/from-github${query}`);
}

export async function fetchRepoSyncJob(jobId) {
  if (!jobId) return null;
  return await apiRequest(`/repo-sync-jobs/${encodeURIComponent(jobId)}`);
}

export default {
  fetchRepositoryConnection,
  saveRepositoryConnection,
  revokeRepositoryConnection,
  fetchEventRepositories,
  requestGithubSubmission,
  fetchLatestGithubSubmission,
  fetchRepoSyncJob,
};
