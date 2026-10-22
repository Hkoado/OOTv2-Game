import React, { useState } from 'react';
import {
  ArrowRight, Eye, EyeOff, KeyRound, Loader2, Moon, Play, Sun, Trophy, Wifi, WifiOff,
} from 'lucide-react';
import GameBoard from '../../ui/GameBoard.jsx';
import { SAMPLE_MAPS } from '../../game/sampleMaps.js';
import { createOfflineGame, fillOfflineSetup, confirmOfflineSetup } from '../../game/offlineGame.js';
const previewMap = SAMPLE_MAPS[1].map;
const previewState = fillOfflineSetup(confirmOfflineSetup(fillOfflineSetup(createOfflineGame(previewMap))));
import { Alert, Field } from './TournamentUi.jsx';

const STATUS_COPY = {
  checking: { text: 'Đang kiểm tra máy chủ…', tone: 'checking', icon: Loader2 },
  online: { text: 'API local sẵn sàng', tone: 'online', icon: Wifi },
  offline: { text: 'Chưa kết nối được API local', tone: 'offline', icon: WifiOff },
};

export default function LoginScreen({ onSubmit, onOffline, onLive, busy, error, notice, serverStatus = 'checking', theme, onToggleTheme }) {
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
              <span className="tt-brand__mark"><img src="/logo.png" alt="OOTv2" /></span>
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
            Luyện cờ trên cùng một máy, xem trực tiếp các trận đang đấu, hoặc đăng nhập để tham gia giải đấu bot.
          </p>

          <div className="tt-login__board"><GameBoard pieces={previewState.pieces} map={previewMap} title="Bàn luyện tập" readOnly /></div>
          <div className="tt-login__choices">
            <button type="button" className="tt-btn tt-btn--primary tt-btn--block" onClick={onLive}>
              <Play size={18} aria-hidden="true" /> Xem trực tiếp các trận đang đấu
            </button>
            <button type="button" className="tt-btn tt-btn--info tt-btn--block" onClick={onOffline}>
              Chơi offline · Không cần đăng nhập
            </button>
          </div>
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
            <Field label="Tên đăng nhập">
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
            Quên mật khẩu? Liên hệ BTC.
          </p>
          <p className="tt-login__legal">
            Chỉ dành cho thành viên tin cậy trên máy BTC. Bot chạy bằng tiến trình riêng, không có sandbox cấp hệ điều hành.
          </p>
        </section>
      </div>
    </main>
  );
}

