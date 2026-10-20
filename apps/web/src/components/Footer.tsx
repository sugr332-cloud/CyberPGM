import React from 'react';
import {
  RTG_DISCLAIMER_EN,
  FVTT_CREDITS_JA,
  UNOFFICIAL_FAN_NOTE_JA,
} from '@cyberpgm/shared';

export const Footer: React.FC = () => {
  return (
    <footer
      style={{
        padding: '16px 24px',
        borderTop: '1px solid var(--color-border)',
        fontSize: '0.75rem',
        color: 'var(--color-text-muted)',
        textAlign: 'center',
        marginTop: 'auto',
        lineHeight: 1.5,
      }}
    >
      <p style={{ marginBottom: '4px' }}>{RTG_DISCLAIMER_EN}</p>
      <p style={{ marginBottom: '4px' }}>{FVTT_CREDITS_JA}</p>
      <p>{UNOFFICIAL_FAN_NOTE_JA}</p>
    </footer>
  );
};
