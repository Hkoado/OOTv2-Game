/**
 * publicationView.js — Pure helpers and formatters for official tournament broadcasting and viewer stream (B3).
 * Follows Huy's H3 publication contract (docs/14 & docs/assignments/Huy.md).
 * Pure functions only — testable via node --test without DOM dependencies.
 */

export const BROADCAST_PHASE_METADATA = Object.freeze({
  waiting: Object.freeze({
    label: 'Chờ giờ phát',
    tone: 'warning',
    isWaiting: true,
    isBroadcasting: false,
    isEnded: false,
  }),
  broadcasting: Object.freeze({
    label: 'Đang phát sóng',
    tone: 'live',
    isWaiting: false,
    isBroadcasting: true,
    isEnded: false,
  }),
  ended: Object.freeze({
    label: 'Đã phát xong',
    tone: 'success',
    isWaiting: false,
    isBroadcasting: false,
    isEnded: true,
  }),
  hidden: Object.freeze({
    label: 'Chưa công bố',
    tone: 'neutral',
    isWaiting: false,
    isBroadcasting: false,
    isEnded: false,
  }),
});

/**
 * Formats seconds into HH:MM:SS or MM:SS.
 */
export function formatTimeRemaining(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Calculates countdown from now/server_time to starts_at.
 */
export function calculateCountdown(startsAt, currentTime = Date.now()) {
  if (!startsAt) return { remainingSeconds: 0, formatted: '00:00', hasStarted: true };
  const targetMs = Date.parse(startsAt);
  const currentMs = typeof currentTime === 'string' ? Date.parse(currentTime) : Number(currentTime);
  if (!Number.isFinite(targetMs) || !Number.isFinite(currentMs)) {
    return { remainingSeconds: 0, formatted: '00:00', hasStarted: true };
  }
  const diffSec = Math.max(0, Math.floor((targetMs - currentMs) / 1000));
  return {
    remainingSeconds: diffSec,
    formatted: formatTimeRemaining(diffSec),
    hasStarted: currentMs >= targetMs,
  };
}

/**
 * Resolves metadata and display badge for a broadcast phase.
 */
export function broadcastPhaseMeta(phase, revealResult = false) {
  const meta = BROADCAST_PHASE_METADATA[phase] || BROADCAST_PHASE_METADATA.hidden;
  if (phase === 'ended' && !revealResult) {
    return {
      ...meta,
      label: 'Đã phát xong (kết quả bảo mật)',
      tone: 'neutral',
    };
  }
  return { ...meta };
}

/**
 * Computes stream progress percentage.
 */
export function computeViewerProgress(visiblePlies, totalPlies) {
  const visible = Number(visiblePlies);
  const total = Number(totalPlies);
  if (!Number.isFinite(visible) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((visible / total) * 100)));
}

/**
 * Humanises release mode.
 */
export function formatReleaseMode(mode) {
  if (mode === 'full') return 'Mở toàn bộ sau khi phát xong (kết quả & replay)';
  if (mode === 'window') return 'Chỉ mở nước theo mốc thời gian (bảo mật kết quả)';
  return mode || 'Chưa xác định';
}

/**
 * Formats official campus group standings for table display.
 * Distinguishes series points (3/1/0) from game points (1/0.5/0).
 */
export function formatOfficialStandingsRow(row, rank = 1) {
  if (!row) return null;
  return {
    rank,
    participantId: row.participantId || row.participant_id,
    name: row.name || row.participantName || row.participantId,
    // Series stats
    seriesPlayed: row.seriesPlayed ?? row.played ?? 0,
    seriesWon: row.seriesWon ?? row.wins ?? 0,
    seriesDrawn: row.seriesDrawn ?? row.draws ?? 0,
    seriesLost: row.seriesLost ?? row.losses ?? 0,
    seriesPoints: row.seriesPoints ?? row.points ?? 0,
    // Game stats
    gamesPlayed: row.gamesPlayed ?? 0,
    gamesWon: row.gamesWon ?? 0,
    gamesDrawn: row.gamesDrawn ?? 0,
    gamesLost: row.gamesLost ?? 0,
    gamePoints: row.gamePoints ?? 0,
    // Mini-table stats
    miniSeriesPoints: row.miniSeriesPoints ?? 0,
    miniGamePoints: row.miniGamePoints ?? 0,
  };
}

export default {
  BROADCAST_PHASE_METADATA,
  formatTimeRemaining,
  calculateCountdown,
  broadcastPhaseMeta,
  computeViewerProgress,
  formatReleaseMode,
  formatOfficialStandingsRow,
};
