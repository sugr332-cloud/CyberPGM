import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { GmPage } from './pages/GmPage.js';
import { PlayerPage } from './pages/PlayerPage.js';
import { CharacterCreatePage } from './pages/CharacterCreatePage.js';
import { ItemsDebug } from './pages/ItemsDebug.js';
import { GmCombatWindowPage } from './pages/GmCombatWindowPage.js';
import { ScreenPage } from './pages/ScreenPage.js';
import { OfflineCatalogPage } from './pages/OfflineCatalogPage.js';
import { useNetworkStatus } from './hooks/useNetworkStatus.js';

const OfflineNotificationBanner: React.FC = () => {
  const isOnline = useNetworkStatus();

  if (isOnline) return null;

  return (
    <div
      style={{
        backgroundColor: '#991B1B',
        color: '#FEE2E2',
        padding: '8px 16px',
        fontSize: '0.85rem',
        fontWeight: 600,
        textAlign: 'center',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        borderBottom: '1px solid #DC2626',
      }}
    >
      <span>⚠️ 通信状態: オフライン（閲覧のみモード。キャラクター送信やデータ更新は無効です）</span>
      <Link
        to="/catalog"
        style={{
          color: '#FEF08A',
          textDecoration: 'underline',
          fontSize: '0.8rem',
        }}
      >
        オフラインカタログを開く
      </Link>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <OfflineNotificationBanner />
      <Routes>
        <Route path="/gm" element={<GmPage />} />
        <Route path="/gm/combat" element={<GmCombatWindowPage />} />
        <Route path="/screen" element={<ScreenPage />} />
        <Route path="/player" element={<PlayerPage />} />
        <Route path="/player/create" element={<CharacterCreatePage />} />
        <Route path="/catalog" element={<OfflineCatalogPage />} />
        <Route path="/debug/items" element={<ItemsDebug />} />
        {/* Default route to /player */}
        <Route path="/" element={<Navigate to="/player" replace />} />
        {/* Fallback */}
        <Route path="*" element={<Navigate to="/player" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
