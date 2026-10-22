import { RoleInfoPanel } from '../components/RoleInfoPanel.js';
import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  CharacterSheet,
  CharLogEntry,
  WsNotifyPayload,
  formatSkillName,
  NetArchitecture,
  NetRunState,
  netActionsForRank,
  roleRank,
} from '@cyberpgm/shared';
import {
  api,
  getPlayerToken,
  setPlayerToken,
  removePlayerToken,
  getPlayerId,
  setPlayerId,
  JoinCharacter,
} from '../api.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { Footer } from '../components/Footer.js';
import { PlayerEquipmentView } from '../components/PlayerEquipmentView.js';
import { PlayerSkillsView } from '../components/PlayerSkillsView.js';
import { PlayerShopView } from '../components/PlayerShopView.js';
import { PlayerActionSkills } from '../components/PlayerActionSkills.js';
import { PlayerMoveMap, type PlayerMoveResult } from '../components/PlayerMoveMap.js';
import { useActionAvailability, blockedButtonStyle } from '../hooks/useActionAvailability.js';
import '../player-theme.css';

export const PlayerPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState<string | null>(getPlayerToken());

  // Join state
  const [joinCode, setJoinCode] = useState(searchParams.get('join') || '');
  const [availableChars, setAvailableChars] = useState<JoinCharacter[]>([]);
  // このスマホを使っている人（Phase 5i）。コードが通ったら「あなたは？」→ その人のキャラ
  const [playerId, setPlayerIdState] = useState<string | null>(getPlayerId());
  const [codeOk, setCodeOk] = useState(false);
  const [playerList, setPlayerList] = useState<Array<{ id: string; name: string }>>([]);
  const [newPlayerName, setNewPlayerName] = useState('');
  const choosePlayer = (id: string | null) => {
    setPlayerId(id);
    setPlayerIdState(id);
    autoClaimTried.current = false; // 人を選び直したら、その人のキャラをまた自動で選べる
  };
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [claimWaitMessage, setClaimWaitMessage] = useState('');

  // Character sheet state
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [logs, setLogs] = useState<CharLogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'sheet' | 'gear' | 'skills' | 'shop' | 'act' | 'handouts'>('sheet');
  // スマホの商店（Phase 5g）: 店の開け閉め・申請の結果が来たら読み直す
  const [shopRefreshKey, setShopRefreshKey] = useState(0);
  const [banner, setBanner] = useState<WsNotifyPayload | null>(null);

  // Phase 5b Story & Handouts state
  const [revealedData, setRevealedData] = useState<{
    clues: Array<{ id: string; title: string; body: string; image_path?: string | null }>;
    handouts: Array<{ id: string; title: string; body: string; image_path?: string | null }>;
  }>({ clues: [], handouts: [] });
  const [projectedDisplay, setProjectedDisplay] = useState<{ image_path: string | null } | null>(null);
  const [publishedStoryChoices, setPublishedStoryChoices] = useState<
    Array<{ id: string; label: string; skill_key?: string | null; dv?: number | null; who?: string }>
  >([]);
  const [generalStoryActions, setGeneralStoryActions] = useState<Array<{ key: string; label: string }>>([
    { key: 'investigate', label: '調べる' },
    { key: 'talk', label: '話す' },
    { key: 'negotiate', label: '交渉' },
    { key: 'threaten', label: '脅す' },
    { key: 'hide', label: '隠れる' },
  ]);
  const [freeTextInput, setFreeTextInput] = useState('');
  const [activeStoryCheck, setActiveStoryCheck] = useState<{
    check_id: string;
    skill_key: string | null;
    dv: number | null;
    formula?: string;
  } | null>(null);
  const [storyFirstRoll, setStoryFirstRoll] = useState<number | null>(null);
  const [storyExtraRoll, setStoryExtraRoll] = useState<number | null>(null);
  const [storyNeedsExtra, setStoryNeedsExtra] = useState(false);
  const [storyMissing, setStoryMissing] = useState<string | null>(null);
  const [storyResultNotification, setStoryResultNotification] = useState<{
    check_id: string;
    formula: string;
    rolls: number[];
    total: number;
    result: 'success' | 'failure' | 'draw';
  } | null>(null);
  const [actionSuccessBanner, setActionSuccessBanner] = useState<string | null>(null);

  // Combat state for player
  const [currentCombat, setCurrentCombat] = useState<any | null>(null);
  // 行動ごとの「今できるか・できない理由」（Phase 6a）。できない行動のボタンはグレーにし、押したら理由を出す
  const { reasons: actionReasons, blockedMessage } = useActionAvailability({
    enabled: Boolean(token && currentCombat?.status === 'active'),
    token,
    refreshKey: currentCombat,
  });
  const [actionBlockedMsg, setActionBlockedMsg] = useState<string | null>(null);
  /** clientReason: 画面で選んでいる武器などによる理由（サーバーに聞く前にわかるもの） */
  const actionBlocked = (key: string, clientReason: string | null) => Boolean(clientReason || actionReasons[key]);
  const guardAction = (key: string, label: string, clientReason: string | null): boolean => {
    const msg = clientReason ? `「${label}」はできません: ${clientReason}` : blockedMessage(key, label);
    setActionBlockedMsg(msg);
    return Boolean(msg);
  };
  // 「移動」「走る」を押したときのマップ（Phase 6a）
  const [moveMapAction, setMoveMapAction] = useState<'move' | 'run' | null>(null);
  const [moveResult, setMoveResult] = useState<PlayerMoveResult | null>(null);
  const [combatTurnInfo, setCombatTurnInfo] = useState<{
    combat_id: string;
    round: number;
    turn_index: number;
    actor_id: string;
    actor_name: string;
    is_my_turn: boolean;
  } | null>(null);
  const [combatResultNotification, setCombatResultNotification] = useState<{
    title: string;
    summary: string;
    changes: any[];
    is_victim?: boolean;
  } | null>(null);

  // Dice pad state
  const [showDicePad, setShowDicePad] = useState(false);
  const [padRollType, setPadRollType] = useState<'initiative' | 'attack' | 'defense' | 'death_save'>('attack');
  const [padFirstRoll, setPadFirstRoll] = useState<number | null>(null);
  const [padExtraRoll, setPadExtraRoll] = useState<number | null>(null);
  const [needsExtraRoll, setNeedsExtraRoll] = useState(false);
  // 使う【運命】点（Phase 5v）
  const [luckToSpend, setLuckToSpend] = useState(0);
  const luckLeft = sheet ? Math.max(0, (sheet.stats?.luck ?? 0) - Number((sheet as any).extra?.luck_used ?? 0)) : 0;
  const [chosenActionLabel, setChosenActionLabel] = useState<string>('');
  // 攻撃する相手と使う武器（Phase 5j）。攻撃のボタンと一緒に GM へ送る
  const [attackTargetId, setAttackTargetId] = useState<string | null>(null);
  const [attackWeaponId, setAttackWeaponId] = useState<string | null>(null);
  // 選んだ武器の成功ライン（射撃は距離帯ごと。仕様 §5.0.1。Phase 5n）
  const [myLines, setMyLines] = useState<Record<string, { text: string; bands?: Array<{ range: string; dv: number; needed: string }> } | null>>({});
  // ネットラン中の階層地図（難易度は出さない。Phase 5z）
  const [playerNetArch, setPlayerNetArch] = useState<NetArchitecture | null>(null);

  const myCombatPart = currentCombat?.participants?.find((p: any) => p.character_id === sheet?.id);
  const myNetState = (myCombatPart?.state as any)?.net as Partial<NetRunState> | undefined;
  const myRevealedKey = (myNetState?.revealed ?? []).join(',');

  useEffect(() => {
    if (!myNetState?.jacked_in || !myNetState.arch_id) {
      setPlayerNetArch(null);
      return;
    }
    const rev = myRevealedKey ? myRevealedKey.split(',').map(Number).filter(Boolean) : [];
    api
      .getNetArchitecture(myNetState.arch_id, true, rev)
      .then((res) => setPlayerNetArch(res.architecture))
      .catch(() => setPlayerNetArch(null));
  }, [myNetState?.jacked_in, myNetState?.arch_id, myRevealedKey]);

  useEffect(() => {
    if (!token || !currentCombat || currentCombat.status !== 'active' || !sheet) return;
    const me = (currentCombat.participants as Array<{ character_id: string | null; character?: any }>).find((p) => p.character_id === sheet.id);
    const list = ((me?.character?.inventory as Array<{ entry_id: string; kind?: string }>) ?? []).filter((i) => i.kind === 'weapon');
    const wid = (list.find((w) => w.entry_id === attackWeaponId) ?? list[0])?.entry_id;
    fetch(`/api/combats/current/my-lines${wid ? `?weapon_entry_id=${encodeURIComponent(wid)}` : ''}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((res) => setMyLines(res.lines ?? {}))
      .catch(() => undefined);
  }, [token, currentCombat?.id, currentCombat?.turn_index, currentCombat?.status, attackWeaponId, sheet?.id, sheet?.hp]);

  const bandsText = (key: string) => {
    const bands = myLines[key]?.bands;
    if (!bands || bands.length === 0) return null;
    return (
      <div data-testid={`bands-${key}`} style={{ fontSize: '0.65rem', color: 'var(--color-ally)', marginTop: '2px' }}>
        {bands
          .slice(0, 4)
          .map((b) => `〜${b.range.split('〜')[1]} ${b.needed.replace(' 以上で成功', '+').replace(/10 → 追加ロールで (\d+) 以上/, '10→$1+').replace('成功しない', '×')}`)
          .join(' / ')}
      </div>
    );
  };

  // WebSocket message handler
  const handleWsMessage = useCallback((type: string, payload: unknown) => {
    if (type === 'me:update') {
      setSheet(payload as CharacterSheet);
    } else if (type === 'player-shop:update' || type === 'purchase-request:update') {
      setShopRefreshKey((k) => k + 1);
    } else if (type === 'combat:move_result') {
      // スマホのマップで選んだ移動先の結果（Phase 6a）
      setMoveResult(payload as PlayerMoveResult);
    } else if (type === 'combat:changed') {
      // 戦闘の準備・HP・参加者の変化（Phase 5l）
      api.getCurrentCombat(token).then((res) => setCurrentCombat(res.combat)).catch(() => {});
    } else if (type === 'combat:turn') {
      const p = payload as any;
      setCombatTurnInfo(p);
      api.getCurrentCombat(token).then((res) => setCurrentCombat(res.combat)).catch(() => {});
    } else if (type === 'combat:result') {
      const p = payload as any;
      setCombatResultNotification(p);
      api.getCurrentCombat(token).then((res) => setCurrentCombat(res.combat)).catch(() => {});
      setTimeout(() => {
        setCombatResultNotification((prev) => (prev === p ? null : prev));
      }, 8000);
      if (p.summary) {
        setLogs((prev) => [
          {
            id: Date.now().toString(),
            character_id: sheet?.id || '',
            text: `${p.title}: ${p.summary}`,
            at: Date.now(),
          },
          ...prev,
        ]);
      }
    } else if (type === 'notify') {
      const p = payload as WsNotifyPayload;
      setBanner(p);
      setTimeout(() => {
        setBanner((prev) => (prev === p ? null : prev));
      }, 5000);
      setLogs((prev) => [
        {
          id: Date.now().toString(),
          character_id: sheet?.id || '',
          text: `${p.title} — ${p.body}`,
          at: Date.now(),
        },
        ...prev,
      ]);
    } else if (type === 'handouts:update') {
      setRevealedData(payload as any);
    } else if (type === 'display:update') {
      setProjectedDisplay(payload as any);
    } else if (type === 'story:choices') {
      const p = payload as any;
      // null は「公開中の選択肢を下げた」（シーンが変わった・進行を終えた）
      setPublishedStoryChoices(p?.choices ?? []);
      if (p?.generalActions) setGeneralStoryActions(p.generalActions);
    } else if (type === 'story:check_assigned') {
      setActiveStoryCheck(payload as any);
      setStoryFirstRoll(null);
      setStoryExtraRoll(null);
      setStoryNeedsExtra(false);
    } else if (type === 'story:result') {
      const res = payload as any;
      if (res?.result) {
        setStoryResultNotification(res);
        setActiveStoryCheck(null);
        setStoryMissing(null);
      } else {
        // まだ結果が出ない（追加の出目・GM の難易度待ち）。出目パッドを開いたままにする
        setStoryMissing((res?.missing_inputs ?? []).join(' / ') || 'GM の確認待ち');
      }
    }
  }, [sheet?.id, token]);

  const { isReconnecting, sendMessage } = useWebSocket({
    token,
    onMessage: handleWsMessage,
  });

  // Load initial sheet & combat if token exists
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

    api.getCurrentCombat(token)
      .then((res) => {
        setCurrentCombat(res.combat);
      })
      .catch(() => {});

    // 公開済みの手がかり・ハンドアウトを取り直す（再接続のとき）
    fetch('/api/scenario-sessions/current/revealed', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((rev) => {
        if (rev && !rev.error) setRevealedData(rev);
      })
      .catch(() => {});
  }, [token]);

  // コードが通ったら、人が決まっていればその人のキャラ、まだなら「あなたは？」の一覧を読む（Phase 5i）
  const loadForCode = useCallback(
    async (code: string) => {
      const list = (await api.getPlayers(code)).players;
      setPlayerList(list);
      // 覚えていた人が GM の PC にいない（消された・別のデータ）なら、選び直してもらう
      if (playerId && !list.some((p) => p.id === playerId)) {
        choosePlayer(null);
        setCodeOk(true);
        return;
      }
      if (playerId) {
        const res = await api.joinSession(code, playerId);
        setAvailableChars(res.characters);
      }
      setCodeOk(true);
    },
    [playerId],
  );

  const handleRegisterPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlayerName.trim()) return;
    setJoinError('');
    try {
      const res = await api.createPlayer(joinCode.trim(), newPlayerName.trim());
      setNewPlayerName('');
      choosePlayer(res.id);
    } catch (err: unknown) {
      setJoinError(err instanceof Error ? err.message : String(err));
    }
  };

  // Handle Join Code submit
  const handleFetchCharacters = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!joinCode.trim()) return;

    setIsJoining(true);
    setJoinError('');
    try {
      await loadForCode(joinCode.trim());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setJoinError(msg || '参加コードが無効です');
    } finally {
      setIsJoining(false);
    }
  };

  // If join code is provided in URL, automatically fetch available characters
  // （人を選び直したときも読み直す。Phase 5i）
  useEffect(() => {
    const urlCode = searchParams.get('join');
    if (urlCode && !token && !searchParams.get('pc')) {
      setJoinCode(urlCode);
      loadForCode(urlCode).catch(() => {});
    } else if (codeOk && !token && joinCode) {
      loadForCode(joinCode).catch(() => {});
    }
  }, [searchParams, token, loadForCode]);

  // 自分のキャラで、いま選べるのが 1 人だけなら自動で選ぶ（Phase 5i）
  const autoClaimTried = React.useRef(false);
  useEffect(() => {
    if (token || !playerId || autoClaimTried.current || searchParams.get('pc')) return;
    const mine = availableChars.filter((ch) => ch.player_id === playerId && !ch.locked);
    if (mine.length !== 1) return;
    autoClaimTried.current = true;
    handleClaim(mine[0].id);
  }, [availableChars, playerId, token]);

  // キャラごとの再開 QR（?join=<コード>&pc=<キャラ ID>）: キャラ選びを飛ばしてそのキャラで参加する（Phase 5d）
  const resumeTried = React.useRef(false);
  useEffect(() => {
    const urlCode = searchParams.get('join');
    const pcId = searchParams.get('pc');
    if (!urlCode || !pcId || resumeTried.current) return;
    if (token && sheet?.id === pcId) return;
    resumeTried.current = true;
    setJoinCode(urlCode);
    setClaimWaitMessage('参加をリクエスト中…（別端末が参加中の場合はGMの承認待ち）');
    api
      .claimCharacter(urlCode, pcId, playerId)
      .then((res) => {
        if (res.player_id) choosePlayer(res.player_id);
        setPlayerToken(res.token);
        setToken(res.token);
        setClaimWaitMessage('');
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setClaimWaitMessage('');
        setJoinError(`この QR のキャラでは参加できませんでした（${msg}）。下の一覧からキャラを選んでください。`);
        loadForCode(urlCode).catch(() => {});
      });
  }, [searchParams, token, sheet?.id]);

  // Handle Character Claim
  const handleClaim = async (charId: string) => {
    setJoinError('');
    setClaimWaitMessage('参加をリクエスト中…（別端末が参加中の場合はGMの承認待ち）');
    try {
      const res = await api.claimCharacter(joinCode.trim(), charId, playerId);
      if (res.player_id) choosePlayer(res.player_id);
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
        className="cp-player"
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
            className="cp-title"
            data-text="CYBERPUNK RED"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.9rem',
              letterSpacing: '3px',
              marginBottom: '6px',
            }}
          >
            CYBERPUNK RED
          </h1>
          <p style={{ color: 'var(--color-ally)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.2em' }}>
            {'// NIGHT CITY NET LINK'}
          </p>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: '4px' }}>
            セッション参加 · キャラクター選択
          </p>
        </div>

        {!codeOk ? (
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
        ) : !playerId ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p style={{ fontSize: '0.95rem', fontWeight: 600 }}>あなたは？（プレイヤーのハンドルネーム）</p>
            {playerList.map((p) => (
              <button
                key={p.id}
                onClick={() => choosePlayer(p.id)}
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  padding: '14px 16px',
                  textAlign: 'left',
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                }}
              >
                {p.name}
              </button>
            ))}
            <form
              onSubmit={handleRegisterPlayer}
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <label style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                {playerList.length > 0
                  ? 'はじめての人はハンドルネームを登録（キャラ名とは別）'
                  : 'ハンドルネームを登録（キャラ名とは別。次からはこの名前を選ぶだけ）'}
              </label>
              <input
                type="text"
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                placeholder="例: たろう"
                maxLength={40}
                style={{
                  backgroundColor: 'var(--color-bg)',
                  border: '1px solid var(--color-border-light)',
                  borderRadius: '6px',
                  padding: '10px',
                  fontSize: '1rem',
                  color: 'var(--color-text)',
                }}
              />
              <button
                type="submit"
                disabled={!newPlayerName.trim()}
                style={{
                  backgroundColor: 'var(--color-ally)',
                  color: '#000',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '10px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                登録する
              </button>
            </form>
            {joinError && <p style={{ color: 'var(--color-accent)', fontSize: '0.85rem' }}>{joinError}</p>}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                コード: <strong style={{ color: 'var(--color-text)' }}>{joinCode}</strong>
              </span>
              <button
                onClick={() => {
                  setAvailableChars([]);
                  choosePlayer(null);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-ally)',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                別の人に切り替える
              </button>
              <button
                onClick={() => {
                  setAvailableChars([]);
                  setCodeOk(false);
                }}
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

            <p style={{ fontSize: '0.95rem', fontWeight: 600 }}>
              {playerList.find((p) => p.id === playerId)?.name ?? ''}
              {playerList.find((p) => p.id === playerId) ? ' さんの' : '自分の'}キャラクターを選択:
            </p>
            {availableChars.length === 0 && (
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                まだキャラがいません。下の「＋ 新しくキャラを作る」から作ってください。
              </p>
            )}

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
                  disabled={char.locked}
                  style={{
                    opacity: char.locked ? 0.5 : 1,
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
                      {char.player_id === null && ' · 持ち主なし（選ぶとあなたのキャラになります）'}
                      {char.scenario_title && !char.locked && ` · 「${char.scenario_title}」の途中`}
                    </div>
                    {char.lock_reason && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--color-warning)', marginTop: '2px' }}>
                        {char.lock_reason}
                      </div>
                    )}
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

  // 出目パッド。戦闘準備中（イニシアチブ）と戦闘中の両方で出す
  const dicePad = showDicePad ? (
                <div
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    marginTop: '8px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                      出目パッド: {chosenActionLabel || padRollType}
                    </div>
                    <button
                      onClick={() => setShowDicePad(false)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--color-text-muted)',
                        fontSize: '1.1rem',
                        cursor: 'pointer',
                      }}
                    >
                      ×
                    </button>
                  </div>

                  {/* Selected Roll Display */}
                  <div
                    style={{
                      padding: '10px',
                      backgroundColor: 'var(--color-bg)',
                      borderRadius: '6px',
                      textAlign: 'center',
                      fontSize: '1.2rem',
                      fontWeight: 800,
                    }}
                  >
                    {padFirstRoll !== null ? (
                      <span>
                        出目: {padFirstRoll}
                        {needsExtraRoll && (
                          <span style={{ color: 'var(--color-warning)', marginLeft: '8px' }}>
                            {padExtraRoll !== null ? `+ 追加出目 ${padExtraRoll}` : '(追加出目をタップ)'}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                        数字をタップして出目を決定
                      </span>
                    )}
                  </div>

                  {/* 10-Key Pad (1 - 10) */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(5, 1fr)',
                      gap: '8px',
                    }}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
                      const isSelected = (!needsExtraRoll && padFirstRoll === num) || (needsExtraRoll && padExtraRoll === num);
                      return (
                        <button
                          key={num}
                          onClick={() => {
                            if (!needsExtraRoll) {
                              setPadFirstRoll(num);
                              // 死亡セーブは振り足さない（10 は必ず失敗）
                              if ((num === 10 || num === 1) && padRollType !== 'death_save') {
                                setNeedsExtraRoll(true);
                              } else {
                                setNeedsExtraRoll(false);
                                setPadExtraRoll(null);
                              }
                            } else {
                              setPadExtraRoll(num);
                            }
                          }}
                          style={{
                            height: '52px',
                            backgroundColor: isSelected ? 'var(--color-ally)' : 'var(--color-surface-elevated)',
                            color: isSelected ? '#000' : 'var(--color-text)',
                            border: '1px solid var(--color-border-light)',
                            borderRadius: '6px',
                            fontSize: '1.2rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          {num}
                        </button>
                      );
                    })}
                  </div>

                  {/* 【運命】点（振る前に使う。1 点につき +1。日本語版 p.130。Phase 5v） */}
                  {luckLeft > 0 && (
                    <div data-testid="luck-picker" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
                      <span>【運命】点（残り {luckLeft}）:</span>
                      <button type="button" onClick={() => setLuckToSpend((n) => Math.max(0, n - 1))} style={{ width: '32px', height: '32px' }}>−</button>
                      <strong>{luckToSpend}</strong>
                      <button type="button" onClick={() => setLuckToSpend((n) => Math.min(luckLeft, n + 1))} style={{ width: '32px', height: '32px' }}>＋</button>
                      <span style={{ color: 'var(--color-text-muted)' }}>使うと +{luckToSpend}</span>
                    </div>
                  )}

                  {/* Submit Roll Button */}
                  <button
                    onClick={() => {
                      if (padFirstRoll === null) return;
                      sendMessage({
                        type: 'combat:roll',
                        payload: {
                          roll_type: padRollType,
                          first: padFirstRoll,
                          extra: padExtraRoll ?? undefined,
                          ...(padRollType === 'attack' && luckToSpend > 0 ? { luck_spent: luckToSpend } : {}),
                        },
                      });
                      setLuckToSpend(0);
                      setShowDicePad(false);
                      setPadFirstRoll(null);
                      setPadExtraRoll(null);
                      setNeedsExtraRoll(false);
                    }}
                    disabled={padFirstRoll === null || (needsExtraRoll && padExtraRoll === null)}
                    style={{
                      padding: '12px',
                      backgroundColor: 'var(--color-ally)',
                      color: '#000',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: 800,
                      fontSize: '1rem',
                      cursor: padFirstRoll !== null ? 'pointer' : 'not-allowed',
                      opacity: padFirstRoll !== null ? 1 : 0.5,
                      marginTop: '6px',
                    }}
                  >
                    GM に出目を送信
                  </button>
                </div>
  ) : null;

  const netrunnerRank =
    roleRank(sheet.role, (sheet as any).extra, 'Netrunner') ||
    Number((sheet as any).extra?.role_ranks?.Netrunner ?? sheet.skills?.interface ?? 0);

  const playerNetrunPanel =
    myNetState?.jacked_in || netrunnerRank > 0 ? (
      <div
        data-testid="player-netrun-panel"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-ally)',
          borderRadius: '8px',
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          fontSize: '0.82rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
          <strong style={{ color: 'var(--color-ally)' }}>
            {myNetState?.jacked_in ? `NET ジャックイン中 (第 ${myNetState.depth ?? 1} 階層)` : 'NET 未接続（ネットランナー）'}
          </strong>
          <span data-testid="player-netrun-remaining" style={{ fontWeight: 700 }}>
            NET アクション残り:{' '}
            {Math.max(0, netActionsForRank(netrunnerRank || 4, Boolean(myNetState?.slowed)) - Number(myNetState?.net_used ?? 0))} /{' '}
            {netActionsForRank(netrunnerRank || 4, Boolean(myNetState?.slowed))} 回
          </span>
        </div>
        <div data-testid="player-netrun-rezzed">
          <span style={{ color: 'var(--color-text-muted)' }}>起動中プログラム: </span>
          {(myNetState?.rezzed ?? []).length > 0
            ? (myNetState?.rezzed ?? []).map((r, i) => (
                <span key={`${r.key}-${i}`} style={{ marginRight: '8px', fontWeight: 600 }}>
                  {r.name} (REZ {r.rez}/{r.rez_max})
                </span>
              ))
            : 'なし'}
        </div>
        {playerNetArch && (
          <div data-testid="player-netrun-map" style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
            <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>見えている階層の地図:</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {playerNetArch.floors.map((fl) => {
                const isCur = Boolean(myNetState?.jacked_in && myNetState.depth === fl.floor);
                return (
                  <span
                    key={fl.floor}
                    data-testid={`player-floor-${fl.floor}`}
                    style={{
                      padding: '2px 7px',
                      borderRadius: '4px',
                      border: isCur ? '1px solid var(--color-ally)' : '1px solid var(--color-border-light)',
                      backgroundColor: isCur ? 'rgba(0, 240, 255, 0.14)' : 'var(--color-surface-elevated)',
                    }}
                  >
                    <strong>F{fl.floor}:</strong> {fl.label}
                    {isCur && <span style={{ marginLeft: '4px', color: 'var(--color-ally)', fontWeight: 700 }}>←現在</span>}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    ) : null;

  return (
    <div
      className="cp-player"
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
      {/* 上の帯: 接続状態とハンドルネーム（Phase 5j） */}
      <div className="cp-statusbar" data-testid="cp-statusbar">
        <span>
          <span className={`cp-dot${isReconnecting ? ' is-off' : ''}`} />
          {isReconnecting ? 'RECONNECTING' : 'NET LINK ONLINE'}
        </span>
        <span>
          {playerList.find((p) => p.id === sheet.player_id)?.name ?? 'RUNNER'}
          {' // '}
          {sheet.name}
        </span>
      </div>

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
              color: '#000',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Combat Result / Damage Notification */}
      {combatResultNotification && (
        <div
          data-testid="combat-result-banner"
          style={{
            backgroundColor: combatResultNotification.is_victim ? 'rgba(235, 75, 75, 0.95)' : 'rgba(79, 182, 227, 0.95)',
            color: '#fff',
            padding: '12px 16px',
            fontSize: '0.9rem',
            fontWeight: 700,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            borderBottom: combatResultNotification.is_victim ? '2px solid #ff0000' : '2px solid var(--color-ally)',
          }}
        >
          <div>
            <div style={{ fontSize: '0.95rem' }}>{combatResultNotification.title}</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 500, marginTop: '2px' }}>
              {combatResultNotification.summary}
            </div>
            {combatResultNotification.changes && combatResultNotification.changes.length > 0 && (
              <div style={{ fontSize: '0.8rem', fontWeight: 400, opacity: 0.9, marginTop: '4px' }}>
                {combatResultNotification.changes.map((c: any) => c.desc).join(' / ')}
              </div>
            )}
          </div>
          <button
            onClick={() => setCombatResultNotification(null)}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.2rem',
              color: '#fff',
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Main Content Area */}
      {activeTab === 'handouts' ? (
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: 'var(--color-ally)' }}>
            公開資料・手掛かり
          </h2>

          {/* Clues */}
          {revealedData.clues.map((cl) => (
            <div
              key={cl.id}
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    fontSize: '0.7rem',
                    padding: '2px 6px',
                    borderRadius: '3px',
                    backgroundColor: 'rgba(79, 182, 227, 0.2)',
                    color: 'var(--color-ally)',
                    fontWeight: 700,
                  }}
                >
                  手掛かり
                </span>
                <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{cl.title}</span>
              </div>
              {cl.image_path && (
                <img
                  src={cl.image_path}
                  alt={cl.title}
                  style={{
                    width: '100%',
                    maxHeight: '180px',
                    objectFit: 'contain',
                    borderRadius: '4px',
                    backgroundColor: '#000',
                  }}
                />
              )}
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {cl.body}
              </p>
            </div>
          ))}

          {/* Handouts */}
          {revealedData.handouts.map((h) => (
            <div
              key={h.id}
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    fontSize: '0.7rem',
                    padding: '2px 6px',
                    borderRadius: '3px',
                    backgroundColor: 'rgba(235, 179, 58, 0.2)',
                    color: 'var(--color-warning)',
                    fontWeight: 700,
                  }}
                >
                  ハンドアウト
                </span>
                <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{h.title}</span>
              </div>
              {h.image_path && (
                <img
                  src={h.image_path}
                  alt={h.title}
                  style={{
                    width: '100%',
                    maxHeight: '180px',
                    objectFit: 'contain',
                    borderRadius: '4px',
                    backgroundColor: '#000',
                  }}
                />
              )}
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {h.body}
              </p>
            </div>
          ))}

          {revealedData.clues.length === 0 && revealedData.handouts.length === 0 && (
            <div
              style={{
                padding: '32px 16px',
                textAlign: 'center',
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                color: 'var(--color-text-muted)',
              }}
            >
              <p style={{ margin: 0, fontSize: '0.9rem' }}>まだ公開された資料はありません</p>
            </div>
          )}
        </div>
      ) : activeTab === 'gear' ? (
        <PlayerEquipmentView sheet={sheet} />
      ) : activeTab === 'skills' ? (
        <PlayerSkillsView sheet={sheet} />
      ) : activeTab === 'shop' ? (
        <PlayerShopView eb={sheet.eb} refreshKey={shopRefreshKey} />
      ) : activeTab === 'sheet' ? (
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Header Card: Name, Role, Funds */}
          <div
            className="cp-id-card"
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
                {/* 持ち主のハンドルネーム。人違いに気づけるように（Phase 5j） */}
                {playerList.find((p) => p.id === sheet.player_id) && ` ・ プレイヤー: ${playerList.find((p) => p.id === sheet.player_id)!.name}`}
              </span>
              {/* ほかの持ちキャラに替える（Phase 5i） */}
              <button
                onClick={() => {
                  if (!confirm('キャラを選び直しますか？')) return;
                  removePlayerToken();
                  setToken(null);
                  setSheet(null);
                  autoClaimTried.current = true; // 選び直すときは自動で選ばない
                  if (joinCode) loadForCode(joinCode).catch(() => {});
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-ally)',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  marginLeft: '8px',
                  padding: 0,
                }}
              >
                キャラを変える
              </button>
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

          {/* 【運命】点の残り（Phase 5v。セッションの始めに全部戻る） */}
          <div data-testid="luck-left" style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            【運命】点: 残り <strong style={{ color: 'var(--color-text)' }}>{luckLeft}</strong> / {sheet.stats.luck}（判定の前に使うと 1 点につき +1。セッションの始めに戻る）
          </div>

          {/* ドラッグ・依存症の効果とサイバーサイコシス（Phase 5w。p.227〜232） */}
          {((sheet.effectNotes ?? []).length > 0 || (sheet.psychosis?.level ?? 0) > 0) && (
            <div data-testid="effects" style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {(sheet.effectNotes ?? []).map((n) => (
                <span key={n} style={{ color: 'var(--color-warning)' }}>{n}</span>
              ))}
              {(sheet.psychosis?.level ?? 0) > 0 && <span style={{ color: 'var(--color-danger)' }}>サイバーサイコシス: {sheet.psychosis!.label}</span>}
            </div>
          )}

          {/* ロールの概要とロール特技のランクごとの効果（Phase 5s） */}
          <div style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '12px 16px' }}>
            <RoleInfoPanel role={sheet.role} />
          </div>

          {playerNetrunPanel}

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
                className="cp-hp-track"
                style={{
                  height: '10px',
                  borderRadius: '5px',
                  backgroundColor: 'var(--color-bg)',
                  overflow: 'hidden',
                }}
              >
                <div
                  className="cp-hp-fill"
                  style={{
                    color: hpBarColor,
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

          {/* 致命傷（効果の説明つき。Phase 5n） */}
          {(sheet.crit_injuries as Array<{ name?: string; summary?: string }>).length > 0 && (
            <div
              data-testid="player-crit-injuries"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-accent)',
                borderRadius: '8px',
                padding: '12px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-accent)' }}>致命傷</div>
              {(sheet.crit_injuries as Array<{ name?: string; summary?: string }>).map((ci, i) => (
                <div key={i} style={{ fontSize: '0.8rem' }}>
                  <strong>{ci.name ?? '致命傷'}</strong>
                  {ci.summary && <div style={{ color: 'var(--color-text-muted)', marginTop: '2px' }}>{ci.summary}</div>}
                </div>
              ))}
            </div>
          )}

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
        /* Action Tab (Phase 4a) */
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {!currentCombat || currentCombat.status === 'ended' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* GM Projection Banner */}
              {projectedDisplay?.image_path && (
                <div
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-ally)',
                    borderRadius: '8px',
                    padding: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-ally)', fontWeight: 700 }}>
                    【GM からの表示】
                  </div>
                  <img
                    src={projectedDisplay.image_path}
                    alt="GM Projection"
                    style={{
                      width: '100%',
                      maxHeight: '220px',
                      objectFit: 'contain',
                      borderRadius: '4px',
                      backgroundColor: '#000',
                    }}
                  />
                </div>
              )}

              {/* Action Chosen Feedback Banner */}
              {actionSuccessBanner && (
                <div
                  style={{
                    padding: '10px 12px',
                    backgroundColor: 'rgba(46, 204, 113, 0.2)',
                    border: '1px solid var(--color-success)',
                    borderRadius: '6px',
                    color: 'var(--color-success)',
                    fontSize: '0.85rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>{actionSuccessBanner}</span>
                  <button
                    type="button"
                    onClick={() => setActionSuccessBanner(null)}
                    style={{ background: 'none', border: 'none', color: 'var(--color-success)', cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Check Prompt & Dice Pad */}
              {activeStoryCheck && (
                <div
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '2px solid var(--color-warning)',
                    borderRadius: '8px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-warning)' }}>
                      判定のダイス入力
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                      1d10
                    </span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text)', lineHeight: 1.5 }}>
                    {activeStoryCheck.formula || `判定 vs 難易度 ${activeStoryCheck.dv ?? '—'}`}
                  </div>
                  {storyMissing && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-warning)' }}>{storyMissing}</div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                      {storyFirstRoll === null
                        ? '1d10 の出目をタップしてください:'
                        : storyNeedsExtra
                        ? `1個目: ${storyFirstRoll} (${storyFirstRoll === 10 ? 'クリティカル！追加ダイス' : 'ファンブル！追加ダイス'})`
                        : `選択した出目: ${storyFirstRoll}`}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
                        const isSelected = (!storyNeedsExtra && storyFirstRoll === num) || (storyNeedsExtra && storyExtraRoll === num);
                        return (
                          <button
                            key={num}
                            type="button"
                            onClick={() => {
                              if (storyFirstRoll === null) {
                                setStoryFirstRoll(num);
                                if (num === 10 || num === 1) {
                                  setStoryNeedsExtra(true);
                                }
                              } else if (storyNeedsExtra) {
                                setStoryExtraRoll(num);
                              } else {
                                setStoryFirstRoll(num);
                                if (num === 10 || num === 1) {
                                  setStoryNeedsExtra(true);
                                  setStoryExtraRoll(null);
                                } else {
                                  setStoryNeedsExtra(false);
                                  setStoryExtraRoll(null);
                                }
                              }
                            }}
                            style={{
                              padding: '12px 0',
                              backgroundColor: isSelected ? 'var(--color-warning)' : 'var(--color-surface-elevated)',
                              color: isSelected ? '#000' : 'var(--color-text)',
                              border: '1px solid var(--color-border-light)',
                              borderRadius: '6px',
                              fontSize: '1.1rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              textAlign: 'center',
                            }}
                          >
                            {num}
                          </button>
                        );
                      })}
                    </div>

                    {/* 【運命】点（振る前に使う。1 点につき +1。日本語版 p.130。Phase 5v） */}
                    {luckLeft > 0 && (
                      <div data-testid="luck-picker" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
                        <span>【運命】点（残り {luckLeft}）:</span>
                        <button type="button" onClick={() => setLuckToSpend((n) => Math.max(0, n - 1))} style={{ width: '32px', height: '32px' }}>−</button>
                        <strong>{luckToSpend}</strong>
                        <button type="button" onClick={() => setLuckToSpend((n) => Math.min(luckLeft, n + 1))} style={{ width: '32px', height: '32px' }}>＋</button>
                        <span style={{ color: 'var(--color-text-muted)' }}>使うと +{luckToSpend}</span>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        if (storyFirstRoll === null) return;
                        const rolls = [storyFirstRoll];
                        if (storyNeedsExtra && storyExtraRoll !== null) {
                          rolls.push(storyExtraRoll);
                        }
                        sendMessage({
                          type: 'story:roll',
                          payload: {
                            check_id: activeStoryCheck.check_id,
                            rolls,
                            ...(luckToSpend > 0 ? { luck_spent: luckToSpend } : {}),
                          },
                        });
                        setLuckToSpend(0);
                      }}
                      disabled={storyFirstRoll === null || (storyNeedsExtra && storyExtraRoll === null)}
                      style={{
                        padding: '12px',
                        backgroundColor: 'var(--color-ally)',
                        color: '#000',
                        border: 'none',
                        borderRadius: '6px',
                        fontWeight: 800,
                        fontSize: '0.95rem',
                        cursor: storyFirstRoll !== null ? 'pointer' : 'not-allowed',
                        opacity: storyFirstRoll !== null ? 1 : 0.5,
                        marginTop: '6px',
                      }}
                    >
                      GM に出目を送信
                    </button>
                  </div>
                </div>
              )}

              {/* Story Result Notification */}
              {storyResultNotification && (
                <div
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: `2px solid ${storyResultNotification.result === 'success' ? 'var(--color-success)' : 'var(--color-accent)'}`,
                    borderRadius: '8px',
                    padding: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span
                      style={{
                        fontWeight: 800,
                        fontSize: '1rem',
                        color: storyResultNotification.result === 'success' ? 'var(--color-success)' : 'var(--color-accent)',
                      }}
                    >
                      {storyResultNotification.result === 'success' ? '判定成功' : '判定失敗'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setStoryResultNotification(null)}
                      style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}
                    >
                      ✕
                    </button>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                    {storyResultNotification.formula}
                  </div>
                </div>
              )}

              {/* Published Choices */}
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
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-ally)' }}>
                  公開された選択肢
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {publishedStoryChoices
                    .filter((ch) => !ch.who || ch.who === '全員' || ch.who === sheet.name || ch.who === sheet.role)
                    .map((ch) => (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() => {
                          sendMessage({
                            type: 'story:choose',
                            payload: {
                              choice_id: ch.id,
                              action_label: ch.label,
                            },
                          });
                          setActionSuccessBanner(`「${ch.label}」を選択しました`);
                        }}
                        style={{
                          padding: '12px 14px',
                          backgroundColor: 'var(--color-surface-elevated)',
                          border: '1px solid var(--color-border-light)',
                          borderRadius: '6px',
                          color: 'var(--color-text)',
                          textAlign: 'left',
                          cursor: 'pointer',
                          fontSize: '0.9rem',
                          fontWeight: 600,
                        }}
                      >
                        {ch.label}
                      </button>
                    ))}
                  {publishedStoryChoices.length === 0 && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                      公開されているシナリオ選択肢はありません
                    </span>
                  )}
                </div>
              </div>

              {/* General Actions */}
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
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text)' }}>
                  汎用行動
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {generalStoryActions.map((act) => (
                    <button
                      key={act.key}
                      type="button"
                      onClick={() => {
                        sendMessage({
                          type: 'story:choose',
                          payload: {
                            action_type: 'general',
                            action_label: act.label,
                          },
                        });
                        setActionSuccessBanner(`「${act.label}」を選択しました`);
                      }}
                      style={{
                        padding: '10px 8px',
                        backgroundColor: 'var(--color-surface-elevated)',
                        border: '1px solid var(--color-border-light)',
                        borderRadius: '6px',
                        color: 'var(--color-text)',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        textAlign: 'center',
                      }}
                    >
                      {act.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Free Text Action */}
              <div
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text)' }}>
                  自由行動
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="例: 周囲の配線を調べる"
                    value={freeTextInput}
                    onChange={(e) => setFreeTextInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && freeTextInput.trim()) {
                        sendMessage({
                          type: 'story:choose',
                          payload: {
                            action_type: 'free',
                            free_text: freeTextInput.trim(),
                          },
                        });
                        setActionSuccessBanner(`「${freeTextInput.trim()}」を試みます`);
                        setFreeTextInput('');
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: '10px 12px',
                      backgroundColor: 'var(--color-bg)',
                      border: '1px solid var(--color-border-light)',
                      borderRadius: '6px',
                      color: 'var(--color-text)',
                      fontSize: '0.85rem',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!freeTextInput.trim()) return;
                      sendMessage({
                        type: 'story:choose',
                        payload: {
                          action_type: 'free',
                          free_text: freeTextInput.trim(),
                        },
                      });
                      setActionSuccessBanner(`「${freeTextInput.trim()}」を試みます`);
                      setFreeTextInput('');
                    }}
                    disabled={!freeTextInput.trim()}
                    style={{
                      padding: '10px 16px',
                      backgroundColor: 'var(--color-ally)',
                      border: 'none',
                      borderRadius: '6px',
                      color: '#000',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: freeTextInput.trim() ? 'pointer' : 'not-allowed',
                      opacity: freeTextInput.trim() ? 1 : 0.5,
                    }}
                  >
                    送信
                  </button>
                </div>
              </div>
            </div>
          ) : currentCombat.status === 'setup' ? (
            <div
              style={{
                padding: '20px',
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                textAlign: 'center',
              }}
            >
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>戦闘準備中（参加者チェック）</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: 0 }}>
                イニシアチブ（行動順）の出目（1d10）を入力してGMに送信してください。
              </p>
              <button
                onClick={() => {
                  setPadRollType('initiative');
                  setShowDicePad(true);
                  setPadFirstRoll(null);
                  setPadExtraRoll(null);
                  setNeedsExtraRoll(false);
                }}
                style={{
                  backgroundColor: 'var(--color-ally)',
                  color: '#000',
                  border: 'none',
                  padding: '12px',
                  borderRadius: '6px',
                  fontWeight: 800,
                  fontSize: '1rem',
                  cursor: 'pointer',
                  marginTop: '8px',
                }}
              >
                イニシアチブの出目を入力
              </button>
              {dicePad}
            </div>
          ) : (
            /* Active Combat Action Interface */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Turn Status Banner */}
              {(() => {
                const activePart = currentCombat.participants[currentCombat.turn_index];
                const isMyTurn = Boolean(
                  combatTurnInfo?.is_my_turn ?? (activePart && activePart.character_id === sheet.id),
                );
                const turnName = combatTurnInfo?.actor_name || activePart?.name || '—';

                return (
                  <div
                    style={{
                      padding: '14px',
                      borderRadius: '8px',
                      backgroundColor: isMyTurn ? 'rgba(79, 182, 227, 0.15)' : 'var(--color-surface)',
                      border: isMyTurn ? '2px solid var(--color-ally)' : '1px solid var(--color-border)',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                      ラウンド {currentCombat.round}
                    </div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, marginTop: '2px', color: isMyTurn ? 'var(--color-ally)' : 'var(--color-text)' }}>
                      {isMyTurn ? `あなた（${sheet.name}）の手番です` : `${turnName} の手番です`}
                    </div>
                  </div>
                );
              })()}

              {playerNetrunPanel}

              {/* Action Buttons (Only clickable if my turn) */}
              {(() => {
                const activePart = currentCombat.participants[currentCombat.turn_index];
                const isMyTurn = Boolean(
                  combatTurnInfo?.is_my_turn ?? (activePart && activePart.character_id === sheet.id),
                );

                // 重い防具のペナルティを引いた REF・DEX（Phase 5m）
                const refVal = sheet.stats.ref - (sheet.armor_penalty ?? 0);
                const dexVal = sheet.stats.dex - (sheet.armor_penalty ?? 0);
                // 技能はキー（'handgun' など）で持っている。基準値は選んだ武器の技能で出す（Phase 5k）
                const sk = (key: string) => sheet.skills[key] ?? 0;
                const woundPen = sheet.woundPenalty;

                // 攻撃する相手（倒れていないほかの参加者。敵が先）と、自分の武器（Phase 5j）
                type Part = { id: string; name: string; side: string; out: boolean; active: boolean; character_id: string | null; character?: any };
                const parts = currentCombat.participants as Part[];
                const me = parts.find((p) => p.character_id === sheet.id);
                const targets = parts
                  .filter((p) => p.id !== me?.id && !p.out && p.active)
                  .sort((a, b) => (a.side === b.side ? 0 : a.side === 'enemy' ? -1 : 1));
                type WeaponEntry = {
                  entry_id: string;
                  name: string;
                  kind?: string;
                  ammo?: number | null;
                  skill_key?: string;
                  is_ranged?: boolean;
                  autofire?: number | null;
                };
                const myWeapons = ((me?.character?.inventory as WeaponEntry[]) ?? []).filter((i) => i.kind === 'weapon');
                // 選んでいなければ最初の武器を使う
                const weapon = myWeapons.find((w) => w.entry_id === attackWeaponId) ?? myWeapons[0];
                const weaponId = weapon?.entry_id;
                const rangedWeapon = weapon && weapon.is_ranged !== false ? weapon : undefined;
                const meleeWeapon = weapon && weapon.is_ranged === false ? weapon : undefined;
                const rangedSkillKey = rangedWeapon?.skill_key || 'handgun';
                const attackBaseRanged = refVal + sk(rangedSkillKey) + woundPen;
                const canAutofire = Boolean(rangedWeapon?.autofire);
                const attackBaseAutofire = refVal + sk('autofire') + woundPen;
                // 近接武器がなければ素手（格闘）
                const meleeSkillKey = meleeWeapon?.skill_key || 'brawling';
                const attackBaseMelee = dexVal + sk(meleeSkillKey) + woundPen;
                const chip = (selected: boolean, color: string): React.CSSProperties => ({
                  padding: '8px 12px',
                  borderRadius: '4px',
                  border: `1px solid ${selected ? color : 'var(--color-border-light)'}`,
                  backgroundColor: selected ? color : 'var(--color-surface)',
                  color: selected ? '#000' : 'var(--color-text)',
                  fontWeight: selected ? 800 : 500,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                });
                const dodgeBase = dexVal + sk('evasion') + woundPen;

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>
                      {isMyTurn ? '行動を選択:' : '手番外の行動:'}
                    </div>

                    {isMyTurn && (
                      <div data-testid="attack-picker" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>攻撃する相手:</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {targets.length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>相手がいません</span>}
                          {targets.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              data-testid="attack-target"
                              onClick={() => setAttackTargetId(t.id === attackTargetId ? null : t.id)}
                              style={chip(t.id === attackTargetId, t.side === 'enemy' ? 'var(--color-enemy)' : 'var(--color-ally)')}
                            >
                              {t.name}
                            </button>
                          ))}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>使う武器:</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {myWeapons.length === 0 && (
                            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>武器を持っていません（素手なら「格闘（素手）」）</span>
                          )}
                          {myWeapons.map((w) => (
                            <button
                              key={w.entry_id}
                              type="button"
                              data-testid="attack-weapon"
                              onClick={() => setAttackWeaponId(w.entry_id)}
                              style={chip(w.entry_id === weaponId, 'var(--color-ally)')}
                            >
                              {w.name}
                              {typeof w.ammo === 'number' && ` (残弾 ${w.ammo})`}
                            </button>
                          ))}
                        </div>
                        {/* 残弾を見せる設定のときだけ、弾を使う攻撃の前に警告する（Phase 5r） */}
                        {rangedWeapon && typeof rangedWeapon.ammo === 'number' && (rangedWeapon.ammo === 0 || rangedWeapon.ammo < 2 || (canAutofire && rangedWeapon.ammo < 10)) && (
                          <div data-testid="ammo-warning" style={{ padding: '6px 8px', border: '1px solid var(--color-warning)', color: 'var(--color-warning)', fontSize: '0.8rem' }}>
                            {rangedWeapon.ammo === 0
                              ? `${rangedWeapon.name} は弾切れ。撃てません。リロード（アクション 1 回）するか、別の武器・行動を選んでください`
                              : rangedWeapon.ammo < 2
                                ? `${rangedWeapon.name} は残り ${rangedWeapon.ammo} 発。1 回しか撃てません`
                                : `${rangedWeapon.name} は残り ${rangedWeapon.ammo} 発。フルオート射撃・制圧射撃は 10 発必要なので使えません`}
                          </div>
                        )}
                      </div>
                    )}

                    {actionBlockedMsg && (
                      <div
                        data-testid="player-action-blocked"
                        role="alert"
                        style={{ padding: '8px 10px', border: '1px solid var(--color-enemy)', borderRadius: '6px', color: 'var(--color-enemy)', fontSize: '0.85rem', fontWeight: 600, display: 'flex', justifyContent: 'space-between', gap: '8px' }}
                      >
                        <span>{actionBlockedMsg}</span>
                        <button type="button" aria-label="閉じる" onClick={() => setActionBlockedMsg(null)} style={{ background: 'none', border: 'none', color: 'inherit' }}>
                          ✕
                        </button>
                      </div>
                    )}
                    {isMyTurn && moveMapAction && token && (
                      <PlayerMoveMap
                        token={token}
                        actionKey={moveMapAction}
                        refreshKey={currentCombat}
                        result={moveResult}
                        onSend={(dest) => sendMessage({ type: 'combat:move', payload: { action_key: moveMapAction, x: dest.x, y: dest.y } })}
                        onClose={() => setMoveMapAction(null)}
                      />
                    )}
                    {isMyTurn && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <button data-testid="player-action-move" aria-disabled={actionBlocked('move', null) ? 'true' : undefined}
                          onClick={() => {
                            if (guardAction('move', '移動', null)) return;
                            setMoveMapAction('move');
                            setMoveResult(null);
                            setChosenActionLabel('移動');
                            sendMessage({ type: 'combat:choose', payload: { action_key: 'move' } });
                          }}
                          style={{
                              ...(actionBlocked('move', null) ? blockedButtonStyle : {}),
                            padding: '12px 10px',
                            backgroundColor: 'var(--color-surface)',
                            border: '1px solid var(--color-border-light)',
                            borderRadius: '6px',
                            color: 'var(--color-text)',
                            textAlign: 'left',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>移動</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                            MOVE {sheet.stats.move}マス (2m/マス)
                          </div>
                        </button>

                        <button data-testid="player-action-ranged" aria-disabled={actionBlocked('ranged', !rangedWeapon ? '射撃武器を選んでください' : null) ? 'true' : undefined}
                          onClick={() => {
                            if (guardAction('ranged', '射撃', !rangedWeapon ? '射撃武器を選んでください' : null)) return;
                            setChosenActionLabel('射撃');
                            setPadRollType('attack');
                            setShowDicePad(true);
                            setPadFirstRoll(null);
                            setPadExtraRoll(null);
                            setNeedsExtraRoll(false);
                            sendMessage({ type: 'combat:choose', payload: { action_key: 'ranged', target_id: attackTargetId ?? undefined, weapon_id: weaponId } });
                          }}
                          style={{
                              ...(actionBlocked('ranged', !rangedWeapon ? '射撃武器を選んでください' : null) ? blockedButtonStyle : {}),
                            padding: '12px 10px',
                            backgroundColor: 'var(--color-surface)',
                            border: '1px solid var(--color-border-light)',
                            borderRadius: '6px',
                            color: 'var(--color-text)',
                            textAlign: 'left',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>射撃</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                            {rangedWeapon ? (
                              <>
                                REF {refVal} + {formatSkillName(rangedSkillKey)} {sk(rangedSkillKey)}
                                {woundPen !== 0 && ` ${woundPen}`} = {attackBaseRanged} + 1d10
                              </>
                            ) : (
                              '射撃武器がありません'
                            )}
                          </div>
                          {rangedWeapon && bandsText('ranged')}
                        </button>

                        <button data-testid="player-action-aimed" aria-disabled={actionBlocked('aimed', !rangedWeapon ? '射撃武器を選んでください' : null) ? 'true' : undefined}
                          onClick={() => {
                            if (guardAction('aimed', '照準射撃', !rangedWeapon ? '射撃武器を選んでください' : null)) return;
                            setChosenActionLabel('照準射撃');
                            setPadRollType('attack');
                            setShowDicePad(true);
                            setPadFirstRoll(null);
                            setPadExtraRoll(null);
                            setNeedsExtraRoll(false);
                            sendMessage({ type: 'combat:choose', payload: { action_key: 'aimed', target_id: attackTargetId ?? undefined, weapon_id: weaponId } });
                          }}
                          style={{
                              ...(actionBlocked('aimed', !rangedWeapon ? '射撃武器を選んでください' : null) ? blockedButtonStyle : {}),
                            padding: '12px 10px',
                            backgroundColor: 'var(--color-surface)',
                            border: '1px solid var(--color-border-light)',
                            borderRadius: '6px',
                            color: 'var(--color-text)',
                            textAlign: 'left',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>照準射撃</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                            {rangedWeapon ? `${attackBaseRanged} − 8（狙う分）= ${attackBaseRanged - 8} + 1d10` : '射撃武器がありません'}
                          </div>
                          {rangedWeapon && bandsText('aimed')}
                        </button>

                        <button data-testid="player-action-autofire" aria-disabled={actionBlocked('autofire', !canAutofire ? 'この武器ではフルオート射撃ができません' : null) ? 'true' : undefined}
                          onClick={() => {
                            if (guardAction('autofire', 'フルオート射撃', !canAutofire ? 'この武器ではフルオート射撃ができません' : null)) return;
                            setChosenActionLabel('フルオート射撃');
                            setPadRollType('attack');
                            setShowDicePad(true);
                            setPadFirstRoll(null);
                            setPadExtraRoll(null);
                            setNeedsExtraRoll(false);
                            sendMessage({ type: 'combat:choose', payload: { action_key: 'autofire', target_id: attackTargetId ?? undefined, weapon_id: weaponId } });
                          }}
                          style={{
                              ...(actionBlocked('autofire', !canAutofire ? 'この武器ではフルオート射撃ができません' : null) ? blockedButtonStyle : {}),
                            padding: '12px 10px',
                            backgroundColor: 'var(--color-surface)',
                            border: '1px solid var(--color-border-light)',
                            borderRadius: '6px',
                            color: 'var(--color-text)',
                            textAlign: 'left',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>フルオート射撃</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                            {canAutofire
                              ? `REF ${refVal} + フルオート射撃 ${sk('autofire')}${woundPen !== 0 ? ` ${woundPen}` : ''} = ${attackBaseAutofire} + 1d10`
                              : 'この武器ではできません'}
                          </div>
                        </button>

                        <button aria-disabled={actionBlocked(meleeWeapon ? 'melee' : 'brawl', null) ? 'true' : undefined}
                          onClick={() => {
                            if (guardAction(meleeWeapon ? 'melee' : 'brawl', meleeWeapon ? '近接攻撃' : '格闘', null)) return;
                            setChosenActionLabel(meleeWeapon ? '近接攻撃' : '格闘');
                            setPadRollType('attack');
                            setShowDicePad(true);
                            setPadFirstRoll(null);
                            setPadExtraRoll(null);
                            setNeedsExtraRoll(false);
                            sendMessage({ type: 'combat:choose', payload: { action_key: meleeWeapon ? 'melee' : 'brawl', target_id: attackTargetId ?? undefined, weapon_id: meleeWeapon ? weaponId : undefined } });
                          }}
                          style={{
                              ...(actionBlocked(meleeWeapon ? 'melee' : 'brawl', null) ? blockedButtonStyle : {}),
                            padding: '12px 10px',
                            backgroundColor: 'var(--color-surface)',
                            border: '1px solid var(--color-border-light)',
                            borderRadius: '6px',
                            color: 'var(--color-text)',
                            textAlign: 'left',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{meleeWeapon ? '近接攻撃' : '格闘（素手）'}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                            DEX {dexVal} + {formatSkillName(meleeSkillKey)} {sk(meleeSkillKey)}
                            {woundPen !== 0 && ` ${woundPen}`} = {attackBaseMelee} + 1d10
                            {meleeWeapon ? '（SP半減）' : ''}
                          </div>
                        </button>

                        {/* 武術攻撃（〈武術〉を持っているときだけ。Phase 5u） */}
                        {(() => {
                          const style = Object.entries((sheet.skills ?? {}) as Record<string, number>)
                            .filter(([k, v]) => k.split(':')[0] === 'martial_arts' && v >= 1)
                            .sort((a, b) => b[1] - a[1])[0];
                          if (!style) return null;
                          return (
                            <button aria-disabled={actionBlocked('martial_arts', null) ? 'true' : undefined}
                              data-testid="martial-arts-button"
                              onClick={() => {
                                if (guardAction('martial_arts', '武術攻撃', null)) return;
                                setChosenActionLabel('武術攻撃');
                                setPadRollType('attack');
                                setShowDicePad(true);
                                setPadFirstRoll(null);
                                setPadExtraRoll(null);
                                setNeedsExtraRoll(false);
                                sendMessage({ type: 'combat:choose', payload: { action_key: 'martial_arts', target_id: attackTargetId ?? undefined } });
                              }}
                              style={{
                                  ...(actionBlocked('martial_arts', null) ? blockedButtonStyle : {}), padding: '12px 10px', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border-light)', borderRadius: '6px', color: 'var(--color-text)', textAlign: 'left', cursor: 'pointer' }}
                            >
                              <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>武術攻撃</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                                DEX {dexVal} + {formatSkillName(style[0])} {style[1]}
                                {woundPen !== 0 && ` ${woundPen}`} = {dexVal + style[1] + woundPen} + 1d10（SP半減）
                              </div>
                            </button>
                          );
                        })()}

                        <button data-testid="player-action-reload" aria-disabled={actionBlocked('reload', !rangedWeapon ? 'リロードする射撃武器を選んでください' : null) ? 'true' : undefined}
                          onClick={() => {
                            if (guardAction('reload', 'リロード', !rangedWeapon ? 'リロードする射撃武器を選んでください' : null)) return;
                            setChosenActionLabel('リロード');
                            sendMessage({ type: 'combat:choose', payload: { action_key: 'reload' } });
                          }}
                          style={{
                              ...(actionBlocked('reload', !rangedWeapon ? 'リロードする射撃武器を選んでください' : null) ? blockedButtonStyle : {}),
                            padding: '12px 10px',
                            backgroundColor: 'var(--color-surface)',
                            border: '1px solid var(--color-border-light)',
                            borderRadius: '6px',
                            color: 'var(--color-text)',
                            textAlign: 'left',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>リロード</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                            弾を満タンにする
                          </div>
                        </button>

                        <button data-testid="player-action-run" aria-disabled={actionBlocked('run', null) ? 'true' : undefined}
                          onClick={() => {
                            if (guardAction('run', '走る', null)) return;
                            setMoveMapAction('run');
                            setMoveResult(null);
                            setChosenActionLabel('走る');
                            sendMessage({ type: 'combat:choose', payload: { action_key: 'run' } });
                          }}
                          style={{
                              ...(actionBlocked('run', null) ? blockedButtonStyle : {}),
                            padding: '12px 10px',
                            backgroundColor: 'var(--color-surface)',
                            border: '1px solid var(--color-border-light)',
                            borderRadius: '6px',
                            color: 'var(--color-text)',
                            textAlign: 'left',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>走る</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                            さらに MOVE 分移動
                          </div>
                        </button>

                        {netrunnerRank > 0 && (
                          <button aria-disabled={actionBlocked('net_action', null) ? 'true' : undefined}
                            data-testid="player-net-action-btn"
                            onClick={() => {
                              if (guardAction('net_action', 'NET アクション', null)) return;
                              setChosenActionLabel('NET アクション');
                              setPadRollType('attack');
                              setShowDicePad(true);
                              setPadFirstRoll(null);
                              setPadExtraRoll(null);
                              setNeedsExtraRoll(false);
                              sendMessage({ type: 'combat:choose', payload: { action_key: 'net_action', target_id: attackTargetId ?? undefined } });
                            }}
                            style={{
                                ...(actionBlocked('net_action', null) ? blockedButtonStyle : {}),
                              padding: '12px 10px',
                              backgroundColor: 'var(--color-surface)',
                              border: '1px solid var(--color-ally)',
                              borderRadius: '6px',
                              color: 'var(--color-ally)',
                              textAlign: 'left',
                              cursor: 'pointer',
                            }}
                          >
                            <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>NET アクション</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                              インタフェース {netrunnerRank} + 1d10
                            </div>
                          </button>
                        )}

                        {sheet.woundState === 'mortally' && (
                          <button data-testid="player-action-death_save" aria-disabled={actionBlocked('death_save', null) ? 'true' : undefined}
                            onClick={() => {
                              if (guardAction('death_save', '死亡セーブ', null)) return;
                              setChosenActionLabel('死亡セーブ');
                              setPadRollType('death_save'); // GM の死亡セーブ欄に入る（Phase 5l。前は回避の欄に入っていた）
                              setShowDicePad(true);
                              setPadFirstRoll(null);
                              setPadExtraRoll(null);
                              setNeedsExtraRoll(false);
                              sendMessage({ type: 'combat:choose', payload: { action_key: 'death_save' } });
                            }}
                            style={{
                                ...(actionBlocked('death_save', null) ? blockedButtonStyle : {}),
                              padding: '12px 10px',
                              backgroundColor: 'rgba(235, 75, 75, 0.2)',
                              border: '1px solid var(--color-danger)',
                              borderRadius: '6px',
                              color: 'var(--color-danger)',
                              textAlign: 'left',
                              cursor: 'pointer',
                              fontWeight: 700,
                            }}
                          >
                            <div>死亡セーブ</div>
                            <div style={{ fontSize: '0.75rem', marginTop: '2px' }}>
                              BODY {sheet.stats.body} 未満
                            </div>
                          </button>
                        )}
                      </div>
                    )}

                    {/* Dodge Button (always accessible) */}
                    <div style={{ marginTop: '8px' }}>
                      <button data-testid="player-action-dodge" aria-disabled={actionBlocked('dodge', null) ? 'true' : undefined}
                        onClick={() => {
                          if (guardAction('dodge', '回避', null)) return;
                          setChosenActionLabel('回避');
                          setPadRollType('defense');
                          setShowDicePad(true);
                          setPadFirstRoll(null);
                          setPadExtraRoll(null);
                          setNeedsExtraRoll(false);
                          sendMessage({ type: 'combat:choose', payload: { action_key: 'dodge' } });
                        }}
                        style={{
                            ...(actionBlocked('dodge', null) ? blockedButtonStyle : {}),
                          width: '100%',
                          padding: '12px',
                          backgroundColor: 'var(--color-surface)',
                          border: '1px solid var(--color-warning)',
                          borderRadius: '6px',
                          color: 'var(--color-warning)',
                          fontWeight: 700,
                          fontSize: '0.95rem',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span>回避（GMに言われたとき）</span>
                        <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>
                          基準値 {dodgeBase} + 1d10
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Dice Pad (Single hand optimized) */}
              {dicePad}
            </div>
          )}
          <PlayerActionSkills sheet={sheet} inCombat={!!currentCombat && currentCombat.status !== 'ended'} />
        </div>
      )}

      {/* Bottom Navigation Tabs */}
      <nav
        className="cp-tabbar"
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
          gridTemplateColumns: 'repeat(6, 1fr)',
          zIndex: 100,
        }}
      >
        {(
          [
            { id: 'sheet', label: 'シート', code: 'ID' },
            { id: 'gear', label: '装備', code: 'GEAR' },
            { id: 'skills', label: '技能', code: 'SKL' },
            { id: 'shop', label: '商店', code: 'SHOP' },
            { id: 'act', label: '行動', code: 'ACT' },
            { id: 'handouts', label: '資料', code: 'DATA' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            data-testid={`player-tab-${tab.id}`}
            aria-label={tab.label}
            className={activeTab === tab.id ? 'is-active' : undefined}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: 'none',
              border: 'none',
              color: activeTab === tab.id ? 'var(--color-ally)' : 'var(--color-text-muted)',
              fontWeight: activeTab === tab.id ? 700 : 400,
              fontSize: '0.8rem',
              cursor: 'pointer',
              borderTop: activeTab === tab.id ? '2px solid var(--color-ally)' : 'none',
              padding: 0,
            }}
          >
            <span className="cp-tab-code" aria-hidden="true">{tab.code}</span>
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
};
