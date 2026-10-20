import React from 'react';

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
      }}
    >
      <p style={{ marginBottom: '4px' }}>
        Cyberpunk RED is a trademark of R. Talsorian Games, Inc. and used with permission.
      </p>
      <p>
        本ツールは非公式のファン作成ツールです。公式のルールブックおよび最新データをご参照ください。
      </p>
    </footer>
  );
};
