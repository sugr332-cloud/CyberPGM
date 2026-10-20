import React, { useState, useEffect, useCallback } from 'react';
import { CharacterSheet } from '@cyberpgm/shared';
import { api, getGmToken, setGmToken } from '../api.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { CombatView } from '../components/CombatView.js';

export const GmCombatWindowPage: React.FC = () => {
  const [token, setToken] = useState<string | null>(getGmToken());
  const [characters, setCharacters] = useState<CharacterSheet[]>([]);
  const [latestWsMessage, setLatestWsMessage] = useState<{ type: string; payload: any } | null>(null);

  // Initialize GM Token if needed
  useEffect(() => {
    let active = true;
    const initToken = async () => {
      const currentToken = getGmToken();
      if (!currentToken) {
        try {
          const res = await api.fetchGmToken();
          setGmToken(res.token);
          if (active) {
            setToken(res.token);
          }
        } catch (err) {
          console.error('Failed to obtain GM token:', err);
        }
      }
    };
    initToken();
    return () => {
      active = false;
    };
  }, []);

  const refreshCharacters = useCallback(async () => {
    try {
      const res = await api.getCharacters();
      setCharacters(res.characters);
    } catch (err) {
      console.warn('Failed to refresh characters:', err);
    }
  }, []);

  useEffect(() => {
    refreshCharacters();
  }, [refreshCharacters]);

  // WebSocket for synchronized updates with GM window
  useWebSocket({
    token,
    onMessage: (type, payload) => {
      setLatestWsMessage({ type, payload });
      if (type === 'characters:update' || type === 'character:update') {
        refreshCharacters();
      }
    },
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4">
      <CombatView
        characters={characters}
        onRefreshCharacters={refreshCharacters}
        token={token}
        wsMessage={latestWsMessage}
        isStandaloneWindow={true}
      />
    </div>
  );
};
export default GmCombatWindowPage;
