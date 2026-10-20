import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { GmPage } from './pages/GmPage.js';
import { PlayerPage } from './pages/PlayerPage.js';
import { ItemsDebug } from './pages/ItemsDebug.js';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/gm" element={<GmPage />} />
        <Route path="/player" element={<PlayerPage />} />
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
