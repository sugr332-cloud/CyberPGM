import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  CharacterSheet,
  CharLogEntry,
  WsNotifyPayload,
  formatSkillName,
  InventoryEntry,
} from '@cyberpgm/shared';
import {
  api,
  getPlayerToken,
  setPlayerToken,
  removePlayerToken,
} from '../api.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { Footer } from '../components/Footer.js';

export const PlayerPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState<string | null>(getPlayerToken());

  // Join state
  const [joinCode, setJoinCode] = useState(searchParams.get('join') || '');
  const [availableChars, setAvailableChars] = useState<
    Array<{ id: string; name: string; role: string; claimed: boolean }>
  >([]);
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [claimWaitMessage, setClaimWaitMessage] = useState('');

  // Character sheet state
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [logs, setLogs] = useState<CharLogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'sheet' | 'act'>('sheet');
  const [banner, setBanner] = useState<WsNotifyPayload | null>(null);

  // WebSocket message handler
  const handleWsMessage = useCallback((type: string, payload: unknown) => {
    if (type === 'me:update') {
      setSheet(payload as CharacterSheet);
    } else if (type === 'notify') {
      const p = payload as WsNotifyPayload;
      setBanner(p);
      setTimeout(() => {
        setBanner((prev) => (prev === p ? null : prev));
      }, 5000);
      // Also add to logs
      setLogs((prev) => [
        {
          id: Date.now().toString(),
          character_id: sheet?.id || '',
          text: `${p.title} — ${p.body}`,
          at: Date.now(),
        },
        ...prev,
      ]);
    }
  }, [sheet?.id]);

  const { isReconnecting } = useWebSocket({
    token,
    onMessage: handleWsMessage,
  });

  // Load initial sheet if token exists
  useEffect(() => {
    if (!token) return;

    api.getMySheet()
      .then((res: { sheet: CharacterSheet; logs: CharLogEntry[] }) => {
        setSheet(res.sheet);
        setLogs(res.logs);
      })
      .catch((err: unknown) => {
        console.warn('Failed to load my character sheet:', err);
        removePlayerToken();
        setToken(null);
      });
  }, [token]);

  // Handle Join Code submit
  const handleFetchCharacters = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!joinCode.trim()) return;

    setIsJoining(true);
    setJoinError('');
    try {
      const res = await api.joinSession(joinCode.trim());
      setAvailableChars(res.characters);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setJoinError(msg || '参加コードが無効です');
    } finally {
      setIsJoining(false);
    }
  };

  // If join code is provided in URL, automatically fetch available characters
  useEffect(() => {
    const urlCode = searchParams.get('join');
    if (urlCode && !token) {
      setJoinCode(urlCode);
      api.joinSession(urlCode)
        .then((res: { characters: Array<{ id: string; name: string; role: string; claimed: boolean }> }) => setAvailableChars(res.characters))
        .catch(() => {});
    }
  }, [searchParams, token]);

  // Handle Character Claim
  const handleClaim = async (charId: string) => {
    setJoinError('');
    setClaimWaitMessage('参加をリクエスト中…（別端末が参加中の場合はGMの承認待ち）');
    try {
      const res = await api.claimCharacter(joinCode.trim(), charId);
      setPlayerToken(res.token);
      setToken(res.token);
      setClaimWaitMessage('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setJoinError(msg || '参加に失敗しました');
      setClaimWaitMessage('');
    }
  };

  // 1. Join / Claim Screen (when no token or character)
  if (!token || !sheet) {
    return (
      <div
        style={{
          maxWidth: '430px',
          margin: '0 auto',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--color-bg)',
          padding: '24px 16px',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.75rem',
              color: 'var(--color-accent)',
              letterSpacing: '2px',
              marginBottom: '4px',
            }}
          >
            CYBERPUNK RED
          </h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
            セッション参加 · キャラクター選択
          </p>
        </div>

        {availableChars.length === 0 ? (
          <form
            onSubmit={handleFetchCharacters}
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '24px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <label style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
              セッションコード（6文字）
            </label>
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="例: ABC234"
              maxLength={6}
              style={{
                backgroundColor: 'var(--color-bg)',
                border: '1px solid var(--color-border-light)',
                borderRadius: '6px',
                padding: '12px',
                fontSize: '1.25rem',
                color: 'var(--color-text)',
                textAlign: 'center',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '4px',
              }}
            />
            {joinError && (
              <p style={{ color: 'var(--color-accent)', fontSize: '0.85rem' }}>{joinError}</p>
            )}
            <button
              type="submit"
              disabled={isJoining || joinCode.length < 4}
              style={{
                backgroundColor: 'var(--color-ally)',
                color: '#000',
                border: 'none',
                borderRadius: '6px',
                padding: '12px',
                fontWeight: 700,
                fontSize: '1rem',
                cursor: 'pointer',
              }}
            >
              {isJoining ? '確認中…' : 'セッションに参加する'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '4px' }}>
              <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', margin: '4px 0 8px 0' }}>または</div>
              <button
                type="button"
                onClick={() => navigate('/player/create' + (joinCode ? `?join=${joinCode}` : ''))}
                style={{
                  width: '100%',
                  backgroundColor: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-ally)',
                  color: 'var(--color-ally)',
                  borderRadius: '6px',
                  padding: '12px',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                }}
              >
                ＋ 新しくキャラを作る
              </button>
            </div>
          </form>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                コード: <strong style={{ color: 'var(--color-text)' }}>{joinCode}</strong>
              </span>
              <button
                onClick={() => setAvailableChars([])}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-ally)',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                コード変更
              </button>
            </div>

            <p style={{ fontSize: '0.95rem', fontWeight: 600 }}>自分のキャラクターを選択:</p>

            {claimWaitMessage && (
              <div
                style={{
                  backgroundColor: 'rgba(242, 201, 76, 0.15)',
                  border: '1px solid var(--color-warning)',
                  borderRadius: '6px',
                  padding: '12px',
                  fontSize: '0.875rem',
                  color: 'var(--color-warning)',
                  textAlign: 'center',
                }}
              >
                {claimWaitMessage}
              </div>
            )}

            {joinError && (
              <p style={{ color: 'var(--color-accent)', fontSize: '0.85rem' }}>{joinError}</p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {availableChars.map((char) => (
                <button
                  key={char.id}
                  onClick={() => handleClaim(char.id)}
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    padding: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: 'var(--color-text)',
                    transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--color-ally)')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--color-border)')}
                >
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--color-surface-elevated)',
                      border: '1px solid var(--color-border-light)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.25rem',
                      fontWeight: 700,
                      color: 'var(--color-ally)',
                    }}
                  >
                    {char.name.charAt(0)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{char.name}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                      ロール: {char.role}
                    </div>
                  </div>
                  {char.claimed && (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        backgroundColor: 'rgba(242, 201, 76, 0.2)',
                        color: 'var(--color-warning)',
                      }}
                    >
                      使用中
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div style={{ marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => navigate('/player/create' + (joinCode ? `?join=${joinCode}` : ''))}
                style={{
                  width: '100%',
                  backgroundColor: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-ally)',
                  color: 'var(--color-ally)',
                  borderRadius: '6px',
                  padding: '12px',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                }}
              >
                ＋ 新しくキャラを作る
              </button>
            </div>
          </div>
        )}

        <Footer />
      </div>
    );
  }

  // 2. Character Sheet Screen
  const hpPercent = Math.max(0, Math.min(100, Math.round((sheet.hp / sheet.hp_max) * 100)));
  const seriouslyThreshold = Math.ceil(sheet.hp_max / 2) - 1;

  let hpBarColor = 'var(--color-success)';
  if (sheet.woundState === 'mortally') {
    hpBarColor = 'var(--color-accent)';
  } else if (sheet.woundState === 'seriously') {
    hpBarColor = 'var(--color-warning)';
  }

  return (
    <div
      style={{
        maxWidth: '430px',
        margin: '0 auto',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--color-bg)',
        paddingBottom: '70px',
      }}
    >
      {/* Reconnecting banner */}
      {isReconnecting && (
        <div
          style={{
            backgroundColor: 'var(--color-warning)',
            color: '#000',
            padding: '6px 12px',
            fontSize: '0.8rem',
            textAlign: 'center',
            fontWeight: 600,
          }}
        >
          再接続中…
        </div>
      )}

      {/* Real-time Notification Banner */}
      {banner && (
        <div
          data-testid="notify-banner"
          style={{
            backgroundColor: banner.kind === 'money' ? 'var(--color-success)' : 'var(--color-ally)',
            color: '#000',
            padding: '12px 16px',
            fontSize: '0.9rem',
            fontWeight: 700,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
        >
          <div>
            <div>{banner.title}</div>
            <div style={{ fontSize: '0.8rem', fontWeight: 400 }}>{banner.body}</div>
          </div>
          <button
            onClick={() => setBanner(null)}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Content Area */}
      {activeTab === 'sheet' ? (
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Header Card: Name, Role, Funds */}
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <div>
              <h1
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '1.4rem',
                  color: 'var(--color-text)',
                  marginBottom: '2px',
                }}
              >
                {sheet.name}
              </h1>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                {sheet.role}
              </span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.25rem',
                  fontWeight: 700,
                  color: 'var(--color-warning)',
                }}
              >
                {sheet.eb.toLocaleString()} eb
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>資金</span>
            </div>
          </div>

          {/* HP & SP Section */}
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
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.85rem',
                  marginBottom: '4px',
                }}
              >
                <span>
                  <strong>HP</strong> {sheet.hp} / {sheet.hp_max}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  重傷: {seriouslyThreshold} 以下
                </span>
              </div>
              {/* HP Progress Bar */}
              <div
                style={{
                  height: '10px',
                  borderRadius: '5px',
                  backgroundColor: 'var(--color-bg)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${hpPercent}%`,
                    backgroundColor: hpBarColor,
                    transition: 'width 0.3s',
                  }}
                />
              </div>
              {sheet.woundState !== 'ok' && (
                <div
                  style={{
                    marginTop: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    color: hpBarColor,
                  }}
                >
                  負傷状態: {sheet.woundState === 'mortally' ? '瀕死 (ペナルティ -4)' : '重傷 (ペナルティ -2)'}
                </div>
              )}
            </div>

            {/* Armor SP (Head & Body) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px',
                paddingTop: '8px',
                borderTop: '1px solid var(--color-border)',
              }}
            >
              <div
                style={{
                  backgroundColor: 'var(--color-surface-elevated)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>頭部 SP</div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '1.25rem',
                    fontWeight: 700,
                    color: 'var(--color-ally)',
                  }}
                >
                  {sheet.sp_head}
                </div>
              </div>
              <div
                style={{
                  backgroundColor: 'var(--color-surface-elevated)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>胴体 SP</div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '1.25rem',
                    fontWeight: 700,
                    color: 'var(--color-ally)',
                  }}
                >
                  {sheet.sp_body}
                </div>
              </div>
            </div>
          </div>

          {/* Stats Grid (10 Stats) */}
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '16px',
            }}
          >
            <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '10px' }}>能力値</div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: '6px',
              }}
            >
              {[
                { label: 'INT', val: sheet.stats.int },
                { label: 'REF', val: sheet.stats.ref },
                { label: 'DEX', val: sheet.stats.dex },
                { label: 'TECH', val: sheet.stats.tech },
                { label: 'COOL', val: sheet.stats.cool },
                { label: 'WILL', val: sheet.stats.will },
                { label: 'LUCK', val: sheet.stats.luck },
                { label: 'MOVE', val: sheet.stats.move },
                { label: 'BODY', val: sheet.stats.body },
                { label: 'EMP', val: sheet.currentEmp },
              ].map((s) => (
                <div
                  key={s.label}
                  style={{
                    backgroundColor: 'var(--color-surface-elevated)',
                    borderRadius: '6px',
                    padding: '6px 4px',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>
                    {s.label}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '1.1rem',
                      fontWeight: 700,
                    }}
                  >
                    {s.val}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Cyberware & Humanity */}
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>サイバーウェア・人間性</span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.85rem',
                  color: 'var(--color-text-muted)',
                }}
              >
                人間性 {sheet.humanity} / {sheet.maxHumanity} · EMP {sheet.currentEmp}（元 {sheet.stats.emp}）
              </span>
            </div>
            {sheet.cyberware.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {sheet.cyberware.map((cw, i) => (
                  <span
                    key={i}
                    style={{
                      backgroundColor: 'var(--color-surface-elevated)',
                      border: '1px solid var(--color-border-light)',
                      borderRadius: '4px',
                      padding: '4px 8px',
                      fontSize: '0.75rem',
                    }}
                  >
                    {cw.name}
                  </span>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                装着なし
              </span>
            )}
          </div>

          {/* Inventory */}
          <div
            data-testid="player-inventory-card"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>所持品</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                {sheet.inventory.length} 件
              </span>
            </div>
            {sheet.inventory.length > 0 ? (
              <div
                data-testid="player-inventory-list"
                style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
              >
                {sheet.inventory.map((item: InventoryEntry, i: number) => (
                  <div
                    key={item.entry_id || i}
                    data-testid="player-inventory-item"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 10px',
                      borderRadius: '4px',
                      backgroundColor: 'var(--color-surface-elevated)',
                      fontSize: '0.85rem',
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>{item.name}</span>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.8rem',
                        color: 'var(--color-text-muted)',
                      }}
                    >
                      × {item.qty}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                所持品なし
              </span>
            )}
          </div>

          {/* Skills List */}
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '16px',
            }}
          >
            <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '8px' }}>
              技能（基本値 = 能力値 + 技能 − ペナルティ）
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {sheet.skillsList.map((sk) => (
                <div
                  key={sk.key}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 8px',
                    borderRadius: '4px',
                    backgroundColor: 'var(--color-surface-elevated)',
                    fontSize: '0.85rem',
                  }}
                >
                  <span>{formatSkillName(sk.name || sk.key)}</span>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      Lv.{sk.level}
                    </span>
                    <strong
                      style={{
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--color-ally)',
                        fontSize: '0.95rem',
                        minWidth: '24px',
                        textAlign: 'right',
                      }}
                    >
                      {sk.base}
                    </strong>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Weapons */}
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '16px',
            }}
          >
            <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '8px' }}>武器</div>
            {sheet.weapons.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {sheet.weapons.map((w, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '6px 8px',
                      borderRadius: '4px',
                      backgroundColor: 'var(--color-surface-elevated)',
                      fontSize: '0.85rem',
                    }}
                  >
                    {w}
                  </div>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>なし</span>
            )}
          </div>

          {/* Recent Event Logs */}
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '16px',
            }}
          >
            <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '8px' }}>
              出来事ログ
            </div>
            {logs.length > 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  maxHeight: '200px',
                  overflowY: 'auto',
                }}
              >
                {logs.map((l) => (
                  <div
                    key={l.id}
                    style={{
                      fontSize: '0.8rem',
                      padding: '4px 6px',
                      borderBottom: '1px solid var(--color-border)',
                      color: 'var(--color-text)',
                    }}
                  >
                    <span
                      style={{
                        color: 'var(--color-text-muted)',
                        fontSize: '0.7rem',
                        marginRight: '6px',
                      }}
                    >
                      {new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {l.text}
                  </div>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                まだログはありません
              </span>
            )}
          </div>
        </div>
      ) : (
        /* Action Tab (Phase 4 placeholder) */
        <div
          style={{
            padding: '32px 16px',
            textAlign: 'center',
            color: 'var(--color-text-muted)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div style={{ fontSize: '2rem' }}>⚔️</div>
          <h2 style={{ fontSize: '1.1rem', color: 'var(--color-text)' }}>行動（アクション）</h2>
          <p style={{ fontSize: '0.875rem', maxWidth: '300px' }}>
            戦闘やストーリーの場面で使えるようになります（Phase 4 で実装）。
          </p>
        </div>
      )}

      {/* Bottom Navigation Tabs */}
      <nav
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          maxWidth: '430px',
          margin: '0 auto',
          height: '56px',
          backgroundColor: 'var(--color-surface)',
          borderTop: '1px solid var(--color-border)',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          zIndex: 100,
        }}
      >
        <button
          onClick={() => setActiveTab('sheet')}
          style={{
            background: 'none',
            border: 'none',
            color: activeTab === 'sheet' ? 'var(--color-ally)' : 'var(--color-text-muted)',
            fontWeight: activeTab === 'sheet' ? 700 : 400,
            fontSize: '0.9rem',
            cursor: 'pointer',
            borderTop: activeTab === 'sheet' ? '2px solid var(--color-ally)' : 'none',
          }}
        >
          キャラシート
        </button>
        <button
          onClick={() => setActiveTab('act')}
          style={{
            background: 'none',
            border: 'none',
            color: activeTab === 'act' ? 'var(--color-ally)' : 'var(--color-text-muted)',
            fontWeight: activeTab === 'act' ? 700 : 400,
            fontSize: '0.9rem',
            cursor: 'pointer',
            borderTop: activeTab === 'act' ? '2px solid var(--color-ally)' : 'none',
          }}
        >
          行動
        </button>
      </nav>
    </div>
  );
};
