import React, { useState, useEffect } from 'react';
import { ItemsDebug } from './pages/ItemsDebug.js';

export const App: React.FC = () => {
  const [, setCurrentPath] = useState(window.location.pathname);

  useEffect(() => {
    const handlePopState = () => setCurrentPath(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          background: '#0D0E11',
          color: '#ffffff',
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ fontWeight: 'bold', fontSize: '18px', color: '#4FB6E3' }}>CyberPGM</div>
        <nav style={{ display: 'flex', gap: '16px' }}>
          <a
            href="/debug/items"
            onClick={(e) => {
              e.preventDefault();
              window.history.pushState({}, '', '/debug/items');
              setCurrentPath('/debug/items');
            }}
            style={{ color: '#fff', textDecoration: 'none' }}
          >
            DB確認 (/debug/items)
          </a>
        </nav>
      </header>

      <main style={{ flex: 1, maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
        <ItemsDebug />
      </main>

      <footer
        style={{
          borderTop: '1px solid #ccc',
          padding: '16px 20px',
          background: '#f9f9f9',
          fontSize: '12px',
          color: '#555',
          textAlign: 'center',
          lineHeight: '1.6',
        }}
      >
        <p style={{ margin: '0 0 6px 0' }}>
          CyberPGM is unofficial content provided under the Homebrew Content Policy of R. Talsorian Games
          and is not approved or endorsed by RTG. This content references materials that are the property
          of R. Talsorian Games and its licensees.
        </p>
        <p style={{ margin: 0 }}>
          Icons: game-icons.net ほか (CC-BY), data: fvtt-cyberpunk-red-core (GPLv3)
        </p>
      </footer>
    </div>
  );
};

export default App;
