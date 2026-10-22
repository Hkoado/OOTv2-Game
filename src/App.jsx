import React from 'react';
import CampusPortal from './tournament/portal/CampusPortal.jsx';

/**
 * Điểm vào duy nhất của OOTv2: cổng giải đấu.
 *
 * Chế độ phòng chơi / spectator / MVP cũ vẫn còn mã nguồn trong `LegacyApp.jsx`
 * nhưng KHÔNG được mount. Muốn xem lại giao diện cũ thì import `LegacyApp` ở đây
 * trong lúc phát triển; không mở lại bằng query string để tránh hai UI cùng tồn tại.
 */
export default function App() {
  return <CampusPortal />;
}
