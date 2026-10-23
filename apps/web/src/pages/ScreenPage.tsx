import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { BoardView } from '../components/BoardView.js';
import { BgmPlayer, BgmState } from '../components/BgmPlayer.js';
import { Board, BoardObject, BoardToken, BoardDrop, Combat } from '@cyberpgm/shared';

export const ScreenPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const codeParam = searchParams.get('code') || searchParams.get('session_code') || '';
  const [sessionCode, setSessionCode] = useState<string>(codeParam);
  const [screenData, setScreenData] = useState<{
    active?: boolean;
    mode?: 'combat' | 'story';
    combat?: Combat | null;
    board?: Board | null;
    objects?: BoardObject[];
    tokens?: BoardToken[];
    drops?: BoardDrop[];
    background_image_id?: string | null;
    portraits?: Array<{ character_id: string; name: string; image_id: string; x: number; y: number; scale: number; flip: boolean; z: number; show_name: boolean }>;
    bgm?: BgmState | null;
    tv_handout?: {
      id: string;
      title: string;
      body: string;
      image_path?: string | null;
    } | null;
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
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: 'var(--color-bg)',
          color: 'var(--color-text)',
          fontFamily: 'var(--font-body)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '12px',
            padding: '32px',
            maxWidth: '420px',
            width: '100%',
            textAlign: 'center',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          }}
        >
          <h1
            style={{
              fontSize: '1.6rem',
              fontWeight: 700,
              fontFamily: 'var(--font-display)',
              color: 'var(--color-ally)',
              marginBottom: '12px',
            }}
          >
            TV 共有画面
          </h1>
          <p
            style={{
              color: 'var(--color-text-muted)',
              fontSize: '0.9rem',
              lineHeight: 1.6,
              marginBottom: '24px',
            }}
          >
            セッションコードを入力するか、GM画面の「TV共有URL」からアクセスしてください。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const input = (e.currentTarget.elements.namedItem('code') as HTMLInputElement)?.value;
              if (input) setSessionCode(input.trim().toUpperCase());
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
          >
            <input
              name="code"
              type="text"
              placeholder="セッションコード (例: ABCD)"
              style={{
                padding: '12px 16px',
                backgroundColor: 'var(--color-bg)',
                border: '1px solid var(--color-border-light)',
                borderRadius: '6px',
                textAlign: 'center',
                fontFamily: 'var(--font-mono)',
                fontSize: '1.2rem',
                letterSpacing: '0.2em',
                color: 'var(--color-text)',
                outline: 'none',
              }}
              required
            />
            <button
              type="submit"
              style={{
                padding: '12px 20px',
                backgroundColor: 'var(--color-ally)',
                color: '#000',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 700,
                fontSize: '0.95rem',
                cursor: 'pointer',
              }}
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
  const objects = screenData?.objects || board?.objects || [];
  const tokens = screenData?.tokens || board?.tokens || [];
  const drops = screenData?.drops || board?.drops || [];

  const activePart = combat?.participants?.[combat.turn_index];
  const allies = combat?.participants?.filter((p) => p.side === 'ally') || [];
  const enemies = combat?.participants?.filter((p) => p.side === 'enemy') || [];

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        backgroundColor: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-body)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Top TV Bar */}
      <header
        style={{
          height: '60px',
          padding: '0 24px',
          backgroundColor: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '20px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexShrink: 0 }}>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.4rem',
              fontWeight: 800,
              letterSpacing: '0.05em',
              color: 'var(--color-ally)',
            }}
          >
            CyberPGM
          </span>
          {combat && combat.status === 'active' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span
                style={{
                  padding: '3px 12px',
                  backgroundColor: 'rgba(79, 182, 227, 0.15)',
                  border: '1px solid var(--color-ally)',
                  borderRadius: '16px',
                  color: 'var(--color-ally)',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  fontFamily: 'var(--font-display)',
                }}
              >
                ラウンド {combat.round}
              </span>
              <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                手番: <strong style={{ color: 'var(--color-text)', fontSize: '1rem' }}>{activePart?.name || '—'}</strong>
              </span>
            </div>
          )}
        </div>

        {/* Initiative Order Track */}
        {combat && combat.participants && combat.participants.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              overflowX: 'auto',
              padding: '4px 0',
              flex: 1,
              justifyContent: 'center',
            }}
          >
            {combat.participants.map((p, idx) => {
              const isTurn = idx === combat.turn_index;
              const isAlly = p.side === 'ally';
              return (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '4px 12px',
                    borderRadius: '6px',
                    border: isTurn ? '2px solid var(--color-ally)' : '1px solid var(--color-border-light)',
                    backgroundColor: isTurn ? 'rgba(79, 182, 227, 0.2)' : 'var(--color-surface-elevated)',
                    boxShadow: isTurn ? '0 0 10px rgba(79, 182, 227, 0.4)' : 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <div
                    style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '0.75rem',
                      backgroundColor: isAlly ? 'rgba(79, 182, 227, 0.25)' : 'rgba(242, 140, 56, 0.25)',
                      color: isAlly ? 'var(--color-ally)' : 'var(--color-enemy)',
                      flexShrink: 0,
                    }}
                  >
                    {p.name.slice(0, 1)}
                  </div>
                  <span
                    style={{
                      fontSize: '0.85rem',
                      fontWeight: isTurn ? 700 : 500,
                      color: isTurn ? 'var(--color-text)' : 'var(--color-text-muted)',
                    }}
                  >
                    {p.name}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.85rem',
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: isConnected ? 'var(--color-success)' : 'var(--color-warning)',
            }}
          />
          <span>コード: {sessionCode}</span>
        </div>
      </header>

      {/* Main TV Screen Content */}
      <main
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          overflow: 'hidden',
          padding: '16px',
          gap: '16px',
        }}
      >
        {/* Center: Board */}
        <div
          style={{
            flex: 1,
            height: '100%',
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
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
          ) : screenData?.background_image_id || (screenData?.portraits?.length ?? 0) > 0 ? (
            <div
              data-testid="screen-stage"
              style={{ position: 'relative', width: '100%', height: '100%', backgroundColor: '#000', overflow: 'hidden' }}
            >
              {screenData?.background_image_id && (
                <img
                  src={`/api/images/${screenData.background_image_id}`}
                  alt=""
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                />
              )}
              {(screenData?.portraits ?? []).map((p, i) => (
                <div
                  key={`${p.character_id}-${i}`}
                  data-testid="screen-portrait"
                  style={{
                    position: 'absolute',
                    left: `${p.x * 100}%`,
                    top: `${p.y * 100}%`,
                    height: `${70 * p.scale}%`,
                    transform: 'translate(-50%, -100%)',
                    zIndex: p.z,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                  }}
                >
                  <img
                    src={`/api/images/${p.image_id}`}
                    alt={p.name}
                    style={{ height: '100%', transform: `scaleX(${p.flip ? -1 : 1})` }}
                  />
                  {p.show_name && (
                    <span
                      style={{
                        position: 'absolute',
                        bottom: '4%',
                        padding: '4px 14px',
                        backgroundColor: 'rgba(0, 0, 0, 0.7)',
                        borderRadius: '4px',
                        fontFamily: 'var(--font-display)',
                        fontWeight: 700,
                        fontSize: '1.3rem',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.name}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '48px' }}>
              <p style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '8px' }}>CyberPGM 共有画面</p>
              <p style={{ fontSize: '0.9rem' }}>GMからの投影をお待ちください</p>
            </div>
          )}

          <BgmPlayer bgm={screenData?.bgm ?? null} />

          {/* Floating TV Handout Card */}
          {screenData?.tv_handout && (
            <div
              style={{
                position: 'absolute',
                bottom: '24px',
                right: '24px',
                maxWidth: '480px',
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                border: '2px solid var(--color-ally)',
                borderRadius: '12px',
                padding: '20px',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8)',
                backdropFilter: 'blur(8px)',
                zIndex: 30,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-ally)', fontWeight: 700, letterSpacing: '0.05em' }}>
                  【資料公開】
                </span>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--color-text)' }}>
                  {screenData.tv_handout.title}
                </h3>
              </div>
              {screenData.tv_handout.image_path && (
                <img
                  src={screenData.tv_handout.image_path}
                  alt={screenData.tv_handout.title}
                  style={{
                    width: '100%',
                    maxHeight: '240px',
                    objectFit: 'contain',
                    borderRadius: '6px',
                    marginBottom: '10px',
                    backgroundColor: '#000',
                  }}
                />
              )}
              <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-text-muted)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {screenData.tv_handout.body}
              </p>
            </div>
          )}
        </div>

        {/* Sidebar: Combatants summary */}
        {combat && combat.status === 'active' && (
          <aside
            style={{
              width: '320px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              overflowY: 'auto',
              flexShrink: 0,
            }}
          >
            {/* Allies section with full numeric HP */}
            <div
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: '1px solid var(--color-border)',
                  paddingBottom: '8px',
                }}
              >
                <span style={{ fontWeight: 700, color: 'var(--color-ally)', fontSize: '0.95rem' }}>味方</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {allies.length}名
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {allies.map((p) => {
                  const char = p.character;
                  const hp = char?.hp ?? 0;
                  const maxHp = char?.hp_max ?? 1;
                  const percent = Math.max(0, Math.min(100, (hp / maxHp) * 100));
                  const isWounded = hp <= maxHp / 2;
                  const isCritical = hp <= 0;
                  const barColor = isCritical ? 'var(--color-text-muted)' : isWounded ? 'var(--color-warning)' : 'var(--color-ally)';

                  return (
                    <div
                      key={p.id}
                      style={{
                        backgroundColor: 'var(--color-surface-elevated)',
                        border: '1px solid var(--color-border-light)',
                        borderRadius: '6px',
                        padding: '10px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{p.name}</span>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            color: barColor,
                          }}
                        >
                          HP {hp}/{maxHp}
                        </span>
                      </div>
                      <div
                        style={{
                          width: '100%',
                          height: '6px',
                          backgroundColor: 'rgba(255, 255, 255, 0.1)',
                          borderRadius: '3px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          role="progressbar"
                          aria-label={`${p.name} HP`}
                          aria-valuemin={0}
                          aria-valuemax={maxHp}
                          aria-valuenow={hp}
                          data-testid={`screen-hp-${p.character_id}`}
                          style={{
                            height: '100%',
                            width: `${percent}%`,
                            backgroundColor: barColor,
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Enemies section: ONLY name and wound state - NO numeric HP/SP! */}
            <div
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: '1px solid var(--color-border)',
                  paddingBottom: '8px',
                }}
              >
                <span style={{ fontWeight: 700, color: 'var(--color-enemy)', fontSize: '0.95rem' }}>敵</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {enemies.length}名
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {enemies.map((p) => {
                  const woundState = (p as any).wound_state || (p.character as any)?.wound_state || '健康';
                  let badgeBg = 'rgba(126, 226, 168, 0.15)';
                  let badgeColor = 'var(--color-success)';
                  let badgeBorder = 'var(--color-success)';

                  if (woundState === '重傷') {
                    badgeBg = 'rgba(242, 201, 76, 0.15)';
                    badgeColor = 'var(--color-warning)';
                    badgeBorder = 'var(--color-warning)';
                  } else if (woundState === '瀕死' || woundState === '死亡') {
                    badgeBg = 'rgba(255, 90, 95, 0.15)';
                    badgeColor = 'var(--color-accent)';
                    badgeBorder = 'var(--color-accent)';
                  }

                  return (
                    <div
                      key={p.id}
                      style={{
                        backgroundColor: 'var(--color-surface-elevated)',
                        border: '1px solid var(--color-border-light)',
                        borderRadius: '6px',
                        padding: '8px 12px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{p.name}</span>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          backgroundColor: badgeBg,
                          color: badgeColor,
                          border: `1px solid ${badgeBorder}`,
                        }}
                      >
                        {woundState}
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
