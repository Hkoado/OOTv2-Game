/**
 * labels.js — Nhãn tiếng Việt cho trạng thái/kết quả/lý do/vòng đấu của API tournament.
 * Chỉ dùng cho hiển thị; giá trị gốc từ server luôn được giữ nguyên trong dữ liệu.
 */

export const TOURNAMENT_STATUS_LABELS = {
  draft: 'Bản nháp (chưa start)',
  group_running: 'Đang đá vòng bảng',
  semifinal_running: 'Đang đá bán kết',
  final_running: 'Đang đá chung kết',
  finished: 'Đã kết thúc',
};

export const MATCH_STATUS_LABELS = {
  pending: 'Chờ chạy',
  running: 'Đang chạy',
  finished: 'Đã xong',
};

export const RESULT_LABELS = {
  red_win: 'Đỏ thắng',
  blue_win: 'Xanh thắng',
  draw: 'Hòa',
};

export const REASON_LABELS = {
  base_capture: 'Chiếm nhà chính',
  type_eliminated: 'Diệt sạch một loại quân',
  move_limit: 'Chạm giới hạn 200 nước',
  forfeit_setup: 'Bot xếp quân lỗi (xử thua)',
  forfeit_move: 'Bot đi nước không hợp lệ (xử thua)',
  no_legal_move: 'Hết nước đi hợp lệ',
  internal_error: 'Lỗi nội bộ của giải',
};

export const STAGE_LABELS = {
  group: 'Vòng bảng',
  semifinal: 'Bán kết',
  final: 'Chung kết',
};

export const SUBMISSION_STATUS_LABELS = {
  valid: 'Hợp lệ',
  invalid: 'Không hợp lệ',
  error: 'Lỗi kiểm tra',
};

export function labelOf(map, key, fallback = '—') {
  if (!key) return fallback;
  return map[key] || key;
}

export default {
  TOURNAMENT_STATUS_LABELS,
  MATCH_STATUS_LABELS,
  RESULT_LABELS,
  REASON_LABELS,
  STAGE_LABELS,
  SUBMISSION_STATUS_LABELS,
  labelOf,
};
