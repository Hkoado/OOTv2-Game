import React, { useMemo, useState } from 'react';
import { KeyRound, ShieldCheck, UserPlus, X } from 'lucide-react';
import { Alert, Badge, DataTable, Field, Panel } from './TournamentUi.jsx';
import { shortSha, teamBotState } from './tournamentView.js';

const EMPTY_FORM = { name: '', username: '', password: '', confirm: '' };

export default function TeamsPage({ teams, accounts, actions, busy }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [selected, setSelected] = useState(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const rows = useMemo(() => {
    const byParticipant = new Map(
      accounts.filter((account) => account.role === 'team').map((account) => [account.participant_id, account])
    );
    return teams.map((team) => ({ team, account: byParticipant.get(team.id) || null }));
  }, [teams, accounts]);

  const teamAccounts = rows.filter((row) => row.account).length;
  const eligible = rows.filter((row) => row.team.latest_valid_submission_id).length;

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError('');
  }

  async function createTeam(event) {
    event.preventDefault();
    if (form.password.length < 10) {
      setFormError('Mật khẩu ban đầu phải từ 10 đến 128 ký tự.');
      return;
    }
    if (form.password !== form.confirm) {
      setFormError('Mật khẩu nhập lại không khớp.');
      return;
    }
    const ok = await actions.createTeam({
      name: form.name.trim(),
      username: form.username.trim(),
      password: form.password,
    });
    if (ok) {
      setForm(EMPTY_FORM);
      setFormError('');
    }
  }

  async function resetPassword(event) {
    event.preventDefault();
    if (password.length < 10) {
      setPasswordError('Mật khẩu mới phải từ 10 đến 128 ký tự.');
      return;
    }
    const ok = await actions.resetPassword(selected.id, password);
    if (ok) {
      setPassword('');
      setPasswordError('');
      setSelected(null);
    }
  }

  return (
    <>
      <header className="tt-page-head">
        <div>
          <p className="tt-eyebrow">Ban tổ chức · quyền truy cập</p>
          <h1 className="tt-page-title">Đội &amp; tài khoản</h1>
          <p className="tt-page-lead">
            Mỗi đội một tài khoản, không dùng chung. Tạo đội sẽ tạo luôn participant tương ứng; mật khẩu ban đầu
            bàn giao qua kênh riêng và nên đổi ngay sau lần đăng nhập đầu.
          </p>
        </div>
      </header>

      <section className="tt-stats" aria-label="Tổng quan tài khoản">
        <div className="tt-stat"><span className="tt-stat__label">Đội</span><strong className="tt-stat__value">{rows.length}</strong><span className="tt-stat__hint">Mỗi đội một participant</span></div>
        <div className="tt-stat"><span className="tt-stat__label">Đã cấp tài khoản</span><strong className="tt-stat__value">{teamAccounts}/{rows.length}</strong><span className="tt-stat__hint">Còn {rows.length - teamAccounts} đội chưa có</span></div>
        <div className="tt-stat tt-stat--success"><span className="tt-stat__label">Đủ điều kiện vào giải</span><strong className="tt-stat__value">{eligible}</strong><span className="tt-stat__hint">Có ít nhất một bot hợp lệ</span></div>
      </section>

      <div className="tt-grid tt-grid--2 tt-grid--form">
        <Panel title="Cấp tài khoản đội" subtitle="Tạo participant và tài khoản trong một bước.">
          <form className="tt-form" onSubmit={createTeam}>
            <Field label="Tên đội">
              <input
                name="name"
                required
                maxLength={40}
                value={form.name}
                onChange={(event) => update('name', event.target.value)}
                placeholder="Ví dụ: Rùa Thép"
              />
            </Field>
            <Field label="Tên đăng nhập" hint="3–40 ký tự chữ, số, _ . -; không phân biệt hoa thường.">
              <input
                name="username"
                required
                maxLength={40}
                pattern="[a-zA-Z0-9_.-]{3,40}"
                autoComplete="off"
                spellCheck={false}
                value={form.username}
                onChange={(event) => update('username', event.target.value)}
                placeholder="ruathep"
              />
            </Field>
            <Field label="Mật khẩu ban đầu" hint="Ít nhất 12 ký tự. BTC chuyển riêng, không gửi qua nhóm công khai.">
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                required
                autoComplete="new-password"
                value={form.password}
                onChange={(event) => update('password', event.target.value)}
              />
            </Field>
            <Field label="Nhập lại mật khẩu">
              <input
                name="confirm"
                type="password"
                minLength={12}
                maxLength={128}
                required
                autoComplete="new-password"
                value={form.confirm}
                onChange={(event) => update('confirm', event.target.value)}
              />
            </Field>
            {formError && <Alert tone="danger">{formError}</Alert>}
            <div className="tt-form__actions">
              <button type="submit" className="tt-btn tt-btn--primary" disabled={busy?.teamCreate}>
                <UserPlus size={16} aria-hidden="true" />
                {busy?.teamCreate ? 'Đang tạo…' : 'Tạo đội & tài khoản'}
              </button>
            </div>
          </form>
        </Panel>

        <Panel title="Nguyên tắc vận hành" subtitle="Áp dụng cho bản local, người dùng tin cậy.">
          <ul className="tt-bullets">
            <li>Không tạo tài khoản cho người ngoài nhóm; API chỉ bind loopback.</li>
            <li>Đặt lại mật khẩu sẽ thu hồi mọi phiên đăng nhập cũ của đội đó.</li>
            <li>Đội chưa có bot hợp lệ không thể được chọn khi tạo giải 8 đội.</li>
            <li>Tên đội phải duy nhất (không phân biệt hoa thường, bỏ khoảng trắng hai đầu).</li>
          </ul>
          <Alert tone="warning" title="Không phải sandbox">
            Mật khẩu và cookie chỉ bảo vệ truy cập UI. Bot vẫn chạy bằng tiến trình riêng trên máy BTC,
            không có cô lập cấp hệ điều hành.
          </Alert>
        </Panel>
      </div>

      <Panel
        title="Danh sách đội"
        subtitle={`${rows.length} đội · ${teamAccounts} tài khoản đã cấp`}
        actions={<Badge tone="info"><ShieldCheck size={13} aria-hidden="true" /> Admin</Badge>}
      >
        {rows.length ? (
          <DataTable
            columns={['Đội', 'Tài khoản', 'Bot', 'Bài mới nhất', 'Thao tác']}
            label="Danh sách đội và tài khoản"
          >
            {rows.map(({ team, account }) => {
              const state = teamBotState(team);
              return (
                <tr key={team.id}>
                  <td>
                    <strong>{team.name}</strong>
                    <span className="tt-cell-sub">mã {team.id.slice(0, 6)}</span>
                  </td>
                  <td>
                    {account ? (
                      <>
                        <code>{account.username}</code>
                        <span className="tt-cell-sub">{account.contact || 'chưa có liên hệ'}</span>
                      </>
                    ) : (
                      <Badge tone="warning">Chưa cấp</Badge>
                    )}
                  </td>
                  <td><Badge tone={state.tone}>{state.label}</Badge></td>
                  <td>
                    {team.latest_submission ? (
                      <>
                        <code>{shortSha(team.latest_submission.sha256)}</code>
                        <span className="tt-cell-sub">{team.latest_submission.status}</span>
                      </>
                    ) : (
                      <span className="tt-muted">—</span>
                    )}
                  </td>
                  <td>
                    {account ? (
                      <button
                        type="button"
                        className="tt-btn tt-btn--ghost tt-btn--sm"
                        onClick={() => {
                          setSelected(account);
                          setPassword('');
                          setPasswordError('');
                        }}
                      >
                        <KeyRound size={14} aria-hidden="true" />
                        Đặt lại mật khẩu
                      </button>
                    ) : (
                      <span className="tt-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        ) : (
          <p className="tt-muted">Chưa có đội nào. Tạo đội đầu tiên ở biểu mẫu bên trên.</p>
        )}

        {selected && (
          <div className="tt-inline-editor">
            <div className="tt-inline-editor__head">
              <strong>Đặt lại mật khẩu cho {selected.name}</strong>
              <button type="button" className="tt-icon-btn" onClick={() => setSelected(null)} aria-label="Đóng">
                <X size={16} />
              </button>
            </div>
            <form className="tt-form tt-form--inline" onSubmit={resetPassword}>
              <Field label="Mật khẩu mới" error={passwordError}>
                <input
                  type="password"
                  minLength={12}
                  maxLength={128}
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setPasswordError('');
                  }}
                />
              </Field>
              <button type="submit" className="tt-btn tt-btn--danger" disabled={busy?.password}>
                {busy?.password ? 'Đang đặt lại…' : 'Xác nhận đặt lại'}
              </button>
            </form>
            <p className="tt-muted">Tài khoản <code>{selected.username}</code> sẽ bị đăng xuất khỏi mọi phiên hiện tại.</p>
          </div>
        )}

      </Panel>
    </>
  );
}
