import React from 'react';
import { Download, FileCode2, ShieldCheck, Swords } from 'lucide-react';
import { Alert, Badge, Panel } from './TournamentUi.jsx';
import { campusBotDownload } from './campusBotDownload.js';

const RULES = [
  ['Bàn cờ', '9×9, hai nhà chính ở a1 (Đỏ) và i9 (Xanh). Quân di chuyển 8 hướng như vua cờ vua.'],
  ['Quân', 'Mỗi bên 9 quân: 3 rock, 3 paper, 3 scissors.'],
  ['Xếp quân bot', 'Phải viết sẵn cả setup() và move() trong file Python. Bot tự trả đủ 9 vị trí hợp lệ theo màu/map; không có bước người chơi xếp tay thay bot. Hai bot xếp kín, không nhận đội hình đối phương khi setup.'],
  ['Xếp quân offline', 'Hai người cùng máy vẫn được xếp tay, đổi chỗ, nhấc quân hoặc Xếp nhanh. Bàn ẩn đội hình đối phương đến khi cả hai xác nhận. Đây là luyện tập, không phải kết quả giải bot.'],
  ['Địa hình v2', 'Lửa cản Bao; Nước cản Kéo; Bụi cây cản Búa; Vực cản tất cả. Không đặt quân hoặc đi vào địa hình cản loại quân đó. BTC công bố map trước khi đội viết bot.'],
  ['Màu đội v2', 'Chính sách: ưu tiên so le Đỏ/Xanh trong cùng vòng; khi xung đột ưu tiên Đỏ cho đội thua nhiều hơn, rồi thắng ít hơn, rồi seed lưu. Luồng lưu/công bố màu trước ván chưa nối runtime chính thức.'],
  ['Lượt đi', 'Đỏ đi trước. Một nước = chọn quân rồi chọn ô đích hợp lệ.'],
  ['Bắt quân', 'Rock thắng scissors, scissors thắng paper, paper thắng rock. Gặp quân hòa hoặc thua thì không được đi.'],
  ['Thắng', 'Chiếm nhà chính đối phương hoặc diệt sạch một loại quân của đối phương. Campus giới hạn 400 plies; offline hòa khi lặp thế 3 lần hoặc đủ 400 plies. Replay MVP lịch sử giữ giới hạn 200 plies.'],
];

