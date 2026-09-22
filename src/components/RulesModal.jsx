import React from 'react';
import { X, ShieldCheck, Flag, Zap, Clock, Users } from 'lucide-react';

export default function RulesModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card--large" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="flex items-center gap-2">
            <span className="badge badge--green">Hướng dẫn thi đấu</span>
            <h2 className="modal-title">Luật chơi Oẳn Tù Tì v2 (OTTv2)</h2>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="rules-content">
          <section className="rule-section">
            <h3 className="rule-heading">
              <Zap className="w-4 h-4 text-emerald-600" />
              1. Bàn cờ & Quân cờ
            </h3>
            <ul className="rule-list">
              <li>Bàn cờ kích thước <strong>9x9</strong> (81 ô).</li>
              <li>Mỗi đội có <strong>9 quân cờ</strong> gồm: <strong>3 Đấm (Búa ✊), 3 Lá (Bao ✋), 3 Kéo (✌️)</strong>.</li>
              <li>Mỗi quân cờ được di chuyển tối đa <strong>1 ô theo mọi hướng (8 hướng)</strong> giống như quân Vua trong cờ vua.</li>
            </ul>
          </section>

          <section className="rule-section">
            <h3 className="rule-heading">
              <Clock className="w-4 h-4 text-emerald-600" />
              2. Giai đoạn Xếp quân (Setup - 30 giây)
            </h3>
            <ul className="rule-list">
              <li>
                <strong>Sân nhà Đỏ (quanh a1):</strong> 28 ô hợp lệ (tổng cột + hàng ≤ 8).
              </li>
              <li>
                <strong>Sân nhà Xanh (quanh i9):</strong> 28 ô hợp lệ (tổng cột + hàng ≥ 12).
              </li>
              <li>
                <strong>Ranh giới giữa sân:</strong> 3 đường chéo ở giữa bàn cờ (<strong>25 ô</strong>) tuyệt đối <em>không được xếp quân</em>.
              </li>
              <li>
                <strong>Quy trình xếp:</strong> Đội Đỏ đi trước và phải xếp quân trước trong 30s. Sau đó Đội Xanh đi sau được xếp quân trong 30s.
              </li>
              <li>
                <strong>Tầm nhìn:</strong> Đội Xanh đi sau nên <strong>được nhìn thấy toàn bộ vị trí và loại quân của Đội Đỏ</strong> để dàn thế trận.
              </li>
            </ul>
          </section>

          <section className="rule-section">
            <h3 className="rule-heading">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              3. Quy tắc Di chuyển & Ăn quân
            </h3>
            <ul className="rule-list">
              <li><strong>Đấm (Búa ✊)</strong> thắng <strong>Kéo (✌️)</strong>.</li>
              <li><strong>Kéo (✌️)</strong> thắng <strong>Lá (Bao ✋)</strong>.</li>
              <li><strong>Lá (Bao ✋)</strong> thắng <strong>Đấm (Búa ✊)</strong>.</li>
              <li>
                <strong>Hai quân cùng loại:</strong> Không thể ăn nhau mà chỉ đứng chặn đường nhau (không thể đi vào ô của nhau).
              </li>
              <li>
                <strong>Chặn nước đi tự sát:</strong> Người chơi không được phép di chuyển vào ô có quân đối phương mạnh hơn mình.
              </li>
            </ul>
          </section>

          <section className="rule-section">
            <h3 className="rule-heading">
              <Flag className="w-4 h-4 text-emerald-600" />
              4. Điều kiện Chiến thắng
            </h3>
            <p className="mb-2">Người chơi giành chiến thắng ngay lập tức khi thỏa mãn <strong>1 trong 2</strong> điều kiện sau:</p>
            <ol className="rule-ordered-list">
              <li>
                <strong>Đưa quân vào Nhà chính đối phương:</strong> Đội Đỏ đưa 1 quân bất kỳ vào ô <code>i9</code> (Nhà chính Xanh), HOẶC Đội Xanh đưa 1 quân bất kỳ vào ô <code>a1</code> (Nhà chính Đỏ).
              </li>
              <li>
                <strong>Ăn sạch 1 loại quân:</strong> Tiêu diệt hoàn toàn toàn bộ 3 quân của cùng một loại của đối phương (ví dụ ăn hết sạch cả 3 Kéo, hoặc 3 Búa, hoặc 3 Bao).
              </li>
            </ol>
          </section>

          <section className="rule-section">
            <h3 className="rule-heading">
              <Users className="w-4 h-4 text-emerald-600" />
              5. Phòng chơi & Người xem (Spectator)
            </h3>
            <ul className="rule-list">
              <li>Mỗi phòng chỉ dành cho đúng <strong>2 người chơi</strong> (Đội Đỏ và Đội Xanh).</li>
              <li>Khi phòng đã đủ 2 người, những người chơi tiếp theo vào phòng sẽ là <strong>Người xem (Spectator)</strong> để theo dõi trực tiếp và tránh xung đột.</li>
            </ul>
          </section>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Đã hiểu, sẵn sàng thi đấu
          </button>
        </div>
      </div>
    </div>
  );
}
