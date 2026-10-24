import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';

/** Khối nội dung có tiêu đề, dùng chung cho mọi trang giải đấu. */
export function Panel({ title, subtitle, actions, children, footer, className = '', id }) {
  return (
    <section className={`tt-panel ${className}`.trim()} id={id}>
      {(title || actions) && (
        <header className="tt-panel__head">
          <div>
            {title && <h2 className="tt-panel__title">{title}</h2>}
            {subtitle && <p className="tt-panel__subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="tt-panel__actions">{actions}</div>}
        </header>
      )}
      <div className="tt-panel__body">{children}</div>
      {footer && <footer className="tt-panel__footer">{footer}</footer>}
    </section>
  );
}

/** Nhãn + control + gợi ý/lỗi. Bọc control trong <label> để không cần id thủ công. */
export function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`tt-field ${className}`.trim()}>
      <span className="tt-field__label">{label}</span>
      {children}
      {hint && !error && <span className="tt-field__hint">{hint}</span>}
      {error && <span className="tt-field__error" role="alert">{error}</span>}
    </label>
  );
}

export function Badge({ tone = 'neutral', children, dot = false }) {
  return (
    <span className={`tt-badge tt-badge--${tone}`}>
      {dot && <span className="tt-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Progress({ value = 0, label }) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="tt-progress">
      {label && <div className="tt-progress__meta"><span>{label}</span><span>{safe}%</span></div>}
      <div className="tt-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={safe} aria-label={label || 'Tiến độ'}>
        <span className="tt-progress__fill" style={{ width: `${safe}%` }} />
      </div>
    </div>
  );
}

export function Stat({ label, value, hint, icon = null, tone = 'neutral' }) {
  return (
    <article className={`tt-stat tt-stat--${tone}`}>
      <div className="tt-stat__head">
        <span className="tt-stat__label">{label}</span>
        {icon && <span className="tt-stat__icon" aria-hidden="true">{icon}</span>}
      </div>
      <strong className="tt-stat__value">{value}</strong>
      {hint && <span className="tt-stat__hint">{hint}</span>}
    </article>
  );
}

const ALERT_ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertTriangle,
};

export function Alert({ tone = 'info', title, children, onClose }) {
  const Icon = ALERT_ICONS[tone] || Info;
  return (
    <div className={`tt-alert tt-alert--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden="true" />
      <div className="tt-alert__body">
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {onClose && (
        <button type="button" className="tt-alert__close" onClick={onClose} aria-label="Đóng thông báo">×</button>
      )}
    </div>
  );
}

export function Empty({ title, description, action }) {
  return (
    <div className="tt-empty">
      <p className="tt-empty__title">{title}</p>
      {description && <p className="tt-empty__description">{description}</p>}
      {action && <div className="tt-empty__action">{action}</div>}
    </div>
  );
}

export function Spinner({ label = 'Đang tải…' }) {
  return (
    <div className="tt-spinner" role="status">
      <Loader2 size={20} className="tt-spinner__icon" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function DataTable({ columns, children, label, className = '' }) {
  return (
    <div className={`tt-table-wrap ${className}`.trim()} role="region" aria-label={label} tabIndex={0}>
      <table className="tt-table">
        <thead>
          <tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** Nút hai bước cho thao tác không hoàn tác được (khóa bài, đặt lại mật khẩu). */
export function ConfirmAction({ label, confirmLabel = 'Xác nhận', onConfirm, busy = false, disabled = false, tone = 'danger' }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button type="button" className={`tt-btn tt-btn--${tone}`} disabled={disabled || busy} onClick={() => setArmed(true)}>
        {busy ? <Loader2 size={16} className="tt-spinner__icon" aria-hidden="true" /> : null}
        {label}
      </button>
    );
  }
  return (
    <span className="tt-confirm">
      <span className="tt-confirm__text">{confirmLabel}?</span>
      <button
        type="button"
        className={`tt-btn tt-btn--${tone} tt-btn--sm`}
        disabled={busy}
        onClick={async () => {
          setArmed(false);
          await onConfirm();
        }}
      >
        Chắc chắn
      </button>
      <button type="button" className="tt-btn tt-btn--ghost tt-btn--sm" onClick={() => setArmed(false)} disabled={busy}>
        Hủy
      </button>
    </span>
  );
}