export default function GuidePage({ account }) {
  const isAdmin = account.role === 'admin';

  return (
    <>
      <header className="tt-page-head">
        <div>
          <p className="tt-eyebrow">{isAdmin ? 'Ban tổ chức · vận hành' : 'Đội thi · chuẩn bị'}</p>
          <h1 className="tt-page-title">{isAdmin ? 'Luật & vận hành giải' : 'Luật chơi & hướng dẫn'}</h1>
          <p className="tt-page-lead">
            Luật Campus v2, cách luyện offline và chuẩn bị bot tự xếp quân.
            Tài liệu đầy đủ nằm trong thư mục <code>docs/</code> của repository.
          </p>
        </div>
        <a className="tt-btn tt-btn--info" href={campusBotDownload} download="bot.py">
          <Download size={16} aria-hidden="true" />
          Tải bot mẫu (.py)
        </a>
      </header>

      <div className="tt-grid tt-grid--2">
        <Panel title="Luật OOTv2" subtitle="Server là trọng tài cuối cùng; bot không tự tuyên bố thắng.">
          <dl className="tt-deflist tt-deflist--rules">
            {RULES.map(([term, detail]) => (
              <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>
            ))}
          </dl>
        </Panel>

        <div className="tt-stack">
          <Panel title="Thể thức Campus">
            <ol className="tt-steps">
              <li><strong>Giải tuần → tháng → kỳ</strong><span>Tối đa 56 đội; chia bảng xác định theo roster và seed lưu.</span></li>
              <li><strong>Vòng bảng</strong><span>Mỗi cặp 2 ván; màu theo chính sách so le/ưu tiên số thua trong cùng vòng.</span></li>
              <li><strong>Knockout</strong><span>Thông thường 4 ván/cặp, chung kết 6 ván, có tranh hạng ba; không kết thúc sớm.</span></li>
              <li><strong>Hòa knockout</strong><span>Thêm đúng 2 ván phụ, sau đó mới xét ưu tiên hạt giống.</span></li>
            </ol>
            <div className="tt-inline-facts">
              <Badge tone="success">Ván thắng 1 điểm</Badge>
              <Badge tone="neutral">Ván hòa 0,5 điểm</Badge>
              <Badge tone="danger">Ván thua 0 điểm</Badge>
            </div>
            <p className="tt-muted">
              Điểm cặp vòng bảng: thắng 3 / hòa 1 / thua 0. Map chính/dự phòng được công bố và khóa trước giải.
            </p>
          </Panel>

          <Panel title="Vòng đời một ván" subtitle="Từ bài nộp đến replay.">
            <ul className="tt-timeline">
              <li><span>1</span><div><strong>Viết bot</strong><em>Một file bot.py gồm logic xếp đủ 9 quân và chọn nước đi; thử trên 5 map mẫu.</em></div></li>
              <li><span>2</span><div><strong>Khóa bài</strong><em>Bắt đầu giải: đội tham gia không thể nộp bản mới.</em></div></li>
              <li><span>3</span><div><strong>Setup kín</strong><em>Bot nhận màu/map, tự xếp quân; thiếu/sai đội hình là lỗi bot, không tự điền hộ.</em></div></li>
              <li><span>4</span><div><strong>Xem lại</strong><em>Replay dựng lại từ seed, trạng thái ban đầu và danh sách nước đi.</em></div></li>
            </ul>
          </Panel>
        </div>
      </div>

      <div className="tt-grid tt-grid--2">
        <Panel title="Bot Campus đúng chuẩn" subtitle="bot.v1 persistent; mẫu tải xuống có cả setup() và move().">
          <ul className="tt-bullets">
            <li>Đúng một file <code>.py</code>, tối đa 256 KiB, Python 3.12+.</li>
            <li>Chỉ thư viện chuẩn; không <code>pip install</code>, không đọc file ngoài.</li>
            <li>Nhận JSON qua stdin, trả JSON qua stdout; không in log lẫn vào kết quả.</li>
            <li>Một tiến trình cho cả ván; đọc/ghi JSONL với envelope <code>bot.v1</code>. Không dùng mẫu protocol_version: 1 của replay MVP cũ.</li>
            <li>Trong setup, dùng <code>availableSquaresByType</code> theo loại quân và màu <code>you</code>; trả đủ 9 ô khác nhau. Có thể tính đội hình theo map, không cần hardcode.</li>
            <li>Nộp lại không xóa lịch sử; bài hợp lệ mới nhất được dùng khi giải khóa.</li>
          </ul>
          <Alert tone="warning" title="Không phải sandbox">
            Bot chạy trên máy BTC bằng tiến trình con, không có cô lập cấp hệ điều hành. Chỉ nhận code từ
            thành viên tin cậy; không mở upload qua Internet.
          </Alert>
        </Panel>

        {!isAdmin && (
          <Panel title="An toàn & hỗ trợ" subtitle="Biết trước để tránh mất dữ liệu.">
            <ul className="tt-bullets">
              <li>Một tài khoản cho mỗi đội; không chia sẻ mật khẩu.</li>
              <li>Phiên đăng nhập 8 giờ, cookie HttpOnly; BTC thu hồi bằng cách đặt lại mật khẩu.</li>
              <li>Bài nộp bị khóa khi đội đang thi; gửi trước giờ bắt đầu.</li>
              <li>Kết quả và replay chỉ đọc; khiếu nại gửi BTC kèm mã ván.</li>
            </ul>
            <div className="tt-inline-facts">
              <span><ShieldCheck size={15} aria-hidden="true" />API bind loopback</span>
              <span><Swords size={15} aria-hidden="true" />Server xác thực nước đi</span>
              <span><FileCode2 size={15} aria-hidden="true" />Replay có seed</span>
            </div>
          </Panel>
        )}
      </div>

      <Panel title="Tài liệu tham chiếu" subtitle="Mở trực tiếp trong repository.">
        <ul className="tt-doc-links">
          <li><code>docs/01_MVP_SCOPE_ARCHITECTURE.md</code><span>Phạm vi, kiến trúc, giới hạn MVP.</span></li>
          <li><code>docs/02_BOT_WORKER_PROTOCOL.md</code><span>Giao thức bot, timeout, giới hạn output.</span></li>
          <li><code>docs/03_API_DATABASE_UI.md</code><span>Dữ liệu, API, quy ước UI.</span></li>
          <li><code>docs/04_IMPLEMENTATION_CHECKLIST.md</code><span>Checklist milestone và điều kiện done.</span></li>
          <li><code>docs/ui-style/README.md</code><span>Style kit, token màu và typography.</span></li>
        </ul>
      </Panel>
    </>
  );
}
