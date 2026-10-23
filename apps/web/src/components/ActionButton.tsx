import React from 'react';

/** 使用不可の理由を常時見せ、マウス・キーボードとも操作を止める。 */
export function ActionButton({ reason, children, style, disabled, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { reason?: string | null }) {
  const blocked = Boolean(reason) || disabled;
  return <button {...props} disabled={blocked} aria-disabled={blocked ? 'true' : undefined} title={reason || props.title} style={{ ...style, ...(blocked ? { opacity: .45, filter: 'grayscale(1)', cursor: 'not-allowed' } : {}) }}>
    {children}
    {reason && <small data-testid="action-disabled-reason" style={{ display: 'block', maxWidth: 260, marginTop: 4, fontSize: '.7rem', fontWeight: 400, whiteSpace: 'normal' }}>{reason}</small>}
  </button>;
}
