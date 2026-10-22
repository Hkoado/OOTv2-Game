import React, { useState } from 'react';
import {
  ArrowRight, Eye, EyeOff, FileCode2, KeyRound, Loader2, Moon, ShieldCheck, Sun, Target, Trophy, Wifi, WifiOff,
} from 'lucide-react';
import { Alert, Field } from './TournamentUi.jsx';

const STATUS_COPY = {
  checking: { text: 'Đang kiểm tra máy chủ…', tone: 'checking', icon: Loader2 },
  online: { text: 'API local sẵn sàng', tone: 'online', icon: Wifi },
  offline: { text: 'Chưa kết nối được API local', tone: 'offline', icon: WifiOff },
};

export default function LoginScreen({ onSubmit, busy, error, notice, serverStatus = 'checking', theme, onToggleTheme }) {
  const [showPassword, setShowPassword] = useState(false);
  const status = STATUS_COPY[serverStatus] || STATUS_COPY.checking;
  const StatusIcon = status.icon;

  async function handleSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    await onSubmit({
      username: form.elements.username.value,
      password: form.elements.password.value,
    });
  }

  return (
    <main className="tt-login">
      <div className="tt-login__frame">
        <section className="tt-login__hero" aria-labelledby="tt-login-title">
          <header className="tt-login__top">
            <div className="tt-brand">
              <span className="tt-brand__mark" aria-hidden="true"><Trophy size={20} /></span>
              <span className="tt-brand__text"><strong>OOTv2</strong><span>Bot League</span></span>
            </div>
            <button
              type="button"
              className="tt-icon-btn"
              onClick={onToggleTheme}
              aria-label={theme === 'light' ? 'Chuyển sang theme tối' : 'Chuyển sang theme sáng'}
            >
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
          </header>

          <p className="tt-eyebrow">Giải đấu bot · Oẳn Tù Tì 9×9</p>
          <h1 id="tt-login-title" className="tt-login__title">
            Viết bot. Vào bảng.<br />Đấu bằng thuật toán.
          </h1>
          <p className="tt-login__lead">
            Cổng thi đấu dành cho 8 đội: nộp một file Python, khóa phiên bản khi giải bắt đầu và theo dõi
            toàn bộ 30 ván trên cùng một màn hình. Trọng tài là server, không phải bot.
          </p>

          <ul className="tt-login__facts">
            <li>
              <span className="tt-login__fact-icon" aria-hidden="true"><Target size={18} /></span>
              <span><strong>8 đội · 30 ván</strong><em>2 bảng, bán kết, chung kết; đổi màu mỗi cặp</em></span>
            </li>
            <li>
              <span className="tt-login__fact-icon" aria-hidden="true"><FileCode2 size={18} /></span>
              <span><strong>1 file Python</strong><em>Python 3.12+ · chỉ thư viện chuẩn · tối đa 64 KiB</em></span>
            </li>
            <li>
              <span className="tt-login__fact-icon" aria-hidden="true"><ShieldCheck size={18} /></span>
              <span><strong>Replay có seed</strong><em>Trạng thái ban đầu và từng nước đi do server ghi lại</em></span>
            </li>
          </ul>

          <div className={`tt-login__status tt-login__status--${status.tone}`}>
            <StatusIcon size={16} className={serverStatus === 'checking' ? 'tt-spinner__icon' : undefined} aria-hidden="true" />
            <span>{status.text}</span>
          </div>
        </section>

        <section className="tt-login__card" aria-labelledby="tt-login-form-title">
          <div className="tt-login__card-head">
            <span className="tt-eyebrow">Khu vực nội bộ</span>
            <span className="tt-login__pill">Local · MVP</span>
          </div>
          <h2 id="tt-login-form-title" className="tt-login__card-title">Đăng nhập</h2>
          <p className="tt-login__card-sub">
            Mỗi đội dùng một tài khoản do BTC cấp. Không tự đăng ký, không dùng chung tài khoản.
          </p>

          {error && <Alert tone="danger" title="Không đăng nhập được">{error}</Alert>}
          {notice && <Alert tone="success">{notice}</Alert>}

          <form className="tt-form" onSubmit={handleSubmit}>
            <Field label="Tên đăng nhập" hint="3–40 ký tự chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.">
              <input
                name="username"
                autoComplete="username"
                maxLength={40}
                autoCapitalize="none"
                spellCheck={false}
                required
                autoFocus
                disabled={busy}
              />
            </Field>
            <Field label="Mật khẩu">
              <span className="tt-input-affix">
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  maxLength={128}
                  required
                  disabled={busy}
                />
                <button
                  type="button"
                  className="tt-input-affix__btn"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </Field>
            <button type="submit" className="tt-btn tt-btn--primary tt-btn--block" disabled={busy}>
              {busy ? <Loader2 size={18} className="tt-spinner__icon" aria-hidden="true" /> : <KeyRound size={18} aria-hidden="true" />}
              {busy ? 'Đang xác thực…' : 'Vào giải đấu'}
              {!busy && <ArrowRight size={16} aria-hidden="true" />}
            </button>
          </form>

          <p className="tt-login__help">
            Quên mật khẩu? Liên hệ BTC để đặt lại. Phiên đăng nhập kéo dài 8 giờ và dùng cookie HttpOnly.
          </p>
          <p className="tt-login__legal">
            Chỉ dành cho thành viên tin cậy trên máy BTC. Bot chạy bằng tiến trình riêng, không có sandbox cấp hệ điều hành.
          </p>
        </section>
      </div>
    </main>
  );
}

