/**
 * tournamentView.js — Hàm thuần phục vụ UI giải đấu: điều hướng, nhãn, tiến độ,
 * trạng thái bài nộp và thể thức. Không gọi API, không đọc DOM → test bằng `node --test`.
 */
import {
  MATCH_STATUS_LABELS,
  RESULT_LABELS,
  STAGE_LABELS,
  SUBMISSION_STATUS_LABELS,
  TOURNAMENT_STATUS_LABELS,
} from '../labels.js';

export const RUNNING_STATUSES = Object.freeze(['group_running', 'semifinal_running', 'final_running']);

/** Thể thức MVP đang chạy trên server: 8 đội, 2 bảng, 30 ván. */
export const FORMAT = Object.freeze({
  teams: 8,
  groups: 2,
  teamsPerGroup: 4,
  groupGames: 24,
  semifinalGames: 4,
  finalGames: 2,
  totalGames: 30,
});

export const POINTS = Object.freeze({ win: 3, draw: 1, loss: 0 });

export const GROUP_SEEDS = Object.freeze({
  A: Object.freeze([1, 4, 5, 8]),
  B: Object.freeze([2, 3, 6, 7]),
});

const TEAM_NAV = Object.freeze([
  { id: 'overview', title: 'Tổng quan', icon: 'dashboard' },
  { id: 'team', title: 'Đội của tôi', icon: 'team' },
  { id: 'bot', title: 'Bot & bài nộp', icon: 'bot' },
  { id: 'events', title: 'Giải đấu', icon: 'events' },
  { id: 'guide', title: 'Luật & hướng dẫn', icon: 'guide' },
]);

const ADMIN_NAV = Object.freeze([
  { id: 'overview', title: 'Tổng quan', icon: 'dashboard' },
  { id: 'teams', title: 'Đội & tài khoản', icon: 'team' },
  { id: 'bot', title: 'Bài nộp', icon: 'bot' },
  { id: 'events', title: 'Quản lý giải', icon: 'events' },
  { id: 'guide', title: 'Luật & vận hành', icon: 'guide' },
]);

export const NAVIGATION = Object.freeze({ team: TEAM_NAV, admin: ADMIN_NAV });

const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function tournamentNavigation(role) {
  return Object.hasOwn(NAVIGATION, role) ? NAVIGATION[role] : [];
}

export function pagesForRole(role) {
  return tournamentNavigation(role).map((item) => item.id);
}

export function navTitle(role, page) {
  return tournamentNavigation(role).find((item) => item.id === page)?.title || 'Tổng quan';
}

/** Đọc hash `#/page/eventId` thành route hợp lệ với vai trò hiện tại. */
export function parseHashRoute(hash, role) {
  const fallback = { page: 'overview', eventId: null };
  const pages = pagesForRole(role);
  if (!pages.length) return fallback;
  const raw = typeof hash === 'string' ? hash.replace(/^#\/?/, '').split('?')[0] : '';
  const [page, eventId, ...rest] = raw.split('/');
  if (rest.length) return fallback;
  if (!pages.includes(page)) return fallback;
  if (page !== 'events') return { page, eventId: null };
  return { page, eventId: EVENT_ID_PATTERN.test(eventId || '') ? eventId : null };
}

export function routeHash(route) {
  if (!route?.page) return '#/overview';
  return route.eventId ? `#/${route.page}/${route.eventId}` : `#/${route.page}`;
}

export function eventStatusLabel(status) {
  return TOURNAMENT_STATUS_LABELS[status] || 'Chưa rõ trạng thái';
}

export function eventTone(status) {
  if (status === 'finished') return 'success';
  if (isEventRunning(status)) return 'live';
  return 'neutral';
}

export function isEventRunning(status) {
  return RUNNING_STATUSES.includes(status);
}

export function eventProgress(event) {
  const total = Number(event?.match_total);
  const finished = Number(event?.match_finished);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(finished)) return 0;
  return Math.max(0, Math.min(100, Math.round((finished / total) * 100)));
}

export function stageLabel(stage) {
  return STAGE_LABELS[stage] || 'Vòng đấu';
}

