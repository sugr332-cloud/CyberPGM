import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { BoardView } from '../components/BoardView.js';
import { Board, BoardObject, BoardToken, BoardDrop, Combat } from '@cyberpgm/shared';

export const ScreenPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const codeParam = searchParams.get('code') || searchParams.get('session_code') || '';
  const [sessionCode, setSessionCode] = useState<string>(codeParam);
  const [screenData, setScreenData] = useState<{
    combat: Combat | null;
    board: Board | null;
    objects: BoardObject[];
    tokens: BoardToken[];
    drops: BoardDrop[];
  } | null>(null);

  // Sync param to state if query param changes
  useEffect(() => {
    if (codeParam) {
      setSessionCode(codeParam);
    }
  }, [codeParam]);

  // Connect via WebSocket with sessionCode
  const { isConnected } = useWebSocket({
    sessionCode: sessionCode || null,
    onMessage: (type, payload) => {
      if (type === 'screen:update') {
        setScreenData(payload as any);
      }
    },
  });

  if (!sessionCode) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 max-w-md w-full shadow-2xl text-center">
          <h1 className="text-2xl font-bold mb-4 text-cyan-400">TV 共有画面</h1>
          <p className="text-slate-400 text-sm mb-6 leading-relaxed">
            セッションコードを入力するか、GM画面の「TV共有URL」からアクセスしてください。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const input = (e.currentTarget.elements.namedItem('code') as HTMLInputElement)?.value;
              if (input) setSessionCode(input.trim().toUpperCase());
            }}
            className="flex flex-col gap-4"
          >
            <input
              name="code"
              type="text"
              placeholder="セッションコード (例: ABCD)"
              className="px-4 py-3 bg-slate-950 border border-slate-700 rounded-lg text-center font-mono text-lg tracking-widest text-slate-100 focus:outline-none focus:border-cyan-500"
              required
            />
            <button
              type="submit"
              className="py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg transition-colors"
            >
              共有画面を表示
            </button>
          </form>
        </div>
      </div>
    );
  }

  const combat = screenData?.combat;
  const board = screenData?.board;
  const objects = screenData?.objects || [];
  const tokens = screenData?.tokens || [];
  const drops = screenData?.drops || [];

  const activePart = combat?.participants?.[combat.turn_index];
  const allies = combat?.participants?.filter((p) => p.side === 'ally') || [];
  const enemies = combat?.participants?.filter((p) => p.side === 'enemy') || [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top TV Bar */}
      <header className="px-6 py-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between backdrop-blur">
        <div className="flex items-center gap-6">
          <span className="text-xl font-black tracking-wider text-cyan-400">CyberPGM</span>
          {combat && combat.status === 'active' && (
            <div className="flex items-center gap-4">
              <span className="px-3 py-1 bg-cyan-950 border border-cyan-700 rounded-full text-cyan-300 font-bold text-sm">
                ラウンド {combat.round}
              </span>
              <span className="text-slate-300 text-sm">
                手番: <strong className="text-cyan-400 text-base">{activePart?.name || '—'}</strong>
              </span>
            </div>
          )}
        </div>

        {/* Initiative Order Track */}
        {combat && combat.participants && combat.participants.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto max-w-xl py-1">
            {combat.participants.map((p, idx) => {
              const isTurn = idx === combat.turn_index;
              const isAlly = p.side === 'ally';
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-2 px-3 py-1 rounded-md border text-xs whitespace-nowrap transition-all ${
                    isTurn
                      ? 'bg-cyan-950/80 border-cyan-400 shadow-md ring-2 ring-cyan-500/50'
                      : 'bg-slate-800/80 border-slate-700'
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                      isAlly ? 'bg-cyan-900 text-cyan-200' : 'bg-orange-900 text-orange-200'
                    }`}
                  >
                    {p.name.slice(0, 1)}
                  </span>
                  <span className={`font-semibold ${isTurn ? 'text-white' : 'text-slate-300'}`}>
                    {p.name}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-3 text-xs text-slate-500 font-mono">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <span>コード: {sessionCode}</span>
        </div>
      </header>

      {/* Main TV Screen Content */}
      <main className="flex-1 flex flex-col lg:flex-row p-4 gap-4 overflow-hidden">
        {/* Center: Board */}
        <div className="flex-1 flex items-center justify-center bg-slate-900/40 rounded-xl border border-slate-800/80 p-2 overflow-auto">
          {board ? (
            <BoardView
              board={board}
              objects={objects}
              tokens={tokens}
              drops={drops}
              combat={combat}
              activeParticipantId={activePart?.id}
              isScreen={true}
              style={{ width: '100%', height: '100%' }}
            />
          ) : (
            <div className="text-slate-500 text-center p-12">
              <p className="text-lg font-semibold mb-2">盤面が設定されていません</p>
              <p className="text-sm">GMが戦闘タブで盤面を開始するのをお待ちください</p>
            </div>
          )}
        </div>

        {/* Sidebar: Combatants summary */}
        {combat && combat.status === 'active' && (
          <aside className="w-full lg:w-80 flex flex-col gap-4 overflow-y-auto">
            {/* Allies section with full numeric HP */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
              <h3 className="text-sm font-bold text-cyan-400 flex items-center justify-between border-b border-slate-800 pb-2">
                <span>味方</span>
                <span className="text-xs text-slate-500 font-mono">{allies.length}名</span>
              </h3>
              <div className="flex flex-col gap-2">
                {allies.map((p) => {
                  const char = p.character;
                  const hp = char?.hp_current ?? p.hp_current ?? 0;
                  const maxHp = char?.hp_max ?? p.hp_max ?? 1;
                  const percent = Math.max(0, Math.min(100, (hp / maxHp) * 100));
                  return (
                    <div
                      key={p.id}
                      className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2.5 flex flex-col gap-1.5"
                    >
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-slate-200">{p.name}</span>
                        <span className="font-mono text-cyan-300 font-semibold">
                          HP {hp}/{maxHp}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-cyan-500 transition-all"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Enemies section: ONLY name and wound state - NO numeric HP/SP! */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
              <h3 className="text-sm font-bold text-orange-400 flex items-center justify-between border-b border-slate-800 pb-2">
                <span>敵</span>
                <span className="text-xs text-slate-500 font-mono">{enemies.length}名</span>
              </h3>
              <div className="flex flex-col gap-2">
                {enemies.map((p) => {
                  // wound_state is sent from server for enemies
                  const woundState = (p as any).wound_state || 'healthy';
                  const badgeColor =
                    woundState === 'healthy'
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                      : woundState === 'seriously_wounded'
                      ? 'bg-amber-950 text-amber-300 border-amber-800'
                      : woundState === 'mortally_wounded'
                      ? 'bg-red-950 text-red-300 border-red-800'
                      : 'bg-slate-800 text-slate-400 border-slate-700';

                  const badgeText =
                    woundState === 'healthy'
                      ? '健康'
                      : woundState === 'seriously_wounded'
                      ? '重傷'
                      : woundState === 'mortally_wounded'
                      ? '瀕死'
                      : '死亡';

                  return (
                    <div
                      key={p.id}
                      className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2.5 flex justify-between items-center text-xs"
                    >
                      <span className="font-bold text-slate-200">{p.name}</span>
                      <span
                        className={`px-2.5 py-0.5 rounded text-[11px] font-bold border ${badgeColor}`}
                      >
                        {badgeText}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
        )}
      </main>
    </div>
  );
};
export default ScreenPage;
