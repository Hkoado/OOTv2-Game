/**
 * officialSetupView.js — Pure helpers and formatters for official tournament setup.
 * Used by OfficialSetupPanel and testable via node --test without DOM dependencies.
 */

/**
 * Converts an ISO 8601 string to a datetime-local input value (YYYY-MM-DDTHH:mm).
 * Preserves the user's local timezone.
 */
export function toLocalDatetimeInput(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

/**
 * Parses a local datetime string (from input type="datetime-local") and returns
 * structured timezone information including local display and UTC ISO representation.
 */
export function parseCutoffDetails(localValue, now = Date.now()) {
  if (!localValue || typeof localValue !== 'string' || !localValue.trim()) {
    return {
      utcIso: null,
      localDisplay: '',
      timeZone: '',
      isPast: false,
      isValid: true,
      hint: 'Chưa đặt cutoff (hệ thống sẽ yêu cầu cutoff trước khi chốt giải).',
    };
  }

  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) {
    return {
      utcIso: null,
      localDisplay: '',
      timeZone: '',
      isPast: false,
      isValid: false,
      hint: 'Định dạng ngày giờ không hợp lệ.',
    };
  }

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local';
  let localDisplay = '';
  try {
    localDisplay = new Intl.DateTimeFormat('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  } catch {
    localDisplay = date.toLocaleString();
  }

  const utcIso = date.toISOString();
  const isPast = date.getTime() <= now;

  return {
    utcIso,
    localDisplay,
    timeZone,
    isPast,
    isValid: true,
    hint: isPast
      ? 'Thời điểm cutoff này đã trôi qua so với thời gian hiện tại.'
      : 'Server lưu chuẩn UTC; cutoff sẽ so sánh với đồng hồ server.',
  };
}

/**
 * Detects whether there is a version conflict between a client draft and the incoming server version.
 */
export function detectVersionConflict(baseVersion, serverVersion, isDirty) {
  const base = Number(baseVersion);
  const server = Number(serverVersion);
  if (!Number.isFinite(base) || !Number.isFinite(server)) {
    return { hasConflict: false, message: '' };
  }
  if (isDirty && server > base) {
    return {
      hasConflict: true,
      message: `Máy chủ hiện ở phiên bản v${server}, trong khi bản nháp của bạn dựa trên v${base}. Lưu bây giờ có thể bị từ chối do xung đột. Hãy kiểm tra hoặc nạp lại bản máy chủ.`,
    };
  }
  return { hasConflict: false, message: '' };
}

/**
 * Summarises dynamic group distribution and balance across groups A–H.
 */
export function formatGroupSummary(groups = []) {
  if (!Array.isArray(groups) || groups.length === 0) {
    return {
      label: 'Chưa có bảng đấu',
      count: 0,
      balanced: true,
      details: 'Chưa đủ đội để tạo bảng đấu vòng loại.',
    };
  }

  const sizes = groups.map((g) => (Array.isArray(g.participantIds) ? g.participantIds.length : 0));
  const min = Math.min(...sizes);
  const max = Math.max(...sizes);
  const balanced = max - min <= 1;
  const firstName = groups[0]?.name || 'A';
  const lastName = groups[groups.length - 1]?.name || firstName;

  return {
    label: groups.length === 1 ? `Bảng ${firstName}` : `Bảng ${firstName} – Bảng ${lastName} (${groups.length} bảng)`,
    count: groups.length,
    balanced,
    minTeams: min,
    maxTeams: max,
    details: balanced
      ? `Cân bằng bảng đạt chuẩn: độ lệch tối đa ${max - min} đội (${min}–${max} đội/bảng).`
      : `Bảng chưa cân bằng (độ lệch ${max - min} đội).`,
  };
}

export default {
  toLocalDatetimeInput,
  parseCutoffDetails,
  detectVersionConflict,
  formatGroupSummary,
};