export function submissionState(status) {
  if (status === 'valid') return { label: SUBMISSION_STATUS_LABELS.valid, tone: 'success' };
  if (status === 'invalid') return { label: SUBMISSION_STATUS_LABELS.invalid, tone: 'danger' };
  if (status === 'uploaded') return { label: 'Đang kiểm tra', tone: 'warning' };
  return { label: status ? String(status) : 'Chưa rõ', tone: 'neutral' };
}

/** Tổng hợp bài nộp của một đội (danh sách server trả mới nhất trước). */
export function botState(submissions) {
  const list = Array.isArray(submissions) ? submissions : [];
  const validCount = list.filter((row) => row?.status === 'valid').length;
  return {
    latest: list[0] || null,
    total: list.length,
    validCount,
    failedCount: list.length - validCount,
    hasValid: validCount > 0,
  };
}

/** Trạng thái bot của một đội trong danh sách admin. */
export function teamBotState(team) {
  if (team?.latest_valid_submission_id) return { label: 'Bot hợp lệ', tone: 'success', hasValid: true };
  const latest = team?.latest_submission;
  if (!latest) return { label: 'Chưa nộp bot', tone: 'warning', hasValid: false };
  if (latest.status === 'invalid') return { label: 'Bài nộp lỗi', tone: 'danger', hasValid: false };
  if (latest.status === 'uploaded') return { label: 'Đang kiểm tra', tone: 'warning', hasValid: false };
  return { label: 'Chưa hợp lệ', tone: 'danger', hasValid: false };
}

export function eligibleTeams(teams) {
  return (Array.isArray(teams) ? teams : []).filter((team) => Boolean(team?.latest_valid_submission_id));
}

/** Đội bị khóa nộp bài khi đang trong một vòng chạy (server cũng kiểm tra lại). */
export function submissionFreeze(events) {
  return (Array.isArray(events) ? events : []).find((event) => isEventRunning(event?.status)) || null;
}

export function standingFor(standings, participantId) {
  if (!participantId) return null;
  for (const group of ['A', 'B']) {
    const row = (standings?.groups?.[group] || []).find((item) => item.participant_id === participantId);
    if (row) return { group, row };
  }
  return null;
}

export function matchOutcome(match) {
  if (match?.status !== 'finished') {
    return {
      label: MATCH_STATUS_LABELS[match?.status] || 'Chờ chạy',
      tone: match?.status === 'running' ? 'live' : 'neutral',
    };
  }
  if (match.result === 'draw') return { label: RESULT_LABELS.draw, tone: 'neutral' };
  return { label: RESULT_LABELS[match.result] || 'Đã xong', tone: 'success' };
}

export function stageSummary(matches) {
  const summary = {
    group: { total: 0, finished: 0 },
    semifinal: { total: 0, finished: 0 },
    final: { total: 0, finished: 0 },
  };
  for (const match of Array.isArray(matches) ? matches : []) {
    const bucket = summary[match?.stage];
    if (!bucket) continue;
    bucket.total += 1;
    if (match.status === 'finished') bucket.finished += 1;
  }
  return summary;
}

export function nextMatchForTeam(matches, participantId) {
  if (!participantId) return null;
  const involved = (match) =>
    match?.red?.participant_id === participantId || match?.blue?.participant_id === participantId;
  const list = Array.isArray(matches) ? matches : [];
  return (
    list.find((match) => match.status === 'running' && involved(match)) ||
    list.find((match) => match.status === 'pending' && involved(match)) ||
    null
  );
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

export function shortSha(value) {
  return String(value || '').slice(0, 12);
}

/** Chỉ nhận URL repository GitHub công khai, không token/query/hash. */
export function validateRepository(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'github.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return 'Chỉ nhận URL HTTPS của repository trên github.com, không kèm token hoặc query.';
    }
    if (
      !/^\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname) ||
      /\/(?:\.|\.\.)(?:\/|$)/.test(value)
    ) {
      return 'Nhập URL repository dạng https://github.com/owner/repository.';
    }
    return '';
  } catch {
    return 'URL GitHub không hợp lệ.';
  }
}

export default {
  tournamentNavigation,
  parseHashRoute,
  eventProgress,
  validateRepository,
};

