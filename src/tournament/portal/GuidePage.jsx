import React from 'react';
import { Download, FileCode2, ShieldCheck, Swords } from 'lucide-react';
import { Alert, Badge, Panel } from './TournamentUi.jsx';
import { FORMAT, GROUP_SEEDS, POINTS } from './tournamentView.js';

const RULES = [
  ['Bàn cờ', '9×9, hai nhà chính ở a1 (Đỏ) và i9 (Xanh). Quân di chuyển 8 hướng như vua cờ vua.'],
  ['Quân', 'Mỗi bên 9 quân: 3 rock, 3 paper, 3 scissors.'],
  ['Xếp quân', 'Đỏ xếp trước vào vùng nhà; Xanh xếp sau và được biết toàn bộ vị trí Đỏ đã đặt.'],
  ['Lượt đi', 'Đỏ đi trước. Một nước = chọn quân rồi chọn ô đích hợp lệ.'],
  ['Bắt quân', 'Rock thắng scissors, scissors thắng paper, paper thắng rock. Gặp quân hòa hoặc thua thì không được đi.'],
  ['Thắng', 'Chiếm nhà chính đối phương hoặc diệt sạch một loại quân của đối phương. Chạm 200 nước thì xử theo luật giải.'],
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
            Tóm tắt luật OOTv2, thể thức {FORMAT.teams} đội / {FORMAT.totalGames} ván và các bước nộp bot.
            Tài liệu đầy đủ nằm trong thư mục <code>docs/</code> của repository.
          </p>
        </div>
        <a className="tt-btn" href="/api/sample-bot" download="sample_bot.py">
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
          <Panel title="Thể thức 8 đội" subtitle="Sinh tự động khi BTC bắt đầu giải.">
            <ol className="tt-steps">
              <li><strong>Chia bảng theo seed</strong><span>Bảng A: seed {GROUP_SEEDS.A.join(', ')} · Bảng B: seed {GROUP_SEEDS.B.join(', ')}</span></li>
              <li><strong>Vòng bảng · {FORMAT.groupGames} ván</strong><span>Mỗi cặp trong bảng đấu 2 lượt đổi màu Đỏ/Xanh.</span></li>
              <li><strong>Bán kết · {FORMAT.semifinalGames} ván</strong><span>A1 gặp B2 và B1 gặp A2; mỗi cặp 2 ván.</span></li>
              <li><strong>Chung kết · {FORMAT.finalGames} ván</strong><span>Đội seed tốt hơn đi Đỏ ở lượt 1; hòa series thì seed tốt hơn vô địch.</span></li>
            </ol>
            <div className="tt-inline-facts">
              <Badge tone="success">Thắng {POINTS.win} điểm</Badge>
              <Badge tone="neutral">Hòa {POINTS.draw} điểm</Badge>
              <Badge tone="danger">Thua {POINTS.loss} điểm</Badge>
            </div>
            <p className="tt-muted">
              Xếp hạng vòng bảng: điểm → số trận thắng → hiệu số thắng/thua → seed. Mọi trận đều có seed và replay.
            </p>
          </Panel>

          <Panel title="Vòng đời một ván" subtitle="Từ bài nộp đến replay.">
            <ul className="tt-timeline">
              <li><span>1</span><div><strong>Nộp bot</strong><em>Server lưu file, băm SHA-256 và chạy smoke test.</em></div></li>
              <li><span>2</span><div><strong>Khóa bài</strong><em>Bắt đầu giải: đội tham gia không thể nộp bản mới.</em></div></li>
              <li><span>3</span><div><strong>Chấm tuần tự</strong><em>Worker chạy từng ván, ghi kết quả và lỗi bot riêng.</em></div></li>
              <li><span>4</span><div><strong>Xem lại</strong><em>Replay dựng lại từ seed, trạng thái ban đầu và danh sách nước đi.</em></div></li>
            </ul>
          </Panel>
        </div>
      </div>

      <div className="tt-grid tt-grid--2">
        <Panel title="Nộp bot đúng chuẩn" subtitle="MVP stateless, không phải Campus persistent.">
          <ul className="tt-bullets">
            <li>Đúng một file <code>.py</code>, tối đa 64 KiB, Python 3.12+.</li>
            <li>Chỉ thư viện chuẩn; không <code>pip install</code>, không đọc file ngoài.</li>
            <li>Nhận JSON qua stdin, trả JSON qua stdout; không in log lẫn vào kết quả.</li>
            <li>Không giữ trạng thái giữa các nước; mỗi request là tiến trình mới.</li>
            <li>Nộp lại không xóa lịch sử; bài hợp lệ mới nhất được dùng khi giải khóa.</li>
          </ul>
          <Alert tone="warning" title="Không phải sandbox">
            Bot chạy trên máy BTC bằng tiến trình con, không có cô lập cấp hệ điều hành. Chỉ nhận code từ
            thành viên tin cậy; không mở upload qua Internet.
          </Alert>
        </Panel>

        <Panel
          title={isAdmin ? 'Vận hành local' : 'An toàn & hỗ trợ'}
          subtitle={isAdmin ? 'Ba tiến trình dev trên máy BTC.' : 'Biết trước để tránh mất dữ liệu.'}
        >
          {isAdmin ? (
            <div className="tt-code-list">
              <div><span>API</span><code>npm run dev:api</code></div>
              <div><span>Worker</span><code>npm run dev:worker</code></div>
              <div><span>UI dev</span><code>npm run dev</code></div>
              <div><span>Test</span><code>npm test</code></div>
              <div><span>Admin đầu tiên</span><code>node tools/cli/create-admin.js</code></div>
            </div>
          ) : (
            <ul className="tt-bullets">
              <li>Một tài khoản cho mỗi đội; không chia sẻ mật khẩu.</li>
              <li>Phiên đăng nhập 8 giờ, cookie HttpOnly; BTC thu hồi bằng cách đặt lại mật khẩu.</li>
              <li>Bài nộp bị khóa khi đội đang thi; gửi trước giờ bắt đầu.</li>
              <li>Kết quả và replay chỉ đọc; khiếu nại gửi BTC kèm mã ván.</li>
            </ul>
          )}
          <div className="tt-inline-facts">
            <span><ShieldCheck size={15} aria-hidden="true" />API bind loopback</span>
            <span><Swords size={15} aria-hidden="true" />Server xác thực nước đi</span>
            <span><FileCode2 size={15} aria-hidden="true" />Replay có seed</span>
          </div>
        </Panel>
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
