import React, { useEffect, useState } from 'react';
import { Github, Mail, RefreshCw, Save, Users } from 'lucide-react';
import { Badge } from './TournamentUi.jsx';
import { formatDateTime } from './tournamentView.js';
import { Alert, Field, Panel } from './TournamentUi.jsx';
import { validateRepository } from './tournamentView.js';

const EMPTY_FORM = { members: '', contact: '', repository: '', branch: 'main' };

export default function TeamProfilePage({ account, actions, busy }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [repoError, setRepoError] = useState('');
  const saving = Boolean(busy?.profile);

  useEffect(() => {
    setForm({
      members: account.members || '',
      contact: account.contact || '',
      repository: account.repository || '',
      branch: account.branch || 'main',
    });
    setRepoError('');
  }, [account]);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === 'repository') setRepoError(value.trim() ? validateRepository(value.trim()) : '');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const repository = form.repository.trim();
    const repositoryError = repository ? validateRepository(repository) : '';
    if (repositoryError) {
      setRepoError(repositoryError);
      return;
    }
    const ok = await actions.saveProfile({
      members: form.members.trim(),
      contact: form.contact.trim(),
      repository,
      branch: form.branch.trim() || 'main',
    });
    if (ok) setForm((current) => ({ ...current, repository, branch: form.branch.trim() || 'main' }));
  }

  const memberCount = form.members.split('\n').map((line) => line.trim()).filter(Boolean).length;

  return (
    <>
      <header className="tt-page-head">
        <div>
          <p className="tt-eyebrow">Hồ sơ đội</p>
          <h1 className="tt-page-title">{account.name}</h1>
          <p className="tt-page-lead">
            Một đội dùng một tài khoản. Tên đội do BTC cấp; thành viên và liên hệ chỉ là thông tin hồ sơ,
            không phải tài khoản đăng nhập.
          </p>
        </div>
      </header>

      <div className="tt-grid tt-grid--2 tt-grid--form">
        <Panel title="Thông tin đội" subtitle="BTC dùng thông tin này khi cần liên hệ hoặc xác minh bài nộp.">
          <form className="tt-form" onSubmit={handleSubmit}>
            <Field label="Thành viên" hint={`Mỗi dòng một người. Hiện có ${memberCount} thành viên.`}>
              <textarea
                name="members"
                rows={5}
                maxLength={2000}
                value={form.members}
                onChange={(event) => update('members', event.target.value)}
                placeholder={'Nguyễn Văn A — trưởng nhóm\nTrần Thị B — bot'}
              />
            </Field>
            <Field label="Liên hệ" hint="Email hoặc kênh chat BTC có thể phản hồi nhanh.">
              <input
                name="contact"
                maxLength={300}
                value={form.contact}
                onChange={(event) => update('contact', event.target.value)}
                placeholder="email@example.com hoặc Discord/Telegram"
              />
            </Field>
            <Field label="Repository GitHub" hint="Nhập link GitHub public hoặc link test: https://github.com/mock/sample-bot" error={repoError}>
              <input
                name="repository"
                type="url"
                maxLength={300}
                value={form.repository}
                onChange={(event) => update('repository', event.target.value)}
                placeholder="https://github.com/owner/repository"
                spellCheck={false}
              />
            </Field>
            <Field label="Branch" hint="Branch chứa file bot.py (mặc định main)">
              <input
                name="branch"
                maxLength={300}
                value={form.branch}
                onChange={(event) => update('branch', event.target.value)}
                placeholder="main"
                spellCheck={false}
              />
            </Field>
            <div className="tt-form__actions">
              <button type="submit" className="tt-btn tt-btn--primary" disabled={saving || Boolean(repoError)}>
                <Save size={16} aria-hidden="true" />
                {saving ? 'Đang lưu…' : 'Lưu hồ sơ'}
              </button>
            </div>
          </form>
        </Panel>

        <div className="tt-stack">
          <Panel title="Tài khoản">
            <dl className="tt-deflist">
              <div><dt>Tên đăng nhập</dt><dd><code>{account.username}</code></dd></div>
              <div><dt>Vai trò</dt><dd>Đội thi</dd></div>
              <div><dt>Tên đội</dt><dd>{account.name}</dd></div>
              <div><dt>Mã đội</dt><dd><code>{String(account.participant_id || '').slice(0, 8)}</code></dd></div>
            </dl>
            <p className="tt-muted">Cần đổi tên đội hoặc cấp lại mật khẩu? Liên hệ BTC; đội không tự đổi được.</p>
          </Panel>

          <Panel title="GitHub & đồng bộ">
            <Alert tone="info">
              Đồng bộ GitHub, runner Campus và sandbox chưa được bật trong bản local. Repository ở đây chỉ để BTC
              đối chiếu khi nhận bài qua file <code>.py</code>.
            </Alert>
            <ul className="tt-detail-list">
              <li><Github size={16} aria-hidden="true" /><span>{account.repository || 'Chưa khai báo repository'}</span></li>
              <li><Users size={16} aria-hidden="true" /><span>{memberCount || 0} thành viên trong hồ sơ</span></li>
              <li><Mail size={16} aria-hidden="true" /><span>{account.contact || 'Chưa có kênh liên hệ'}</span></li>
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
