import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api, gmFetch } from '../api.js';
import {
  Combat,
  combatDamageFormula,
  damageDiceGuide,
  CombatParticipant,
  CombatActionDef,
  CombatChange,
  CharacterSheet,
  Board,
  BoardObject,
  BoardToken,
  BoardDrop,
  formatSkillName,
  MARTIAL_TECHNIQUES,
  HAZARDS,
  isHazardStatus,
  DRUGS,
  soloEffects,
  roleRank,
  SOLO_ABILITIES,
  BACKUP_TIERS,
  MANEUVERS,
  NetArchitecture,
  NetRunState,
  NetDeckConfig,
  NET_PROGRAMS,
  BLACK_ICE_CATALOG,
  netActionsForRank,
  combatActionInputs,
  VEHICLE_ACTIONS,
  isVehicleAction,
} from '@cyberpgm/shared';
import {
  initiativeTotal,
  sortInitiative,
  rerollTies,
  InitiativeEntry,
  findReachableSquares,
  checkLineOfSight,
  gridDistance,
  DEFAULT_RULES,
  LosStatus,
  suppressiveTargetCandidates,
} from '@cyberpgm/rules';
import { BoardView } from './BoardView.js';
import { findTokenPlacement, tokenPlacementError } from '../utils/board-placement.js';
import { ItemDetailPopup } from './ItemDetail.js';
import { JoinCombatDialog } from './JoinCombatDialog.js';
import { useActionAvailability, blockedButtonStyle } from '../hooks/useActionAvailability.js';
import { ActionButton } from './ActionButton.js';

interface CombatViewProps {
  characters: CharacterSheet[];
  onRefreshCharacters: () => void;
  token?: string | null;
  wsMessage?: { type: string; payload: any } | null;
  isStandaloneWindow?: boolean;
}

// スマホから届いたイニシアチブの出目（準備中に参加者に残っている。Phase 5l）
const phoneRoll = (p: { initiative_roll?: unknown }) => {
  const r = p.initiative_roll as { first?: number; extra?: number } | undefined;
  return r && typeof r.first === 'number' ? { first: r.first, extra: r.extra } : undefined;
};

// 1 ターンに使えるアクションの数（サーバーの actionsAllowed と同じ。Phase 5j）
const actionsAllowedOf = (p: { state?: Record<string, unknown> }) =>
  Math.max(1, Number(p.state?.actions_per_turn ?? 1)) + Math.max(0, Number(p.state?.bonus_actions ?? 0));

// 近接の攻撃・判定（相手は回避で受ける。間合いは隣のマス）。武術とつかみは Phase 5u
const MELEE_LIKE = ['melee', 'brawl', 'martial_arts', 'grab', 'martial_technique'];

export const CombatView: React.FC<CombatViewProps> = ({
  characters,
  onRefreshCharacters,
  token,
  wsMessage,
  isStandaloneWindow = false,
}) => {
  const [combat, setCombat] = useState<Combat | null>(null);
  // 参加者カードの詳細と、品目の性能・効果・フレーバーの窓（GM のみ。SPEC §5.1、Phase 5c）
  const [expandedParticipantId, setExpandedParticipantId] = useState<string | null>(null);
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const handleLeave = async (participantId: string) => {
    if (!combat) return;
    await gmFetch(`/api/combats/${combat.id}/participants/${participantId}/leave`, { method: 'POST' });
    refreshCombat();
  };
  const [itemPopup, setItemPopup] = useState<{ name: string; itemId?: string | null } | null>(null);
  const openItemPopup = (name: string, itemId?: string | null) => setItemPopup({ name, itemId });
  const activePart = combat?.participants?.[combat.turn_index];
  // 行動ごとの「今できるか・できない理由」（Phase 6a）。戦闘が変わるたびに読み直す
  const { blockedMessage } = useActionAvailability({
    enabled: combat?.status === 'active' && Boolean(activePart),
    token,
    participantId: activePart?.id ?? null,
    refreshKey: combat,
  });
  const [actions, setActions] = useState<CombatActionDef[]>([]);
  const [loading, setLoading] = useState(true);

  // Board state (Phase 4b)
  const [boards, setBoards] = useState<Board[]>([]);
  const [boardData, setBoardData] = useState<{
    board: Board;
    objects: BoardObject[];
    tokens: BoardToken[];
    drops: BoardDrop[];
  } | null>(null);
  const [focusedMapParticipantId, setFocusedMapParticipantId] = useState('');
  const [placementParticipantId, setPlacementParticipantId] = useState('');
  const [placingTokens, setPlacingTokens] = useState(false);
  const [placementMessage, setPlacementMessage] = useState<string | null>(null);
  const placementBusy = React.useRef(false);
  const [sessionCode, setSessionCode] = useState<string>('');
  const [isTvBroadcasting, setIsTvBroadcasting] = useState<boolean>(true);

  // Board Interaction & Movements
  const [destination, setDestination] = useState<{ x: number; y: number } | null>(null);
  // スマホのマップでプレイヤーが選んだ移動先なら、その人の名前（Phase 6a）
  const [destinationFrom, setDestinationFrom] = useState<string | null>(null);
  // できない行動のボタンを押したときの理由（Phase 6a）
  const [blockedActionMsg, setBlockedActionMsg] = useState<string | null>(null);
  const [forceMove, setForceMove] = useState<boolean>(false);

  // Line of Sight & Cover State
  const [losOverride, setLosOverride] = useState<'auto' | LosStatus>('auto');
  const [hitCover, setHitCover] = useState<boolean>(false);
  const [coverDamageInput, setCoverDamageInput] = useState<string>('');
  const [coverHpInput, setCoverHpInput] = useState<string>('');
  const [coverObjectId, setCoverObjectId] = useState<string | null>(null);
  const [pickupDropId, setPickupDropId] = useState<string | null>(null);

  // Setup state
  const [mookCount, setMookCount] = useState<number>(2);
  const [selectedNpcId, setSelectedNpcId] = useState<string>('');
  const [autoRollAll, setAutoRollAll] = useState(false);
  const [initInputs, setInitInputs] = useState<Record<string, { first: number; extra?: number }>>({});
  const [tieBreakMode, setTieBreakMode] = useState<'reroll' | 'ref' | 'manual'>('reroll');

  // Active Combat: Turn Guide State
  const [selectedActionKey, setSelectedActionKey] = useState<string | null>(null);
  const [showVehicleActions, setShowVehicleActions] = useState(false);
  const [targetParticipantId, setTargetParticipantId] = useState<string | null>(null);
  // 距離は盤面から自動で入るか、GM が入れる（決め打ちの値を置かない。4a §11.1）
  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [selectedWeaponId, setSelectedWeaponId] = useState<string | null>(null);
  const [meleeIgnoreArmorInput, setMeleeIgnoreArmorInput] = useState<number | undefined>(undefined);
  const [dodgeMode, setDodgeMode] = useState<'dv' | 'dodge'>('dv');
  const [aimedLocation, setAimedLocation] = useState<'head' | 'held_item' | 'leg'>('head');
  const [heldItemId, setHeldItemId] = useState<string>('');
  // 武術・つかみ（Phase 5u）
  const [martialStyle, setMartialStyle] = useState<string>('');
  const [technique, setTechnique] = useState<string>('');
  const [grabMode, setGrabMode] = useState<'hold' | 'item'>('hold');
  const [aimHead, setAimHead] = useState(false);
  const [kipUp, setKipUp] = useState(false);
  // 【運命】点・環境ダメージ・投げる（Phase 5v）
  const [luckSpent, setLuckSpent] = useState(0);
  const [hazardKey, setHazardKey] = useState<string>('fire');
  const [hazardLevel, setHazardLevel] = useState<'small' | 'medium' | 'large'>('small');
  const [fallM, setFallM] = useState('');
  const [hazardEndStatus, setHazardEndStatus] = useState('');
  const [throwEntryId, setThrowEntryId] = useState('');
  // ドラッグ・薬品（Phase 5w）
  const [drugEntryId, setDrugEntryId] = useState('');
  const [drugUnwilling, setDrugUnwilling] = useState(false);
  // ソロの割り振り直し・支援要員（Phase 5x）
  const [soloAlloc, setSoloAlloc] = useState<Record<string, string>>({});
  const [backupTierSel, setBackupTierSel] = useState('3〜4');
  // ヴィークル（Phase 5y）
  const [vehRef, setVehRef] = useState('');
  const [targetVeh, setTargetVeh] = useState('');
  const [asDriver, setAsDriver] = useState(true);
  const [maneuverKey, setManeuverKey] = useState('swerve');
  const [weakpoint, setWeakpoint] = useState(false);
  // ネットラン（Phase 5z）
  const [netArchList, setNetArchList] = useState<NetArchitecture[]>([]);
  const [netSubAction, setNetSubAction] = useState<string>('jack_in');
  const [netArchId, setNetArchId] = useState<string>('');
  const [netTargetFloor, setNetTargetFloor] = useState<number>(1);
  const [netProgramKey, setNetProgramKey] = useState<string>('Sword');
  const [netTargetIceId, setNetTargetIceId] = useState<string>('');
  const [netVirusDesc, setNetVirusDesc] = useState<string>('システム改変ウイルス');
  const [netVirusDv, setNetVirusDv] = useState<number>(10);
  const [netVirusActions, setNetVirusActions] = useState<number>(2);
  const [netScannerDv, setNetScannerDv] = useState<number>(13);
  const [netAmbushIceRoll, setNetAmbushIceRoll] = useState<number | null>(null);
  const [netAmbushRunnerRoll, setNetAmbushRunnerRoll] = useState<number | null>(null);
  
  // 出目を入れる前の計算式と成功ライン（仕様 §5.0.1。Phase 5n）
  const [attackLineText, setAttackLineText] = useState<{ text: string; bands?: Array<{range:string;dv:number;needed:string;current?:boolean}> } | null>(null);
  useEffect(() => {
    const cur = combat?.participants?.[combat.turn_index];
    if (!combat || !cur || !['ranged', 'aimed', 'autofire', ...MELEE_LIKE].includes(selectedActionKey ?? '')) {
      setAttackLineText(null);
      return;
    }
    let alive = true;
    gmFetch(`/api/combats/${combat.id}/line`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_key: selectedActionKey,
        actor_id: cur.id,
        target_id: targetParticipantId ?? undefined,
        weapon_entry_id: selectedWeaponId ?? undefined,
        distance_m: distanceM ?? undefined,
        dodge_mode: dodgeMode,
        luck_spent: luckSpent || undefined,
      }),
    })
      .then((r) => r.json())
      .then((res) => alive && setAttackLineText(res.line ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [combat?.id, combat?.turn_index, selectedActionKey, targetParticipantId, selectedWeaponId, distanceM, dodgeMode, luckSpent]);

  // 出目がどのスマホから届いたか（roll_type → 名前。Phase 5n）
  const [rollFrom, setRollFrom] = useState<Record<string, string>>({});

  // Rolls in Guide. 決め打ちの出目は置かない（入れ忘れると計算が「出目を入力してください」で止まる。Phase 5l）
  const [attackFirst, setAttackFirst] = useState<number | null>(null);
  const [attackExtra, setAttackExtra] = useState<number | undefined>(undefined);
  const [suppressiveFacing, setSuppressiveFacing] = useState<'N'|'NE'|'E'|'SE'|'S'|'SW'|'W'|'NW'>('N');
  const [suppressiveTargetIds, setSuppressiveTargetIds] = useState<string[]>([]);
  const [suppressiveRolls, setSuppressiveRolls] = useState<Record<string, { first?: number; extra?: number }>>({});
  const [defenseFirst, setDefenseFirst] = useState<number | null>(null);
  const [defenseExtra, setDefenseExtra] = useState<number | undefined>(undefined);
  const [damageDiceStr, setDamageDiceStr] = useState<string>('');
  const [critRoll, setCritRoll] = useState<number | undefined>(undefined);
  // 瀕死中の被弾と 6 が 2 個が重なったときの 2 つ目の致命傷（Phase 5r）
  const [extraCritRoll, setExtraCritRoll] = useState<number | undefined>(undefined);
  const [secondExtraCritRoll, setSecondExtraCritRoll] = useState<number | undefined>(undefined);
  // 状態異常・弾切れなどの告知（Phase 5r）
  const [notices, setNotices] = useState<Array<{ title: string; body: string; at: number }>>([]);
  const [deathSaveRoll, setDeathSaveRoll] = useState<number | undefined>(undefined);

  // Multi-attack for ROF 2
  const [secondAttackEnabled, setSecondAttackEnabled] = useState<boolean>(false);
  const [secondAttackFirst, setSecondAttackFirst] = useState<number | null>(null);
  const [secondAttackExtra, setSecondAttackExtra] = useState<number | undefined>(undefined);
  const [secondDamageDiceStr, setSecondDamageDiceStr] = useState<string>('');
  // 第2攻撃の回避と致命傷の出目（回避は攻撃ごとに振る。Phase 5m）
  const [secondDefenseFirst, setSecondDefenseFirst] = useState<number | null>(null);
  const [secondCritRoll, setSecondCritRoll] = useState<number | undefined>(undefined);
  
  // Unconfirmed / Manual Inputs
  const [manualNotes, setManualNotes] = useState<string>('');
  const [manualHpChange, setManualHpChange] = useState<string>('');

  // Resolution preview
  const [previewResult, setPreviewResult] = useState<any | null>(null);
  // 足りない入力を赤枠で示す（Phase 5s）。second は ROF 2 の 2 回目の攻撃の欄
  const missingFields: Array<{ field: string; attack_index?: number }> = previewResult?.missing_fields ?? [];
  const isMissing = (second: boolean, ...fields: string[]) => missingFields.some((m) => (m.attack_index ?? 0) === (second ? 1 : 0) && fields.includes(m.field));
  const missBorder = (miss: boolean) => (miss ? '2px solid var(--color-warning)' : '1px solid var(--color-border-light)');
  const actionInputSpec = combatActionInputs(selectedActionKey ?? '', selectedActionKey === 'net_action' ? netSubAction : selectedActionKey === 'hazard' ? hazardKey : undefined);
  const hasDiceInput = (field: 'attack_roll' | 'defense_roll' | 'damage_rolls' | 'crit_roll' | 'death_save_roll') => actionInputSpec.dice.some((d) => d.field === field);
  const targetForDefense = combat?.participants?.find((p) => p.id === targetParticipantId);
  const showDefenseInput = selectedActionKey !== 'suppressive' && hasDiceInput('defense_roll') && (!['ranged', 'aimed', 'autofire', 'throw_object'].includes(selectedActionKey ?? '') || (dodgeMode === 'dodge' && (targetForDefense?.character?.stats?.ref ?? 0) >= 8));
  const [isResolving, setIsResolving] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  // Mobile side tab (for 390px)
  const [mobileSideTab, setMobileSideTab] = useState<'ally' | 'enemy'>('ally');

  // Load current combat & actions
  const refreshCombat = useCallback(async () => {
    try {
      const res = await api.getCurrentCombat(token);
      setCombat(res.combat);
    } catch (err) {
      console.warn('Failed to fetch combat:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Load current board & boards list
  const refreshBoard = useCallback(async (boardId: string) => {
    try {
      const data = await api.getBoard(boardId);
      if (data && data.board) {
        setBoardData({
          board: data.board,
          objects: data.board.objects || [],
          tokens: data.board.tokens || [],
          drops: data.board.drops || [],
        });
      }
    } catch (err) {
      console.warn('Failed to fetch board details:', err);
    }
  }, []);

  const refreshBoardsList = useCallback(async () => {
    try {
      const res = await api.getBoards();
      setBoards(res.boards);
      const session = await api.getSessionInfo().catch(() => null);
      if (session) setSessionCode(session.code);
    } catch (err) {
      console.warn('Failed to fetch boards list:', err);
    }
  }, []);

  const refreshNetArchs = useCallback(async () => {
    try {
      const res = await api.listNetArchitectures();
      setNetArchList(res.architectures || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refreshCombat();
    refreshBoardsList();
    refreshNetArchs();
    api.getCombatActions().then((res) => setActions(res.actions)).catch(() => {});
  }, [refreshCombat, refreshBoardsList, refreshNetArchs]);

  useEffect(() => {
    if (!netArchId && netArchList.length > 0) {
      setNetArchId(netArchList[0].id);
    }
  }, [netArchId, netArchList]);

  useEffect(() => {
    const netSt = (activePart?.state as any)?.net as NetRunState | undefined;
    if (netSt?.arch_id) {
      setNetArchId(netSt.arch_id);
    }
    if (!netSt?.jacked_in) {
      setNetSubAction('jack_in');
    } else if (netSubAction === 'jack_in') {
      setNetSubAction('pathfinder');
    }
    if (netSt?.depth) {
      setNetTargetFloor(netSt.depth);
    }
    const activeIce = (netSt?.active_ice ?? []).find((x) => x.rez > 0);
    if (activeIce) {
      setNetTargetIceId(activeIce.id);
    }
  }, [activePart?.id, (activePart?.state as any)?.net?.jacked_in, (activePart?.state as any)?.net?.depth]);

  useEffect(() => {
    if (combat?.board_id) {
      refreshBoard(combat.board_id);
    } else {
      setBoardData(null);
    }
    setPlacementParticipantId('');
    setFocusedMapParticipantId('');
    setPlacementMessage(null);
  }, [combat?.board_id, refreshBoard]);

  // Board Object & Token Handlers
  const handlePlaceParticipant = async ({ x, y }: { x: number; y: number }, participantId = placementParticipantId) => {
    if (!combat || !boardData || !participantId || placementBusy.current) return;
    const participant = combat.participants.find((p) => p.id === participantId);
    if (!participant) return;
    const matchId = participant.character_id || participant.id;
    const existing = boardData.tokens.find((t) => t.character_id === matchId);
    const board = { ...boardData.board, objects: boardData.objects, tokens: boardData.tokens };
    const error = tokenPlacementError(board, x, y, existing?.id);
    if (error) {
      setPlacementMessage(error);
      return;
    }
    placementBusy.current = true;
    setPlacingTokens(true);
    try {
      if (existing) {
        await handleMoveToken(existing.id, x, y);
      } else {
        await api.createBoardToken(board.id, { character_id: matchId, x, y, gm_only: false });
        await refreshBoard(board.id);
      }
      setPlacementParticipantId('');
      setFocusedMapParticipantId(participant.id);
      setPlacementMessage(`${participant.name} を (${x}, ${y}) に配置しました。そのままコマをドラッグして動かせます。`);
    } catch (err: any) {
      setPlacementMessage(`配置できませんでした: ${err.message}`);
    } finally {
      placementBusy.current = false;
      setPlacingTokens(false);
    }
  };

  const handleShowParticipantOnMap = async (participant: CombatParticipant) => {
    if (!boardData || placementBusy.current) return;
    setPlacementParticipantId('');
    const existing = boardData.tokens.find((t) => t.character_id === (participant.character_id || participant.id));
    const board = { ...boardData.board, objects: boardData.objects, tokens: boardData.tokens };
    if (existing && !tokenPlacementError(board, existing.x, existing.y, existing.id)) {
      setFocusedMapParticipantId(participant.id);
      setPlacementMessage(`${participant.name} は (${existing.x}, ${existing.y}) です。水色の輪が付いたコマをドラッグして動かせます。`);
      return;
    }
    const cell = findTokenPlacement(board, participant.side, existing?.id);
    if (!cell) {
      setPlacementMessage('空きマスがありません。盤面を広げるか、ほかのコマを動かしてください。');
      return;
    }
    await handlePlaceParticipant(cell, participant.id);
  };

  const handleAutoPlaceTokens = async () => {
    if (!combat || !boardData || placementBusy.current) return;
    placementBusy.current = true;
    setPlacingTokens(true);
    const board = { ...boardData.board, objects: boardData.objects, tokens: [...boardData.tokens] };
    let placed = 0;
    let full = false;
    try {
      for (const p of combat.participants.filter((p) => p.active && !p.out)) {
        const matchId = p.character_id || p.id;
        const existing = board.tokens.find((t) => t.character_id === matchId);
        if (existing && !tokenPlacementError(board, existing.x, existing.y, existing.id)) continue;
        const cell = findTokenPlacement(board, p.side, existing?.id);
        if (!cell) {
          full = true;
          break;
        }
        if (existing) {
          await handleMoveToken(existing.id, cell.x, cell.y);
          board.tokens = board.tokens.map((t) => t.id === existing.id ? { ...t, ...cell } : t);
        } else {
          const res = await api.createBoardToken(board.id, { character_id: matchId, ...cell, gm_only: false });
          board.tokens = res.board.tokens || [];
        }
        placed++;
      }
      setPlacementParticipantId('');
      setPlacementMessage(full ? `${placed} 人を配置しました。空きマスが足りません。盤面を広げてください` : `${placed} 人を配置しました`);
    } catch (err: any) {
      setPlacementMessage(`配置できませんでした: ${err.message}`);
    } finally {
      await refreshBoard(board.id);
      placementBusy.current = false;
      setPlacingTokens(false);
    }
  };

  const handleCreateBoard = async () => {
    if (!combat) return;
    try {
      const res = await api.createBoard({ name: '戦闘盤面' });
      await api.updateCombat(combat.id, { board_id: res.board.id });
      refreshCombat();
      refreshBoard(res.board.id);
    } catch (err: any) {
      alert(`盤面の作成に失敗しました: ${err.message}`);
    }
  };

  const handleSelectBoard = async (boardId: string) => {
    if (!combat) return;
    try {
      await api.updateCombat(combat.id, { board_id: boardId });
      refreshCombat();
      refreshBoard(boardId);
    } catch (err: any) {
      alert(`盤面の変更に失敗しました: ${err.message}`);
    }
  };

  const handleCreateObject = async (obj: Omit<BoardObject, 'id' | 'board_id'>) => {
    if (!boardData) return;
    try {
      await api.createBoardObject(boardData.board.id, obj);
      refreshBoard(boardData.board.id);
    } catch (err: any) {
      alert(`オブジェクトの追加に失敗しました: ${err.message}`);
    }
  };

  const handleUpdateObject = async (objId: string, patch: Partial<BoardObject>) => {
    if (!boardData) return;
    try {
      await api.updateBoardObject(boardData.board.id, objId, patch);
      refreshBoard(boardData.board.id);
    } catch (err: any) {
      console.warn('Failed to update object:', err);
    }
  };

  const handleDeleteObject = async (objId: string) => {
    if (!boardData) return;
    try {
      await api.deleteBoardObject(boardData.board.id, objId);
      refreshBoard(boardData.board.id);
    } catch (err: any) {
      alert(`オブジェクトの削除に失敗しました: ${err.message}`);
    }
  };

  const handleMoveToken = async (tokenId: string, x: number, y: number) => {
    if (!boardData) return;
    try {
      if (combat && combat.status === 'active') {
        const res = await api.moveCombatToken(combat.id, { token_id: tokenId, x, y });
        setCombat(res.combat);
      } else {
        await api.updateBoardToken(boardData.board.id, tokenId, { x, y });
      }
      await refreshBoard(boardData.board.id);
    } catch (err: any) {
      setPlacementMessage(`移動できませんでした: ${err.message}`);
      throw err;
    }
  };

  // Movement reachable squares
  const reachableCells = useMemo(() => {
    if (!boardData || !activePart) return undefined;
    if (selectedActionKey !== 'move' && selectedActionKey !== 'run') return undefined;

    const token = boardData.tokens.find(
      (t) => (activePart.character_id && t.character_id === activePart.character_id) || t.character_id === activePart.id
    );
    if (!token) return undefined;

    const start = { x: token.x, y: token.y };
    // 走るは移動のあとにもう一度 MOVE 分。瀕死のあいだは MOVE −6（最低 1）（サーバーと同じ。Phase 5m）
    const charMove = (activePart.character?.stats?.move ?? 6) - (activePart.character?.armor_penalty ?? 0);
    const dying = (activePart.character?.hp ?? 1) < 1;
    const maxMoves = Math.max(1, dying ? charMove - 6 : charMove);

    const blockedCells = new Set<string>();
    boardData.objects.forEach((obj) => {
      if (!obj.passable) {
        for (let dx = 0; dx < obj.w; dx++) {
          for (let dy = 0; dy < obj.h; dy++) {
            blockedCells.add(`${obj.x + dx},${obj.y + dy}`);
          }
        }
      }
    });

    const stoppingBlockedCells = new Set<string>();
    boardData.tokens.forEach((t) => {
      if (t.id !== token.id) {
        stoppingBlockedCells.add(`${t.x},${t.y}`);
      }
    });

    const bounds = {
      cols: boardData.board.grid?.cols || 20,
      rows: boardData.board.grid?.rows || 15,
    };

    const reachable = findReachableSquares({
      start,
      maxSquares: maxMoves,
      isPassable: (pt) => !blockedCells.has(`${pt.x},${pt.y}`),
      canStop: (pt) => !stoppingBlockedCells.has(`${pt.x},${pt.y}`),
      bounds,
      diagonalRule: (combat?.settings?.diagonalRule as 'chebyshev' | 'alternate') || 'chebyshev',
    });

    return new Set(reachable.map((pt) => `${pt.x},${pt.y}`));
  }, [boardData, activePart, selectedActionKey, combat?.settings?.diagonalRule]);

  // LoS and Distance calculation
  const losInfo = useMemo(() => {
    if (!boardData || !activePart || !targetParticipantId) return null;
    const shooterToken = boardData.tokens.find(
      (t) => (activePart.character_id && t.character_id === activePart.character_id) || t.character_id === activePart.id
    );
    const targetPart = combat?.participants.find((p) => p.id === targetParticipantId);
    const targetToken = boardData.tokens.find(
      (t) => (targetPart?.character_id && t.character_id === targetPart.character_id) || t.character_id === targetParticipantId
    );
    if (!shooterToken || !targetToken) return null;

    const rules = {
      ...DEFAULT_RULES,
      diagonalRule: (combat?.settings?.diagonalRule as 'chebyshev' | 'alternate') || 'chebyshev',
      metersPerSquare: boardData.board.grid?.cell_m || 2,
    };

    const losResult = checkLineOfSight(
      { x: shooterToken.x, y: shooterToken.y },
      { x: targetToken.x, y: targetToken.y },
      boardData.objects,
      rules,
    );

    const distSquares = gridDistance(
      { x: shooterToken.x, y: shooterToken.y },
      { x: targetToken.x, y: targetToken.y },
      rules,
    );
    const autoDistanceM = distSquares * (boardData.board.grid?.cell_m || rules.metersPerSquare);

    const effectiveStatus = losOverride !== 'auto' ? losOverride : losResult.status;

    return {
      x1: shooterToken.x,
      y1: shooterToken.y,
      x2: targetToken.x,
      y2: targetToken.y,
      distSquares,
      autoDistanceM,
      status: effectiveStatus,
      rawStatus: losResult.status,
      hitCoverObject: losResult.coverObjects?.[0],
    };
  }, [boardData, activePart, targetParticipantId, combat, losOverride]);

  const suppressiveCandidates = useMemo(() => {
    if (!boardData || !activePart) return [] as string[];
    const shooter = boardData.tokens.find((t) => t.character_id === activePart.character_id || t.character_id === activePart.id);
    if (!shooter) return [];
    const meters = boardData.board.grid?.cell_m || 2;
    const rules = { ...DEFAULT_RULES, metersPerSquare: meters, diagonalRule: (combat?.settings?.diagonalRule as 'chebyshev'|'alternate') || 'chebyshev' };
    const targets = (combat?.participants ?? []).filter((p) => !p.out).map((participant) => {
      const token = boardData.tokens.find((t) => t.character_id === participant.character_id || t.character_id === participant.id);
      return { id: participant.id, position: token ? { x: token.x, y: token.y } : undefined, inVehicle: Boolean((participant.state as any)?.in_vehicle), inCover: Boolean((participant.state as any)?.inCover) };
    });
    return suppressiveTargetCandidates({ shooterId: activePart.id, shooter: {x:shooter.x,y:shooter.y}, targets, facing: suppressiveFacing, objects: boardData.objects, metersPerSquare: meters, rules });
  }, [boardData, activePart, combat, suppressiveFacing]);

  useEffect(() => {
    if (selectedActionKey === 'suppressive' && boardData) setSuppressiveTargetIds(suppressiveCandidates);
  }, [selectedActionKey, boardData?.board.id, suppressiveFacing, suppressiveCandidates]);

  useEffect(() => {
    if (losInfo && ['ranged', 'aimed', 'autofire'].includes(selectedActionKey || '')) {
      setDistanceM(losInfo.autoDistanceM);
    }
  }, [losInfo, selectedActionKey]);

  const meleeBlocked = useMemo(() => {
    if (!MELEE_LIKE.includes(selectedActionKey || '')) return false;
    if (losInfo && losInfo.distSquares > 1) return true;
    return false;
  }, [selectedActionKey, losInfo]);

  const isCoverHpNeededAndMissing = useMemo(() => {
    if (!hitCover) return false;
    const coverId = coverObjectId || losInfo?.hitCoverObject?.id;
    const activeObj = coverId ? boardData?.objects.find((o) => o.id === coverId) : losInfo?.hitCoverObject;
    const hasObjHp = activeObj && activeObj.cover_hp !== null && activeObj.cover_hp !== undefined;
    if (hasObjHp) return false;
    return coverHpInput.trim() === '' || isNaN(Number(coverHpInput)) || Number(coverHpInput) <= 0;
  }, [hitCover, coverObjectId, losInfo, boardData, coverHpInput]);

  const nearbyDrops = useMemo(() => {
    if (!boardData || !activePart) return [];
    const activeToken = boardData.tokens.find(
      (t) => (activePart.character_id && t.character_id === activePart.character_id) || t.character_id === activePart.id
    );
    if (!activeToken) return [];

    return boardData.drops.filter((d) => {
      const dist = gridDistance(
        { x: activeToken.x, y: activeToken.y },
        { x: d.x, y: d.y },
      );
      return dist <= 1;
    });
  }, [boardData, activePart]);

  // 近接攻撃・格闘・NETの対抗判定は、相手はいつも回避（防御）の出目で受ける（Phase 5l / 5z）
  useEffect(() => {
    if (
      MELEE_LIKE.includes(selectedActionKey ?? '') ||
      selectedActionKey === 'net_ice_attack' ||
      (selectedActionKey === 'net_action' && ['program', 'zap', 'slide'].includes(netSubAction))
    ) {
      setDodgeMode('dodge');
    }
  }, [selectedActionKey, netSubAction]);

  // Weapon entries in inventory for active participant (kind === 'weapon')
  const weaponEntries = useMemo(() => {
    const inv = (activePart?.character?.inventory as any[]) || [];
    return inv.filter((i: any) => i.kind === 'weapon');
  }, [activePart]);
  const actionWeaponEntries = selectedActionKey === 'repair_weapon' ? weaponEntries.filter((w) => w.malfunctioned) : weaponEntries;
  const selectedWeaponIsMalfunctioned = Boolean(weaponEntries.find((w) => w.entry_id === selectedWeaponId)?.malfunctioned && ['ranged','aimed','autofire','suppressive','melee'].includes(selectedActionKey ?? ''));

  // Auto-select first weapon entry for active participant if none or invalid is selected
  useEffect(() => {
    if (selectedActionKey && activePart?.character) {
      const selectable = selectedActionKey === 'repair_weapon' ? weaponEntries.filter((w) => w.malfunctioned) : weaponEntries;
      const isValid = selectable.some((w) => w.entry_id === selectedWeaponId);
      if (!isValid) {
        if (selectable.length > 0) {
          setSelectedWeaponId(selectable[0].entry_id);
        } else {
          setSelectedWeaponId(null);
        }
      }
    }
  }, [selectedActionKey, selectedWeaponId, activePart, weaponEntries]);

  // Handle WebSocket updates
  useEffect(() => {
    if (!wsMessage) return;
    if (wsMessage.type === 'combat:update') {
      setCombat(wsMessage.payload);
      onRefreshCharacters();
    } else if (wsMessage.type === 'combat:turn') {
      refreshCombat();
    } else if (wsMessage.type === 'combat:choose') {
      // Player selected an action
      const { action_key, weapon_id, target_id, distance_m, aimed_location, destination: dest, from_player_map, vehicle_ref, target_vehicle, maneuver } = wsMessage.payload;
      if (action_key) setSelectedActionKey(action_key);
      // スマホのマップで選んだ移動先（Phase 6a）。サーバーで本人・手番・届くマスを確かめ済み。確定は GM
      if (from_player_map && dest && typeof dest.x === 'number' && typeof dest.y === 'number') {
        setDestination({ x: dest.x, y: dest.y });
        const fromPart = combat?.participants.find((p) => p.character_id === wsMessage.payload.character_id);
        setDestinationFrom(fromPart?.name ?? 'プレイヤー');
      }
      if (weapon_id) setSelectedWeaponId(weapon_id);
      if (target_id) setTargetParticipantId(target_id);
      if (distance_m) setDistanceM(distance_m);
      if (aimed_location) setAimedLocation(aimed_location);
      if (vehicle_ref) setVehRef(JSON.stringify(vehicle_ref));
      if (target_vehicle) setTargetVeh(JSON.stringify(target_vehicle));
      if (maneuver) setManeuverKey(maneuver);
    } else if (wsMessage.type === 'combat:roll') {
      // Player submitted dice roll
      const { roll_type, first, extra, dice } = wsMessage.payload;
      // どのスマホから届いたかを出目欄の横に出す（Phase 5n）
      const fromPart = combat?.participants.find((p) => p.character_id === wsMessage.payload.character_id);
      if (fromPart && roll_type !== 'initiative') setRollFrom((prev) => ({ ...prev, [roll_type]: fromPart.name }));
      if (roll_type === 'suppressive_resistance' && typeof first === 'number' && typeof wsMessage.payload.target_id === 'string') {
        const target = combat?.participants.find((p) => p.id === wsMessage.payload.target_id && p.character_id === wsMessage.payload.character_id);
        if (target) setSuppressiveRolls((prev) => ({ ...prev, [target.id]: { first, extra } }));
      }
      if (roll_type === 'attack' && typeof wsMessage.payload.luck_spent === 'number') setLuckSpent(wsMessage.payload.luck_spent);
      if (roll_type === 'attack' && typeof first === 'number') {
        setAttackFirst(first);
        if (typeof extra === 'number') setAttackExtra(extra);
      } else if (roll_type === 'defense' && typeof first === 'number') {
        setDefenseFirst(first);
        if (typeof extra === 'number') setDefenseExtra(extra);
      } else if (roll_type === 'damage' && Array.isArray(dice)) {
        setDamageDiceStr(dice.join(', '));
      } else if (roll_type === 'crit' && typeof first === 'number') {
        setCritRoll(first);
      } else if (roll_type === 'death_save' && typeof first === 'number') {
        setDeathSaveRoll(first);
      } else if (roll_type === 'initiative' && typeof first === 'number') {
        const cid = wsMessage.payload.character_id;
        if (cid) {
          setInitInputs((prev) => ({ ...prev, [cid]: { first, extra } }));
        }
      }
    } else if (wsMessage.type === 'combat:notice') {
      setNotices((prev) => [wsMessage.payload, ...prev].slice(0, 20));
    } else if (wsMessage.type === 'board:update') {
      if (combat?.board_id) {
        refreshBoard(combat.board_id);
      } else {
        refreshBoardsList();
      }
    }
  }, [wsMessage, refreshCombat, onRefreshCharacters, refreshBoard, refreshBoardsList, combat?.board_id]);

  // Start new combat (setup)
  const handleStartNewCombat = async () => {
    try {
      const res = await api.createCombat({ tieBreak: tieBreakMode });
      setCombat(res.combat);
    } catch (err: any) {
      alert(`戦闘の開始に失敗しました: ${err.message}`);
    }
  };

  // Add NPC / Mook to combat
  const handleAddNpcToCombat = async (side: 'ally' | 'enemy' = 'enemy') => {
    if (!combat || !selectedNpcId) return;
    const targetChar = characters.find((c) => c.id === selectedNpcId);
    if (!targetChar) return;

    try {
      const count = targetChar.kind === 'mook' ? mookCount : 1;
      const res = await api.addParticipant(combat.id, {
        character_id: targetChar.id,
        name: targetChar.name,
        side,
        count,
      });
      setCombat(res.combat);
      setSelectedNpcId('');
    } catch (err: any) {
      alert(`参加者の追加に失敗しました: ${err.message}`);
    }
  };

  // Calculate & Set Initiative
  const handleConfirmInitiative = async () => {
    if (!combat) return;

    // 参加者チェックで外した人は入れない。スマホから届いた出目はサーバーに残っている（Phase 5l）
    const entries: InitiativeEntry[] = combat.participants.filter((p) => p.active).map((p) => {
      // 重い防具のペナルティを引いた REF（Phase 5m）
      const ref = (p.character?.stats?.ref ?? 5) - (p.character?.armor_penalty ?? 0);
      let rollObj = initInputs[p.character_id || p.id] ?? phoneRoll(p);
      if (autoRollAll || !rollObj) {
        // Roll 1d10
        const rolledFirst = Math.floor(Math.random() * 10) + 1;
        rollObj = { first: rolledFirst };
      }
      // ソロのイニシアチブ強化（p.146。Phase 5x）
      const soloInit = p.character ? soloEffects(p.character.role, p.character.extra).initiative : 0;
      const res = initiativeTotal(ref + soloInit, rollObj.first, rollObj.extra);
      return {
        id: p.id,
        ref,
        total: res.total,
        roll: rollObj,
      };
    });

    // 同値はルールどおり、同じ値の人どうしで 1d10 を振り直す（Phase 5m）。古い戦闘の 'ref' はそのまま
    const tieBreak = combat.settings.tieBreak || 'reroll';
    const d10 = () => Math.floor(Math.random() * 10) + 1;
    const updatePayload =
      tieBreak === 'reroll'
        ? rerollTies(entries, d10).map((s, index) => ({
            id: s.id,
            initiative: s.total,
            initiative_roll: { ...(s.roll as object), ...(s.tiebreak.length ? { tiebreak: s.tiebreak } : {}) },
            order_index: index,
          }))
        : sortInitiative(entries, tieBreak).map((s, index) => ({
            id: s.id,
            initiative: s.total,
            initiative_roll: s.roll,
            order_index: index,
          }));

    try {
      await api.setCombatInitiative(combat.id, updatePayload);
      const startRes = await api.updateCombat(combat.id, { action: 'start' });
      setCombat(startRes.combat);
      onRefreshCharacters();
    } catch (err: any) {
      alert(`行動順の確定に失敗しました: ${err.message}`);
    }
  };

  // 出目の入力を空に戻す。行動を反映したとき・手番が変わったとき（前の人の出目を使い回さない。Phase 5l）
  const resetRolls = () => {
    setRollFrom({});
    setAttackFirst(null);
    setAttackExtra(undefined);
    setDefenseFirst(null);
    setDefenseExtra(undefined);
    setDamageDiceStr('');
    setCritRoll(undefined);
    setLuckSpent(0);
    setExtraCritRoll(undefined);
    setSecondExtraCritRoll(undefined);
    setDeathSaveRoll(undefined);
    setSecondAttackFirst(null);
    setSecondAttackExtra(undefined);
    setSecondDamageDiceStr('');
    setSecondDefenseFirst(null);
    setSecondCritRoll(undefined);
    setNetAmbushIceRoll(null);
    setNetAmbushRunnerRoll(null);
  };
  useEffect(() => {
    resetRolls();
  }, [combat?.turn_index, combat?.round]);

  const buildNetInput = (damageDice: number[]) => {
    if (selectedActionKey === 'scanner') {
      return { scanner_dv: netScannerDv };
    }
    if (selectedActionKey === 'net_ice_attack') {
      return {
        target_ice_id: netTargetIceId || undefined,
      };
    }
    if (selectedActionKey === 'net_action') {
      const iceRolls =
        ['jack_in', 'descend'].includes(netSubAction) && netAmbushIceRoll !== null && netAmbushRunnerRoll !== null
          ? [
              {
                ice_roll: { first: netAmbushIceRoll },
                runner_roll: { first: netAmbushRunnerRoll },
                damage_dice: damageDice.length > 0 ? damageDice : undefined,
              },
            ]
          : undefined;
      return {
        sub_action: netSubAction as any,
        arch_id: netArchId || (activePart?.state as any)?.net?.arch_id || netArchList[0]?.id || undefined,
        target_floor: ['descend', 'backdoor', 'eyedee', 'control', 'operate_node', 'slide'].includes(netSubAction)
          ? netTargetFloor
          : undefined,
        program_key: ['activate', 'derez', 'program'].includes(netSubAction) ? netProgramKey : undefined,
        deactivate: netSubAction === 'derez' ? true : undefined,
        target_ice_id: ['program', 'zap', 'slide'].includes(netSubAction) ? netTargetIceId || undefined : undefined,
        virus_desc: netSubAction === 'virus' ? netVirusDesc : undefined,
        virus_dv: netSubAction === 'virus' ? netVirusDv : undefined,
        virus_actions: netSubAction === 'virus' ? netVirusActions : undefined,
        ice_rolls: iceRolls,
      };
    }
    return undefined;
  };

  // 1 ターンのアクション回数を変える（Phase 5j）
  const handleSetActions = async (participantId: string, data: { actions_per_turn?: number; bonus?: 1 | -1 }) => {
    if (!combat) return;
    try {
      const res = await api.setCombatActions(combat.id, participantId, data);
      setCombat(res.combat);
    } catch (err: any) {
      alert(`行動回数の変更に失敗しました: ${err.message}`);
    }
  };

  // Advance turn
  const handleNextTurn = async () => {
    if (!combat) return;
    try {
      setSelectedActionKey(null);
      setPreviewResult(null);
      const res = await api.updateCombat(combat.id, { action: 'next_turn' });
      setCombat(res.combat);
      onRefreshCharacters();
    } catch (err: any) {
      alert(`手番の進行に失敗しました: ${err.message}`);
    }
  };

  // End Combat
  const handleEndCombat = async () => {
    if (!combat) return;
    const deleteMooks = window.confirm('戦闘を終了します。複製したモブをキャラクターリストから削除しますか？\n（OK = 削除する, キャンセル = 残す）');
    try {
      const res = await api.updateCombat(combat.id, { action: 'end', deleteMooks });
      setCombat(res.combat);
      onRefreshCharacters();
    } catch (err: any) {
      alert(`戦闘の終了に失敗しました: ${err.message}`);
    }
  };

  // Calculate action preview
  const handleCalculateAction = async () => {
    if (!combat || !selectedActionKey) return;
    const activePart = combat.participants[combat.turn_index];
    if (!activePart) return;

    if (isCoverHpNeededAndMissing) {
      alert('遮蔽物のHPが未入力です。遮蔽物のHPを入力してください。');
      return;
    }

    setIsResolving(true);
    try {
      const damageDice = damageDiceStr
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 6);

      const manualChanges: CombatChange[] = [];
      if (manualHpChange && targetParticipantId) {
        const targetPart = combat.participants.find((p) => p.id === targetParticipantId);
        if (targetPart && targetPart.character) {
          const hpDiff = Number(manualHpChange);
          const newHp = Math.max(0, targetPart.character.hp + hpDiff);
          manualChanges.push({
            target_id: targetPart.character.id,
            target_name: targetPart.name,
            field: 'hp',
            before: targetPart.character.hp,
            after: newHp,
            desc: `${targetPart.name} HP ${targetPart.character.hp} → ${newHp} (${hpDiff > 0 ? `+${hpDiff}` : hpDiff})`,
          });
        }
      }

      const attacks: any[] = [
        {
          target_id: targetParticipantId || undefined,
          distance_m: distanceM ?? undefined,
          dodge_mode: dodgeMode,
          attack_roll: attackFirst !== null ? { first: attackFirst, extra: attackExtra } : undefined,
          defense_roll: dodgeMode === 'dodge' && defenseFirst !== null ? { first: defenseFirst, extra: defenseExtra } : undefined,
          damage_dice: damageDice.length > 0 ? damageDice : undefined,
          crit_injury_roll: critRoll,
          extra_crit_injury_roll: extraCritRoll,
          aimed_location: aimedLocation,
          held_item_id: heldItemId || undefined,
        },
      ];

      if (secondAttackEnabled) {
        const secondDamageDice = secondDamageDiceStr
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= 6);
        attacks.push({
          target_id: targetParticipantId || undefined,
          distance_m: distanceM ?? undefined,
          dodge_mode: dodgeMode,
          attack_roll: secondAttackFirst !== null ? { first: secondAttackFirst, extra: secondAttackExtra } : undefined,
          defense_roll: dodgeMode === 'dodge' && secondDefenseFirst !== null ? { first: secondDefenseFirst } : undefined,
          damage_dice: secondDamageDice.length > 0 ? secondDamageDice : undefined,
          crit_injury_roll: secondCritRoll,
          extra_crit_injury_roll: secondExtraCritRoll,
        });
      }

      const selectedWep = weaponEntries.find((w) => w.entry_id === selectedWeaponId);
      const ignoreArmorToSend =
        selectedActionKey === 'melee'
          ? typeof selectedWep?.ignore_armor_percent === 'number'
            ? selectedWep.ignore_armor_percent
            : meleeIgnoreArmorInput
          : undefined;

      const res = await api.resolveCombatAction(combat.id, {
        action_key: selectedActionKey,
        actor_id: activePart.id,
        target_id: targetParticipantId || undefined,
        distance_m: distanceM ?? undefined,
        weapon_id: selectedWeaponId || undefined,
        weapon_entry_id: selectedWeaponId || undefined,
        ignore_armor_percent: ignoreArmorToSend,
        aimed_location: selectedActionKey === 'attack_vehicle' ? (weakpoint ? 'weakpoint' : undefined) : aimedLocation,
        held_item_id: heldItemId || undefined,
        martial_style: martialStyle || undefined,
        technique: selectedActionKey === 'martial_technique' ? technique || undefined : selectedActionKey === 'stand' && kipUp ? 'kip_up' : undefined,
        grab_mode: selectedActionKey === 'grab' ? grabMode : undefined,
        aim_head: aimHead || undefined,
        luck_spent: luckSpent || undefined,
        hazard: selectedActionKey === 'hazard' ? hazardKey : undefined,
        hazard_level: selectedActionKey === 'hazard' ? hazardLevel : undefined,
        fall_m: selectedActionKey === 'hazard' && hazardKey === 'fall' && fallM !== '' ? Number(fallM) : undefined,
        hazard_status: selectedActionKey === 'hazard_end' ? hazardEndStatus || undefined : undefined,
        throw_entry_id: selectedActionKey === 'throw_object' ? throwEntryId || undefined : undefined,
        drug_entry_id: selectedActionKey === 'use_drug' ? drugEntryId || undefined : undefined,
        solo_alloc: selectedActionKey === 'solo_realloc' ? Object.fromEntries(Object.entries(soloAlloc).map(([k, v]) => [k, Number(v) || 0])) : undefined,
        vehicle_ref: selectedActionKey === 'vehicle_board' && vehRef ? JSON.parse(vehRef) : undefined,
        target_vehicle: ['vehicle_ram', 'attack_vehicle'].includes(selectedActionKey) && targetVeh ? JSON.parse(targetVeh) : undefined,
        as_driver: selectedActionKey === 'vehicle_board' ? asDriver : undefined,
        maneuver: selectedActionKey === 'vehicle_maneuver' ? maneuverKey : undefined,
        unwilling: selectedActionKey === 'use_drug' ? drugUnwilling : undefined,
        dodge_mode: dodgeMode,
        attack_roll: attackFirst !== null ? { first: attackFirst, extra: attackExtra } : undefined,
        suppressive_facing: selectedActionKey === 'suppressive' ? suppressiveFacing : undefined,
        suppressive_targets: selectedActionKey === 'suppressive' ? suppressiveTargetIds.map((participant_id) => ({ participant_id, resistance_roll: suppressiveRolls[participant_id]?.first ? suppressiveRolls[participant_id] : undefined })) : undefined,
        defense_roll: defenseFirst !== null ? { first: defenseFirst, extra: defenseExtra } : undefined,
        damage_dice: damageDice.length > 0 ? damageDice : undefined,
        crit_injury_roll: critRoll,
        extra_crit_injury_roll: extraCritRoll,
        death_save_roll: deathSaveRoll,
        attacks,
        manual_changes: manualChanges,
        manual_notes: manualNotes,
        destination: (selectedActionKey === 'move' || selectedActionKey === 'run') ? destination || undefined : undefined,
        force_move: forceMove,
        los_override: losOverride !== 'auto' ? losOverride : undefined,
        hit_cover: hitCover,
        cover_object_id: hitCover && (losInfo?.hitCoverObject?.id || coverObjectId) ? (losInfo?.hitCoverObject?.id || coverObjectId) : undefined,
        cover_current_hp: hitCover && coverHpInput !== '' ? Number(coverHpInput) : undefined,
        cover_damage: hitCover && coverDamageInput !== '' ? Number(coverDamageInput) : undefined,
        pickup_drop_id: selectedActionKey === 'pickup' ? pickupDropId || undefined : undefined,
        net: buildNetInput(damageDice),
      });

      setPreviewResult(res.result);
    } catch (err: any) {
      alert(`判定の計算に失敗しました: ${err.message}`);
    } finally {
      setIsResolving(false);
    }
  };

  // Commit and apply action
  const handleApplyAction = async () => {
    if (!combat || !selectedActionKey || !previewResult) return;
    const activePart = combat.participants[combat.turn_index];
    if (!activePart) return;

    setIsApplying(true);
    try {
      const damageDice = damageDiceStr
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 6);

      const attacks: any[] = [
        {
          target_id: targetParticipantId || undefined,
          distance_m: distanceM ?? undefined,
          dodge_mode: dodgeMode,
          attack_roll: attackFirst !== null ? { first: attackFirst, extra: attackExtra } : undefined,
          defense_roll: dodgeMode === 'dodge' && defenseFirst !== null ? { first: defenseFirst, extra: defenseExtra } : undefined,
          damage_dice: damageDice.length > 0 ? damageDice : undefined,
          crit_injury_roll: critRoll,
          extra_crit_injury_roll: extraCritRoll,
          aimed_location: aimedLocation,
          held_item_id: heldItemId || undefined,
        },
      ];

      if (secondAttackEnabled) {
        const secondDamageDice = secondDamageDiceStr
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= 6);
        attacks.push({
          target_id: targetParticipantId || undefined,
          distance_m: distanceM ?? undefined,
          dodge_mode: dodgeMode,
          attack_roll: secondAttackFirst !== null ? { first: secondAttackFirst, extra: secondAttackExtra } : undefined,
          defense_roll: dodgeMode === 'dodge' && secondDefenseFirst !== null ? { first: secondDefenseFirst } : undefined,
          damage_dice: secondDamageDice.length > 0 ? secondDamageDice : undefined,
          crit_injury_roll: secondCritRoll,
          extra_crit_injury_roll: secondExtraCritRoll,
        });
      }

      const selectedWep = weaponEntries.find((w) => w.entry_id === selectedWeaponId);
      const ignoreArmorToSend =
        selectedActionKey === 'melee'
          ? typeof selectedWep?.ignore_armor_percent === 'number'
            ? selectedWep.ignore_armor_percent
            : meleeIgnoreArmorInput
          : undefined;

      const res = await api.applyCombatAction(combat.id, {
        action_key: selectedActionKey,
        actor_id: activePart.id,
        target_id: targetParticipantId || undefined,
        distance_m: distanceM ?? undefined,
        weapon_id: selectedWeaponId || undefined,
        weapon_entry_id: selectedWeaponId || undefined,
        ignore_armor_percent: ignoreArmorToSend,
        aimed_location: selectedActionKey === 'attack_vehicle' ? (weakpoint ? 'weakpoint' : undefined) : aimedLocation,
        held_item_id: heldItemId || undefined,
        martial_style: martialStyle || undefined,
        technique: selectedActionKey === 'martial_technique' ? technique || undefined : selectedActionKey === 'stand' && kipUp ? 'kip_up' : undefined,
        grab_mode: selectedActionKey === 'grab' ? grabMode : undefined,
        aim_head: aimHead || undefined,
        luck_spent: luckSpent || undefined,
        hazard: selectedActionKey === 'hazard' ? hazardKey : undefined,
        hazard_level: selectedActionKey === 'hazard' ? hazardLevel : undefined,
        fall_m: selectedActionKey === 'hazard' && hazardKey === 'fall' && fallM !== '' ? Number(fallM) : undefined,
        hazard_status: selectedActionKey === 'hazard_end' ? hazardEndStatus || undefined : undefined,
        throw_entry_id: selectedActionKey === 'throw_object' ? throwEntryId || undefined : undefined,
        drug_entry_id: selectedActionKey === 'use_drug' ? drugEntryId || undefined : undefined,
        solo_alloc: selectedActionKey === 'solo_realloc' ? Object.fromEntries(Object.entries(soloAlloc).map(([k, v]) => [k, Number(v) || 0])) : undefined,
        vehicle_ref: selectedActionKey === 'vehicle_board' && vehRef ? JSON.parse(vehRef) : undefined,
        target_vehicle: ['vehicle_ram', 'attack_vehicle'].includes(selectedActionKey) && targetVeh ? JSON.parse(targetVeh) : undefined,
        as_driver: selectedActionKey === 'vehicle_board' ? asDriver : undefined,
        maneuver: selectedActionKey === 'vehicle_maneuver' ? maneuverKey : undefined,
        unwilling: selectedActionKey === 'use_drug' ? drugUnwilling : undefined,
        dodge_mode: dodgeMode,
        attack_roll: attackFirst !== null ? { first: attackFirst, extra: attackExtra } : undefined,
        suppressive_facing: selectedActionKey === 'suppressive' ? suppressiveFacing : undefined,
        suppressive_targets: selectedActionKey === 'suppressive' ? suppressiveTargetIds.map((participant_id) => ({ participant_id, resistance_roll: suppressiveRolls[participant_id]?.first ? suppressiveRolls[participant_id] : undefined })) : undefined,
        defense_roll: defenseFirst !== null ? { first: defenseFirst, extra: defenseExtra } : undefined,
        damage_dice: damageDice.length > 0 ? damageDice : undefined,
        crit_injury_roll: critRoll,
        extra_crit_injury_roll: extraCritRoll,
        death_save_roll: deathSaveRoll,
        attacks,
        manual_changes: previewResult.changes,
        manual_notes: manualNotes,
        destination: (selectedActionKey === 'move' || selectedActionKey === 'run') ? destination || undefined : undefined,
        force_move: forceMove,
        los_override: losOverride !== 'auto' ? losOverride : undefined,
        hit_cover: hitCover,
        cover_object_id: hitCover && (losInfo?.hitCoverObject?.id || coverObjectId) ? (losInfo?.hitCoverObject?.id || coverObjectId) : undefined,
        cover_current_hp: hitCover && coverHpInput !== '' ? Number(coverHpInput) : undefined,
        cover_damage: hitCover && coverDamageInput !== '' ? Number(coverDamageInput) : undefined,
        pickup_drop_id: selectedActionKey === 'pickup' ? pickupDropId || undefined : undefined,
        net: buildNetInput(damageDice),
      });

      setCombat(res.combat);
      if (combat.board_id) {
        refreshBoard(combat.board_id);
      }
      if (selectedActionKey === 'net_action') {
        refreshNetArchs();
      }
      setDestination(null);
      setDestinationFrom(null);
      setHitCover(false);
      setCoverDamageInput('');
      setPickupDropId(null);
      setPreviewResult(null);
      if (selectedActionKey !== 'net_action' || res.combat.turn_index !== combat.turn_index) {
        setSelectedActionKey(null);
      }
      setSecondAttackEnabled(false);
      resetRolls();
      onRefreshCharacters();
    } catch (err: any) {
      alert(`反映に失敗しました: ${err.message}`);
    } finally {
      setIsApplying(false);
    }
  };

  // Direct move confirm
  const handleConfirmMove = async () => {
    if (!combat || !activePart || !destination) return;
    setIsApplying(true);
    try {
      const res = await api.applyCombatAction(combat.id, {
        action_key: selectedActionKey || 'move',
        actor_id: activePart.id,
        participant_id: activePart.id,
        destination,
        force_move: forceMove,
      });
      setCombat(res.combat);
      if (combat.board_id) refreshBoard(combat.board_id);
      setDestination(null);
      setDestinationFrom(null);
      setSelectedActionKey(null);
      onRefreshCharacters();
    } catch (err: any) {
      alert(`移動の反映に失敗しました: ${err.message}`);
    } finally {
      setIsApplying(false);
    }
  };

  // Direct pickup confirm
  const handleConfirmPickup = async () => {
    if (!combat || !activePart || !pickupDropId) return;
    setIsApplying(true);
    try {
      const res = await api.applyCombatAction(combat.id, {
        action_key: 'pickup',
        actor_id: activePart.id,
        participant_id: activePart.id,
        pickup_drop_id: pickupDropId,
      });
      setCombat(res.combat);
      if (combat.board_id) refreshBoard(combat.board_id);
      setPickupDropId(null);
      setSelectedActionKey(null);
      onRefreshCharacters();
    } catch (err: any) {
      alert(`拾うアクションの反映に失敗しました: ${err.message}`);
    } finally {
      setIsApplying(false);
    }
  };

  // Undo latest action
  const handleUndo = async () => {
    if (!combat) return;
    if (!window.confirm('一手戻りますか？（直前の行動の反映、または手番送りを取り消します）')) return;

    try {
      const res = await api.undoCombatAction(combat.id);
      setCombat(res.combat);
      if (combat.board_id) {
        refreshBoard(combat.board_id);
      }
      setPreviewResult(null);
      onRefreshCharacters();
    } catch (err: any) {
      alert(`取り消しに失敗しました: ${err.message}`);
    }
  };

  // 出目欄の横の「〇〇のスマホから / 入力待ち」（仕様 §5.0.1。Phase 5n）。PC の出目は本人のスマホから届く。NPC は GM が入れる
  const rollSourceTag = (rollType: 'attack' | 'defense' | 'damage' | 'death_save') => {
    const from = rollFrom[rollType];
    if (from) return <span data-testid={`roll-from-${rollType}`} style={{ fontSize: '0.7rem', color: 'var(--color-ally)' }}>{from}のスマホから</span>;
    const cur = combat?.participants?.[combat.turn_index];
    const who = rollType === 'defense' ? combat?.participants.find((p) => p.id === targetParticipantId) : cur;
    if (who?.character?.kind !== 'pc') return null;
    return <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{who.name}のスマホ: 入力待ち</span>;
  };

  if (loading) {
    return <div style={{ padding: '24px', color: 'var(--color-text-muted)' }}>戦闘データを読み込み中...</div>;
  }

  const boardSection = (
    boardData ? (
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                盤面: {boardData.board.name}
              </span>
              {boardData.board.background_image_visibility === 'gm' && (
                <span style={{ fontSize: '0.75rem', color: 'var(--color-warning)', backgroundColor: 'rgba(235, 179, 58, 0.1)', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--color-warning)' }}>
                  ⚠ この背景は GM のみの画像です。TV に出すには公開設定を変えてください
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                type="button"
                onClick={handleAutoPlaceTokens}
                disabled={placingTokens}
                data-testid="board-auto-place"
                style={{
                  backgroundColor: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-border-light)',
                  color: 'var(--color-text)',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                未配置・盤面外のコマを自動配置
              </button>
              {boards.length > 1 && (
                <select
                  value={boardData.board.id}
                  onChange={(e) => handleSelectBoard(e.target.value)}
                  style={{
                    padding: '4px 8px',
                    backgroundColor: 'var(--color-bg)',
                    border: '1px solid var(--color-border-light)',
                    borderRadius: '4px',
                    color: 'var(--color-text)',
                    fontSize: '0.8rem',
                  }}
                >
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div style={{ fontWeight: 700 }}>参加者の名前を押すと、マップにコマが出ます</div>
          <div role="group" aria-label="マップに配置する参加者" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {combat?.participants.filter((p) => p.active && !p.out).map((p) => {
              const t = boardData.tokens.find((t) => t.character_id === (p.character_id || p.id));
              const outside = t && (t.x < 0 || t.y < 0 || t.x >= (boardData.board.grid?.cols || 20) || t.y >= (boardData.board.grid?.rows || 15));
              const placed = t && !outside;
              const focused = focusedMapParticipantId === p.id;
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'stretch', border: `1px solid ${focused ? 'var(--color-ally)' : 'var(--color-border-light)'}`, borderRadius: '6px', overflow: 'hidden', maxWidth: '100%' }}>
                  <button
                    type="button"
                    data-testid={`board-participant-${p.id}`}
                    aria-label={`${p.name}${placed ? 'の位置を表示' : 'をマップに置く'}`}
                    aria-pressed={focused}
                    disabled={placingTokens}
                    onClick={() => { void handleShowParticipantOnMap(p); }}
                    style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '8px 12px', border: 'none', color: 'var(--color-text)', backgroundColor: focused ? 'rgba(79, 182, 227, 0.15)' : 'var(--color-surface-elevated)', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <strong>{p.name}</strong>
                    <span style={{ fontSize: '0.8rem', color: placed ? 'var(--color-ally)' : 'var(--color-warning)' }}>{placed ? `配置済み (${t.x}, ${t.y})・押して位置を表示` : '未配置・押すとマップに置く'}</span>
                  </button>
                  <button
                    type="button"
                    data-testid={`board-place-cell-${p.id}`}
                    aria-label={`${p.name}の配置マスを指定`}
                    disabled={placingTokens}
                    onClick={() => { setPlacementParticipantId(p.id); setFocusedMapParticipantId(p.id); setPlacementMessage(`${p.name} を置くマスを、下のマップでクリックしてください。`); }}
                    style={{ padding: '6px 10px', border: 'none', borderLeft: '1px solid var(--color-border-light)', color: 'var(--color-text-muted)', backgroundColor: 'var(--color-surface)', cursor: 'pointer', fontSize: '0.8rem' }}
                  >マスを指定</button>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            {placementParticipantId ? <><strong>{combat?.participants.find((p) => p.id === placementParticipantId)?.name}</strong> を置くマスをクリックしてください。 <button type="button" disabled={placingTokens} onClick={() => { setPlacementParticipantId(''); setPlacementMessage(null); }}>キャンセル</button></> : '配置後はコマをドラッグして動かせます。マップは全範囲を表示しています。'}
            {!placementParticipantId && combat?.status === 'active' && (selectedActionKey === 'move' || selectedActionKey === 'run') && ' 手番のコマは移動先を指定してから「移動を確定して反映」を押してください。'}
          </div>
          {placementMessage && <div role="status" data-testid="board-placement-message">{placementMessage}</div>}

          <BoardView
            board={boardData.board}
            objects={boardData.objects}
            tokens={boardData.tokens}
            drops={boardData.drops}
            combat={combat}
            activeParticipantId={activePart?.id}
            selectedWeaponEntryId={selectedWeaponId}
            targetParticipantId={targetParticipantId}
            focusedParticipantId={focusedMapParticipantId}
            mode={placementParticipantId ? 'setup' : selectedActionKey === 'move' || selectedActionKey === 'run' ? 'move' : 'view'}
            onSelectCell={placementParticipantId ? (cell) => { void handlePlaceParticipant(cell); } : undefined}
            reachableCells={reachableCells}
            destination={destination}
            onSelectDestination={(dest) => {
              setDestination(dest);
              setDestinationFrom(null);
            }}
            losLine={
              losInfo
                ? {
                    x1: losInfo.x1,
                    y1: losInfo.y1,
                    x2: losInfo.x2,
                    y2: losInfo.y2,
                    status: losInfo.status,
                  }
                : null
            }
            isGm={true}
            onUpdateBoard={async (patch) => {
              await api.updateBoard(boardData.board.id, patch);
              refreshBoard(boardData.board.id);
            }}
            onUpdateObject={handleUpdateObject}
            onDeleteObject={handleDeleteObject}
            onCreateObject={handleCreateObject}
            onMoveToken={(id, x, y) => { void handleMoveToken(id, x, y).catch(() => undefined); }}
            onSelectDrop={(drop) => {
              setSelectedActionKey('pickup');
              setPickupDropId(drop.id);
            }}
            onSelectParticipant={(pid) => setTargetParticipantId(pid)}
          />
        </div>
      ) : (
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px dashed var(--color-border)',
            borderRadius: '8px',
            padding: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
            盤面が設定されていません。既存の盤面を選択するか、新規作成してください。
          </span>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {boards.length > 0 && (
              <select
                onChange={(e) => {
                  if (e.target.value) handleSelectBoard(e.target.value);
                }}
                defaultValue=""
                style={{
                  padding: '6px 10px',
                  backgroundColor: 'var(--color-bg)',
                  border: '1px solid var(--color-border-light)',
                  borderRadius: '4px',
                  color: 'var(--color-text)',
                  fontSize: '0.85rem',
                }}
              >
                <option value="" disabled>盤面を選択...</option>
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={handleCreateBoard}
              style={{
                backgroundColor: 'var(--color-ally)',
                color: '#000',
                border: 'none',
                padding: '6px 14px',
                borderRadius: '4px',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              + 盤面を作成
            </button>
          </div>
        </div>
      )
  );

  // --- 1. SETUP / PARTICIPANT CHECK VIEW ---
  if (!combat || combat.status === 'setup' || combat.status === 'ended') {
    // もう戦闘に入っているキャラ（複製したモブを含む）は出さない（Phase 5l）
    const inCombat = new Set((combat?.participants ?? []).map((p) => p.character_id));
    const npcList = characters.filter((c) => (c.kind === 'npc' || c.kind === 'mook') && !inCombat.has(c.id));

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            padding: '16px 20px',
          }}
        >
          <div>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>戦闘開始（参加者チェック）</h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              PC・NPCの参加者を選び、行動順を決めて戦闘を開始します。
            </p>
          </div>
          {!combat || combat.status === 'ended' ? (
            <button
              onClick={handleStartNewCombat}
              style={{
                backgroundColor: 'var(--color-ally)',
                color: '#000',
                border: 'none',
                borderRadius: '6px',
                padding: '10px 20px',
                fontWeight: 700,
                fontSize: '0.95rem',
                cursor: 'pointer',
              }}
            >
              戦闘を始める
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={handleConfirmInitiative}
                style={{
                  backgroundColor: 'var(--color-ally)',
                  color: '#000',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '10px 20px',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                }}
              >
                行動順を確定して戦闘開始
              </button>
            </div>
          )}
        </div>

        {combat && combat.status === 'setup' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '24px' }}>
            {/* Left: Participant Selection & List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* PC Section */}
              <div
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  padding: '16px',
                }}
              >
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 12px' }}>PC 参加者</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {combat.participants
                    .filter((p) => p.character?.kind === 'pc')
                    .map((p) => {
                      const char = p.character!;
                      return (
                        <div
                          key={p.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            backgroundColor: 'var(--color-surface-elevated)',
                            padding: '10px 14px',
                            borderRadius: '6px',
                            border: '1px solid var(--color-border-light)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <input
                              type="checkbox"
                              checked={p.active}
                              onChange={async (e) => {
                                const checked = e.target.checked;
                                await api.updateParticipant(combat.id, p.id, { active: checked });
                                refreshCombat();
                              }}
                              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                            />
                            <div
                              style={{
                                width: '36px',
                                height: '36px',
                                borderRadius: '50%',
                                backgroundColor: p.side === 'ally' ? 'rgba(79, 182, 227, 0.2)' : 'rgba(242, 140, 56, 0.2)',
                                border: `1px solid ${p.side === 'ally' ? 'var(--color-ally)' : 'var(--color-enemy)'}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 700,
                                color: p.side === 'ally' ? 'var(--color-ally)' : 'var(--color-enemy)',
                              }}
                            >
                              {p.name.charAt(0)}
                            </div>
                            <div>
                              <div style={{ fontWeight: 700 }}>{p.name}</div>
                              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                                {char.role} | HP {char.hp}/{char.hp_max} | REF {char.stats.ref}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>出目:</span>
                            <input
                              data-testid={`init-input-${p.name}`}
                              type="number"
                              min={1}
                              max={10}
                              placeholder="手動"
                              value={initInputs[p.character_id || p.id]?.first ?? phoneRoll(p)?.first ?? ''}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                setInitInputs((prev) => ({
                                  ...prev,
                                  [p.character_id || p.id]: { first: val },
                                }));
                              }}
                              style={{
                                width: '50px',
                                padding: '4px',
                                textAlign: 'center',
                                backgroundColor: 'var(--color-bg)',
                                border: '1px solid var(--color-border-light)',
                                borderRadius: '4px',
                                color: 'var(--color-text)',
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* NPC / Mook Addition */}
              <div
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  padding: '16px',
                }}
              >
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 12px' }}>NPC・モブの追加</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
                  <select
                    value={selectedNpcId}
                    onChange={(e) => setSelectedNpcId(e.target.value)}
                    style={{
                      padding: '8px 12px',
                      backgroundColor: 'var(--color-bg)',
                      border: '1px solid var(--color-border-light)',
                      borderRadius: '4px',
                      color: 'var(--color-text)',
                      flex: 1,
                      minWidth: '180px',
                    }}
                  >
                    <option value="">NPC/モブを選択...</option>
                    {npcList.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name} ({n.kind === 'mook' ? 'モブ' : 'NPC'} / {n.role})
                      </option>
                    ))}
                  </select>

                  {selectedNpcId && characters.find((c) => c.id === selectedNpcId)?.kind === 'mook' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '0.85rem' }}>人数:</span>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={mookCount}
                        onChange={(e) => setMookCount(Number(e.target.value) || 1)}
                        style={{
                          width: '50px',
                          padding: '6px',
                          textAlign: 'center',
                          backgroundColor: 'var(--color-bg)',
                          border: '1px solid var(--color-border-light)',
                          borderRadius: '4px',
                          color: 'var(--color-text)',
                        }}
                      />
                    </div>
                  )}

                  <button
                    onClick={() => handleAddNpcToCombat('enemy')}
                    disabled={!selectedNpcId}
                    style={{
                      backgroundColor: 'var(--color-enemy)',
                      color: '#000',
                      border: 'none',
                      padding: '8px 14px',
                      borderRadius: '4px',
                      fontWeight: 700,
                      cursor: selectedNpcId ? 'pointer' : 'not-allowed',
                      opacity: selectedNpcId ? 1 : 0.5,
                    }}
                  >
                    敵として追加
                  </button>
                  <button
                    onClick={() => handleAddNpcToCombat('ally')}
                    disabled={!selectedNpcId}
                    style={{
                      backgroundColor: 'var(--color-ally)',
                      color: '#000',
                      border: 'none',
                      padding: '8px 14px',
                      borderRadius: '4px',
                      fontWeight: 700,
                      cursor: selectedNpcId ? 'pointer' : 'not-allowed',
                      opacity: selectedNpcId ? 1 : 0.5,
                    }}
                  >
                    味方として追加
                  </button>
                </div>

                {/* NPC / Mooks Current List */}
                <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {combat.participants
                    .filter((p) => p.character?.kind !== 'pc')
                    .map((p) => (
                      <div
                        key={p.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          backgroundColor: 'var(--color-surface-elevated)',
                          padding: '8px 12px',
                          borderRadius: '4px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span
                            style={{
                              fontSize: '0.75rem',
                              padding: '2px 6px',
                              borderRadius: '3px',
                              backgroundColor: p.side === 'ally' ? 'rgba(79, 182, 227, 0.2)' : 'rgba(242, 140, 56, 0.2)',
                              color: p.side === 'ally' ? 'var(--color-ally)' : 'var(--color-enemy)',
                              fontWeight: 700,
                            }}
                          >
                            {p.side === 'ally' ? '味方' : '敵'}
                          </span>
                          <span style={{ fontWeight: 700 }}>{p.name}</span>
                          {p.character && (
                            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                              HP {p.character.hp}/{p.character.hp_max}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={async () => {
                            await api.deleteParticipant(combat.id, p.id);
                            refreshCombat();
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--color-danger)',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                          }}
                        >
                          削除
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* Right: Initiative Settings */}
            <div
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
            >
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>イニシアチブ設定</h3>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                <input
                  type="checkbox"
                  checked={autoRollAll}
                  onChange={(e) => setAutoRollAll(e.target.checked)}
                />
                全員自動でダイスを振る
              </label>

              <div>
                <label style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: '4px' }}>
                  同値の解決:
                </label>
                <select
                  value={tieBreakMode}
                  onChange={(e) => setTieBreakMode(e.target.value as 'reroll' | 'ref')}
                  style={{
                    width: '100%',
                    padding: '6px',
                    backgroundColor: 'var(--color-bg)',
                    border: '1px solid var(--color-border-light)',
                    borderRadius: '4px',
                    color: 'var(--color-text)',
                  }}
                >
                  <option value="reroll">同じ値の人どうしで振り直す（ルール）</option>
                  <option value="ref">REF の高い順（ハウスルール）</option>
                </select>
              </div>

              <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                参加者のREF + 1d10で順番を決定します。未入力のPCはプレイヤーのスマホ行動画面からも出目を送信できます。
              </div>

              <button
                onClick={handleConfirmInitiative}
                style={{
                  marginTop: 'auto',
                  backgroundColor: 'var(--color-ally)',
                  color: '#000',
                  border: 'none',
                  padding: '12px',
                  borderRadius: '6px',
                  fontWeight: 800,
                  fontSize: '1rem',
                  cursor: 'pointer',
                }}
              >
                行動順を確定して戦闘開始
              </button>
            </div>
          </div>
        )}
        {combat?.status === 'setup' && boardSection}
      </div>
    );
  }

  // --- 2. ACTIVE COMBAT VIEW ---
  if (!activePart) return null;
  const allies = combat.participants.filter((p) => p.side === 'ally');
  const enemies = combat.participants.filter((p) => p.side === 'enemy');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Header & Turn Bar */}
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          padding: '14px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: '1.2rem',
                fontWeight: 800,
                color: 'var(--color-ally)',
                whiteSpace: 'nowrap',
              }}
            >
              ラウンド {combat.round}
            </span>
            <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
              手番: <strong>{activePart ? activePart.name : '—'}</strong>
            </span>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {!isStandaloneWindow && (
              <button
                type="button"
                onClick={() => window.open('/gm/combat', 'cpgm_combat', 'width=1280,height=900')}
                style={{
                  backgroundColor: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-border-light)',
                  color: 'var(--color-text)',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                別ウィンドウで開く
              </button>
            )}

            <button
              type="button"
              onClick={async () => {
                const nextVal = !isTvBroadcasting;
                setIsTvBroadcasting(nextVal);
                if (combat) {
                  try {
                    await api.updateCombat(combat.id, {
                      settings: { broadcastToTv: nextVal },
                    });
                  } catch (err) {
                    console.warn('Failed to update TV broadcast setting:', err);
                  }
                }
              }}
              style={{
                backgroundColor: isTvBroadcasting ? 'rgba(79, 182, 227, 0.2)' : 'var(--color-surface-elevated)',
                border: `1px solid ${isTvBroadcasting ? 'var(--color-ally)' : 'var(--color-border-light)'}`,
                color: isTvBroadcasting ? 'var(--color-ally)' : 'var(--color-text-muted)',
                padding: '6px 12px',
                borderRadius: '4px',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              TVに出す: {isTvBroadcasting ? 'ON' : 'OFF'}
            </button>

            {/* プレイヤーのスマホに残弾を見せるか（Phase 5r）。GM にはいつも見える */}
            <button
              type="button"
              onClick={async () => {
                if (!combat) return;
                const nextVal = combat.settings?.playerAmmoVisible === false;
                try {
                  const res = await api.updateCombat(combat.id, { settings: { playerAmmoVisible: nextVal } });
                  if (res?.combat) setCombat(res.combat);
                } catch (err) {
                  console.warn('Failed to update ammo visibility:', err);
                }
              }}
              title="プレイヤーのスマホに自分の残弾を見せるか。GM にはいつも見えます"
              style={{
                backgroundColor: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border-light)',
                color: combat?.settings?.playerAmmoVisible === false ? 'var(--color-text-muted)' : 'var(--color-ally)',
                padding: '6px 12px',
                borderRadius: '4px',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              スマホに残弾: {combat?.settings?.playerAmmoVisible === false ? '見せない' : '見せる'}
            </button>

            {/* 状態異常・弾切れなどの告知（Phase 5r） */}
            {notices.length > 0 && (
              <div
                data-testid="combat-notices"
                style={{ position: 'fixed', right: '16px', bottom: '16px', zIndex: 50, display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '360px' }}
              >
                {notices.slice(0, 5).map((n) => (
                  <div
                    key={n.at + n.body}
                    style={{ padding: '8px 10px', backgroundColor: 'var(--color-surface-elevated)', border: '1px solid var(--color-warning)', borderRadius: '6px', fontSize: '0.85rem', boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                      <strong style={{ color: 'var(--color-warning)' }}>{n.title}</strong>
                      <button
                        type="button"
                        aria-label="告知を閉じる"
                        onClick={() => setNotices((prev) => prev.filter((x) => x !== n))}
                        style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}
                      >
                        ×
                      </button>
                    </div>
                    <div>{n.body}</div>
                  </div>
                ))}
              </div>
            )}

            {sessionCode && (
              <a
                href={`/screen?code=${sessionCode}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  color: 'var(--color-ally)',
                  fontSize: '0.85rem',
                  textDecoration: 'none',
                  padding: '6px 10px',
                  border: '1px solid var(--color-border-light)',
                  borderRadius: '4px',
                  backgroundColor: 'var(--color-surface-elevated)',
                }}
              >
                TV共有URL ↗
              </a>
            )}

            <button
              onClick={handleUndo}
              style={{
                backgroundColor: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border-light)',
                color: 'var(--color-text)',
                padding: '6px 14px',
                borderRadius: '4px',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              title="直前の行動の反映、または手番送りを取り消します。何度でも戻れます"
            >
              ↶ 一手戻る
            </button>
            <button
              onClick={() => setShowJoinDialog(true)}
              style={{
                backgroundColor: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                padding: '6px 12px',
                borderRadius: '4px',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              参加者を足す
            </button>
            {/* 支援要員・トラウマ・チームを入れる（Phase 5x。p.158・224） */}
            <select aria-label="支援要員のランク" value={backupTierSel} onChange={(e) => setBackupTierSel(e.target.value)} style={{ padding: '6px', fontSize: '0.85rem', backgroundColor: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'var(--color-text)' }}>
              {BACKUP_TIERS.map((t) => (
                <option key={t} value={t}>
                  支援要員 ランク {t}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={async () => {
                if (!combat) return;
                const res = await gmFetch(`/api/combats/${combat.id}/squad`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'lawman', tier: backupTierSel }) }).then((r) => r.json());
                if (res.error) alert(res.error);
                else setCombat(res.combat);
              }}
              style={{ backgroundColor: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', padding: '6px 12px', borderRadius: '4px', fontSize: '0.85rem', cursor: 'pointer' }}
            >
              支援要員を入れる
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!combat) return;
                const res = await gmFetch(`/api/combats/${combat.id}/squad`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'trauma' }) }).then((r) => r.json());
                if (res.error) alert(res.error);
                else setCombat(res.combat);
              }}
              style={{ backgroundColor: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', padding: '6px 12px', borderRadius: '4px', fontSize: '0.85rem', cursor: 'pointer' }}
            >
              トラウマ・チームを入れる
            </button>
            <button
              onClick={handleNextTurn}
              style={{
                backgroundColor: 'var(--color-ally)',
                color: '#000',
                border: 'none',
                padding: '6px 16px',
                borderRadius: '4px',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              手番終了 → 次の参加者へ
            </button>
            <button
              onClick={handleEndCombat}
              style={{
                backgroundColor: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-danger)',
                color: 'var(--color-danger)',
                padding: '6px 12px',
                borderRadius: '4px',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              戦闘を終える
            </button>
          </div>
        </div>

        {/* Initiative Order Horizontal Bar */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            overflowX: 'auto',
            paddingBottom: '4px',
          }}
        >
          {combat.participants.map((p, idx) => {
            const isTurn = idx === combat.turn_index;
            const isDead = p.out;
            return (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  backgroundColor: isTurn ? 'rgba(79, 182, 227, 0.15)' : 'var(--color-surface-elevated)',
                  border: isTurn ? '2px solid var(--color-ally)' : '1px solid var(--color-border-light)',
                  opacity: isDead ? 0.4 : 1,
                  borderRadius: '6px',
                  padding: '6px 12px',
                  minWidth: '130px',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: p.side === 'ally' ? 'rgba(79, 182, 227, 0.2)' : 'rgba(242, 140, 56, 0.2)',
                    color: p.side === 'ally' ? 'var(--color-ally)' : 'var(--color-enemy)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                  }}
                >
                  {p.name.charAt(0)}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: isTurn ? 800 : 600, whiteSpace: 'nowrap' }}>
                    {p.name}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    イニシア {p.initiative}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {boardSection}

      {/* Mobile Tab Switcher */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
        }}
      >
        <button
          onClick={() => setMobileSideTab('ally')}
          style={{
            flex: 1,
            padding: '8px',
            borderRadius: '4px',
            border: mobileSideTab === 'ally' ? '2px solid var(--color-ally)' : '1px solid var(--color-border-light)',
            backgroundColor: mobileSideTab === 'ally' ? 'rgba(79, 182, 227, 0.2)' : 'var(--color-surface)',
            color: mobileSideTab === 'ally' ? 'var(--color-ally)' : 'var(--color-text-muted)',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          味方 ({allies.length})
        </button>
        <button
          onClick={() => setMobileSideTab('enemy')}
          style={{
            flex: 1,
            padding: '8px',
            borderRadius: '4px',
            border: mobileSideTab === 'enemy' ? '2px solid var(--color-enemy)' : '1px solid var(--color-border-light)',
            backgroundColor: mobileSideTab === 'enemy' ? 'rgba(242, 140, 56, 0.2)' : 'var(--color-surface)',
            color: mobileSideTab === 'enemy' ? 'var(--color-enemy)' : 'var(--color-text-muted)',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          敵 ({enemies.length})
        </button>
      </div>

      {/* Main Combat Content Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
        {/* Ally Participant Cards (hidden on mobile if enemy tab selected) */}
        <div style={{ display: mobileSideTab === 'ally' ? 'flex' : 'none', flexDirection: 'column', gap: '12px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--color-ally)' }}>味方</h3>
          {allies.map((p) => renderParticipantCard(p, p.id === activePart?.id))}
        </div>

        {/* Center: Turn Action Guide (GM Interactive) */}
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {activePart ? (
            <>
              <div>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>現在の手番:</span>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '2px 0 0' }}>{activePart.name} のターンです</h2>
                {Boolean(activePart.state?.suppressive_move_to_cover) && <div data-testid="suppressive-move-warning" role="alert" style={{padding:8,marginTop:6,border:'2px solid var(--color-warning)',borderRadius:6,color:'var(--color-warning)',fontWeight:700}}>制圧中: 次の移動アクションは遮蔽へ。1 回で届かなければ、可能な限り近づくため速足も必要です。</div>}
                <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '0.85rem' }}>
                  <span style={{ color: activePart.move_used ? 'var(--color-text-muted)' : 'var(--color-ally)' }}>
                    移動アクション: {activePart.move_used ? '使用済み' : '未使用'}
                  </span>
                  <span style={{ color: activePart.action_used ? 'var(--color-text-muted)' : 'var(--color-ally)' }}>
                    アクション: {activePart.action_used ? '使用済み' : '未使用'}
                    {actionsAllowedOf(activePart) > 1 && ` (${Number(activePart.state?.actions_taken ?? 0)}/${actionsAllowedOf(activePart)} 回)`}
                  </span>
                </div>
                <div style={{ marginTop: 8, padding: '8px 10px', borderLeft: '3px solid var(--color-ally)', background: 'var(--color-surface-elevated)', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  行動の結果を確定しても、移動が未使用なら手番は続きます。移動をしない場合は「手番終了 → 次の参加者へ」を押してください。
                </div>
                {/* 2 回行動など（Phase 5j）。移動とアクションを使い切ると自動で次の手番へ */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px', fontSize: '0.8rem', flexWrap: 'wrap' }}>
                  <label style={{ color: 'var(--color-text-muted)' }}>
                    毎ターンの行動回数:{' '}
                    <select
                      data-testid="actions-per-turn"
                      value={Number(activePart.state?.actions_per_turn ?? 1)}
                      onChange={(e) => handleSetActions(activePart.id, { actions_per_turn: Number(e.target.value) })}
                    >
                      {[1, 2, 3].map((n) => (
                        <option key={n} value={n}>
                          {n} 回
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => handleSetActions(activePart.id, { bonus: 1 })}
                    style={{ padding: '2px 8px', fontSize: '0.8rem' }}
                  >
                    +1 アクション（このターンだけ）
                  </button>
                  {Number(activePart.state?.bonus_actions ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => handleSetActions(activePart.id, { bonus: -1 })}
                      style={{ padding: '2px 8px', fontSize: '0.8rem' }}
                    >
                      −1
                    </button>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-muted)', display: 'block', marginBottom: '8px' }}>
                  行動を選択:
                </span>
                {showVehicleActions ? <button type="button" onClick={() => setShowVehicleActions(false)} style={{ marginBottom: 8 }}>← 戻る</button> : null}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {(showVehicleActions ? VEHICLE_ACTIONS : actions.filter((act) => !isVehicleAction(act.key))).map((act) => {
                    const isSelected = selectedActionKey === act.key;
                    const blocked = blockedMessage(act.key, act.label);
                    const diceFormula = ['brawl', 'martial_arts'].includes(act.key) ? combatDamageFormula(act.key, activePart.character) : null;
                    return (
                      <ActionButton
                        key={act.key}
                        data-testid={`action-btn-${act.key}`}
                        reason={blocked}
                        onClick={() => {
                          if (blocked) return;
                          setBlockedActionMsg(null);
                          setSelectedActionKey(act.key);
                          setPreviewResult(null);
                        }}
                        style={{
                          ...(blocked ? blockedButtonStyle : {}),
                          backgroundColor: isSelected ? 'var(--color-ally)' : 'var(--color-surface-elevated)',
                          color: isSelected ? '#000' : 'var(--color-text)',
                          border: isSelected ? 'none' : '1px solid var(--color-border-light)',
                          padding: '6px 12px',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                          fontWeight: isSelected ? 800 : 500,
                          cursor: blocked ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {act.label}{diceFormula ? ` ${diceFormula}` : ''}
                      </ActionButton>
                    );
                  })}
                  {!showVehicleActions && <button data-testid="action-btn-vehicle" onClick={() => setShowVehicleActions(true)} style={{ padding: '6px 12px', borderRadius: 4, fontSize: '0.85rem' }}>車両</button>}
                </div>
                {blockedActionMsg && (
                  <div
                    data-testid="action-blocked-message"
                    role="alert"
                    style={{
                      marginTop: '8px',
                      padding: '8px 10px',
                      border: '1px solid var(--color-enemy)',
                      borderRadius: '4px',
                      color: 'var(--color-enemy)',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '8px',
                    }}
                  >
                    <span>{blockedActionMsg}</span>
                    <button
                      type="button"
                      aria-label="閉じる"
                      onClick={() => setBlockedActionMsg(null)}
                      style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>

              {/* Action Guide Details */}
              {selectedActionKey && (
                <div
                  style={{
                    backgroundColor: 'var(--color-surface-elevated)',
                    border: '1px solid var(--color-border-light)',
                    borderRadius: '6px',
                    padding: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  {/* Action Description */}
                  {(() => {
                    const actDef = actions.find((a) => a.key === selectedActionKey);
                    return actDef ? (
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{actDef.label}</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '2px', lineHeight: 1.4 }}>
                          {actDef.desc}
                        </div>
                        {actDef.status === 'unconfirmed' && (
                          <div
                            style={{
                              marginTop: '6px',
                              padding: '6px 10px',
                              backgroundColor: 'rgba(235, 179, 58, 0.15)',
                              borderLeft: '3px solid var(--color-warning)',
                              fontSize: '0.8rem',
                              color: 'var(--color-warning)',
                            }}
                          >
                            ルール確認中（Issue #{actDef.issue}）。結果は GM が手動で入力してください。
                          </div>
                        )}
                      </div>
                    ) : null;
                  })()}

                  {/* Movement Action Guide */}
                  {['move', 'run'].includes(selectedActionKey) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                        盤面の青いマスをクリックして移動先を選択してください。
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.9rem' }}>
                        <span>
                          移動先: <strong>{destination ? `(${destination.x}, ${destination.y})` : '未選択'}</strong>
                          {destination && destinationFrom && (
                            <span data-testid="player-destination-label" style={{ marginLeft: '6px', color: 'var(--color-ally)', fontSize: '0.8rem' }}>
                              （プレイヤーが選んだ移動先: {destinationFrom}）
                            </span>
                          )}
                        </span>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.85rem' }}>
                          <input
                            type="checkbox"
                            checked={forceMove}
                            onChange={(e) => setForceMove(e.target.checked)}
                          />
                          強制移動 (GM: 障害物・移動範囲を無視)
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={handleConfirmMove}
                        disabled={!destination || isApplying}
                        style={{
                          backgroundColor: destination ? 'var(--color-ally)' : 'var(--color-surface)',
                          color: destination ? '#000' : 'var(--color-text-muted)',
                          border: 'none',
                          padding: '10px',
                          borderRadius: '4px',
                          fontWeight: 700,
                          cursor: destination ? 'pointer' : 'not-allowed',
                        }}
                      >
                        {isApplying ? '移動反映中...' : '移動を確定して反映'}
                      </button>
                    </div>
                  )}

                  {/* Pickup Action Guide */}
                  {selectedActionKey === 'pickup' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                        足元または隣接マスにある落とし物を所持品に戻します。
                      </div>
                      {nearbyDrops.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>拾うアイテムを選択:</span>
                          <select
                            value={pickupDropId || ''}
                            onChange={(e) => setPickupDropId(e.target.value)}
                            style={{
                              padding: '6px 10px',
                              backgroundColor: 'var(--color-bg)',
                              border: '1px solid var(--color-border-light)',
                              borderRadius: '4px',
                              color: 'var(--color-text)',
                            }}
                          >
                            <option value="">落とし物を選択...</option>
                            {nearbyDrops.map((d) => {
                              const name = (d.inventory_entry as any)?.name || 'アイテム';
                              return (
                                <option key={d.id} value={d.id}>
                                  {name} ({d.x}, {d.y})
                                </option>
                              );
                            })}
                          </select>
                          <button
                            type="button"
                            onClick={handleConfirmPickup}
                            disabled={!pickupDropId || isApplying}
                            style={{
                              backgroundColor: pickupDropId ? 'var(--color-ally)' : 'var(--color-surface)',
                              color: pickupDropId ? '#000' : 'var(--color-text-muted)',
                              border: 'none',
                              padding: '10px',
                              borderRadius: '4px',
                              fontWeight: 700,
                              cursor: pickupDropId ? 'pointer' : 'not-allowed',
                            }}
                          >
                            {isApplying ? '反映中...' : '拾って所持品に戻す'}
                          </button>
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.85rem', color: 'var(--color-warning)' }}>
                          足元・隣接マスに拾える落とし物はありません。
                        </div>
                      )}
                    </div>
                  )}

                  {/* ヴィークル（Phase 5y。日本語版 p.189〜193） */}
                  {(selectedActionKey.startsWith('vehicle_') || selectedActionKey === 'attack_vehicle') && (() => {
                    const all = combat.participants.flatMap((p) =>
                      ((p.character?.extra?.vehicles ?? []) as Array<{ id: string; name: string; sdp: number; sdp_max: number; sp: number; out_of_control?: boolean }>).map((v) => ({ owner: p.character!.id, ownerName: p.name, v })),
                    );
                    const field: React.CSSProperties = { padding: '4px 6px', fontSize: '0.85rem', borderRadius: '4px', border: '1px solid var(--color-border-light)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' };
                    const pick = (value: string, set: (s: string) => void, label: string) => (
                      <select aria-label={label} value={value} onChange={(e) => set(e.target.value)} style={field}>
                        <option value="">{label}</option>
                        {all.map(({ owner, ownerName, v }) => (
                          <option key={v.id} value={JSON.stringify({ owner_id: owner, vehicle_id: v.id })}>
                            {v.name}（{ownerName}、SDP {v.sdp}/{v.sdp_max}{v.sp ? `、SP ${v.sp}` : ''}{v.out_of_control ? '、制御不能' : ''}）
                          </option>
                        ))}
                      </select>
                    );
                    return (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                        {all.length === 0 && <span style={{ color: 'var(--color-text-muted)' }}>参加者のだれもヴィークルを持っていません（PC タブの編集の「ヴィークル・知名度」で持たせる）</span>}
                        {selectedActionKey === 'vehicle_board' && (
                          <>
                            {pick(vehRef, setVehRef, '乗るヴィークル')}
                            <label>
                              <input type="checkbox" checked={asDriver} onChange={(e) => setAsDriver(e.target.checked)} /> 運転席
                            </label>
                          </>
                        )}
                        {selectedActionKey === 'vehicle_maneuver' && (
                          <select aria-label="特殊機動" value={maneuverKey} onChange={(e) => setManeuverKey(e.target.value)} style={field}>
                            {MANEUVERS.map((m) => (
                              <option key={m.key} value={m.key}>
                                {m.name}（難易度 {m.dv}）
                              </option>
                            ))}
                          </select>
                        )}
                        {(selectedActionKey === 'vehicle_control' || selectedActionKey === 'vehicle_maneuver') && <span style={{ color: 'var(--color-text-muted)' }}>出目は「攻撃」の欄に入れます</span>}
                        {selectedActionKey === 'vehicle_ram' && (
                          <>
                            {pick(targetVeh, setTargetVeh, '体当たりするヴィークル（人なら対象を選ぶ）')}
                            <span style={{ color: 'var(--color-text-muted)' }}>6d6 は「ダメージ出目」、歩行者が避けるなら回避の出目を「回避」に</span>
                          </>
                        )}
                        {selectedActionKey === 'attack_vehicle' && (
                          <>
                            {pick(targetVeh, setTargetVeh, '攻撃するヴィークル')}
                            <label>
                              <input type="checkbox" checked={weakpoint} onChange={(e) => setWeakpoint(e.target.checked)} /> 弱点を狙う（−8、SP を引いたあと 2 倍）
                            </label>
                          </>
                        )}
                      </div>
                    );
                  })()}

                  {/* ネットラン（Phase 5z。日本語版 p.198〜216） */}
                  {['net_action', 'net_ice_attack', 'scanner'].includes(selectedActionKey) && (() => {
                    const field: React.CSSProperties = {
                      padding: '4px 6px',
                      fontSize: '0.85rem',
                      borderRadius: '4px',
                      border: '1px solid var(--color-border-light)',
                      backgroundColor: 'var(--color-bg)',
                      color: 'var(--color-text)',
                    };
                    if (selectedActionKey === 'scanner') {
                      return (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                          <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            スキャナ探知の難易度 (DV):
                            <input
                              data-testid="net-scanner-dv"
                              type="number"
                              min={1}
                              value={netScannerDv}
                              onChange={(e) => setNetScannerDv(Number(e.target.value) || 13)}
                              style={{ ...field, width: '64px' }}
                            />
                          </label>
                          <span style={{ color: 'var(--color-text-muted)' }}>
                            TECH + 〈電子／セキュリティ技術〉（+ テク現場エンジニア）+ 1d10。出目は「攻撃」の欄に入れます。
                          </span>
                        </div>
                      );
                    }

                    if (selectedActionKey === 'net_ice_attack') {
                      const tPart = combat.participants.find((p) => p.id === targetParticipantId) ?? activePart;
                      const tNet = (tPart?.state as any)?.net as NetRunState | undefined;
                      const activeIces = (tNet?.active_ice ?? []).filter((x) => x.rez > 0);
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.85rem' }}>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span>攻撃するブラック ICE:</span>
                            <select
                              data-testid="net-ice-attack-select"
                              value={netTargetIceId}
                              onChange={(e) => setNetTargetIceId(e.target.value)}
                              style={field}
                            >
                              {activeIces.map((ai) => (
                                <option key={ai.id} value={ai.id}>
                                  {ai.name} (第{ai.floor}階層 / REZ {ai.rez}/{ai.rez_max} / ATK {ai.atk})
                                </option>
                              ))}
                              {BLACK_ICE_CATALOG.map((ice) => (
                                <option key={ice.en} value={ice.en}>
                                  {ice.name} ({ice.en} / ATK {ice.atk})
                                </option>
                              ))}
                            </select>
                          </div>
                          <span style={{ color: 'var(--color-text-muted)' }}>
                            対象ネットランナーを下の「対象を選択」で選び、ICE の出目を「攻撃」、ネットランナーの防御出目を「回避」、効果ダイスを「ダメージ出目」に入れます。
                          </span>
                        </div>
                      );
                    }

                    // net_action
                    const curNet = ((activePart.state as any)?.net ?? {}) as Partial<NetRunState>;
                    const rank =
                      (activePart.character ? roleRank(activePart.character.role, activePart.character.extra, 'Netrunner') : 0) ||
                      Number((activePart.character?.extra as any)?.role_ranks?.Netrunner ?? (activePart.character?.skills as any)?.interface ?? 4);
                    const maxNet = netActionsForRank(rank, Boolean(curNet.slowed));
                    const netUsed = Number(curNet.net_used ?? 0);
                    const netRemaining = Math.max(0, maxNet - netUsed);
                    const activeArchId = curNet.arch_id || netArchId || netArchList[0]?.id || '';
                    const activeArch = netArchList.find((a) => a.id === activeArchId) ?? null;
                    const rezzedList = curNet.rezzed ?? [];
                    const activeIces = (curNet.active_ice ?? []).filter((x) => x.rez > 0);
                    const revealedSet = new Set<number>(curNet.revealed ?? []);
                    const unlockedSet = new Set<number>(curNet.unlocked_passwords ?? []);
                    const identifiedSet = new Set<number>(curNet.identified_files ?? []);
                    const controlledSet = new Set<string>(curNet.controlled ?? []);
                    const deck = ((activePart.character?.extra as any)?.cyberdeck ?? { slots: 7, programs: [], hardware: [] }) as NetDeckConfig;

                    // ジャックインまたは階層移動で入る階層にブラックICEがいるか
                    const enteringFloorNum = netSubAction === 'jack_in' ? 1 : netSubAction === 'descend' ? netTargetFloor : 0;
                    const enteringFloor = activeArch?.floors.find((f) => f.floor === enteringFloorNum);
                    const enteringFloorHasIce = Boolean(enteringFloor?.ice && enteringFloor.ice.length > 0);

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.85rem' }}>
                        {/* 欄の上の状態・地図パネル */}
                        <div
                          data-testid="netrun-combat-status"
                          style={{
                            padding: '10px',
                            backgroundColor: 'var(--color-bg)',
                            border: '1px solid var(--color-ally)',
                            borderRadius: '6px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                            <div>
                              <strong style={{ color: 'var(--color-ally)' }}>
                                {curNet.jacked_in ? `ジャックイン中: 第 ${curNet.depth ?? 1} 階層` : '未接続（ジャックアウト中）'}
                              </strong>
                              {activeArch && <span style={{ marginLeft: '8px', color: 'var(--color-text-muted)' }}>[{activeArch.name}]</span>}
                            </div>
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                              <span data-testid="netrun-remaining-actions" style={{ fontWeight: 700 }}>
                                NET アクション残り: {netRemaining} / {maxNet} 回
                              </span>
                              {curNet.jacked_in && (
                                <button
                                  type="button"
                                  data-testid="unsafe-jack-out-btn"
                                  onClick={() => setNetSubAction('unsafe_jack_out')}
                                  style={{
                                    padding: '2px 8px',
                                    fontSize: '0.78rem',
                                    backgroundColor: 'rgba(235, 75, 75, 0.2)',
                                    color: 'var(--color-danger)',
                                    border: '1px solid var(--color-danger)',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                  }}
                                >
                                  ネットランから外れる
                                </button>
                              )}
                            </div>
                          </div>

                          <div data-testid="netrun-rezzed-list" style={{ fontSize: '0.82rem' }}>
                            <span style={{ color: 'var(--color-text-muted)' }}>起動中プログラム: </span>
                            {rezzedList.length > 0
                              ? rezzedList.map((r, i) => (
                                  <span key={`${r.key}-${i}`} style={{ marginRight: '8px', fontWeight: 600 }}>
                                    {r.name} (REZ {r.rez}/{r.rez_max})
                                  </span>
                                ))
                              : 'なし'}
                          </div>

                          {activeIces.length > 0 && (
                            <div data-testid="netrun-active-ice-list" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.82rem' }}>
                              <span style={{ color: 'var(--color-danger)', fontWeight: 700 }}>遭遇中ブラック ICE:</span>
                              {activeIces.map((ai) => (
                                <span key={ai.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 6px', backgroundColor: 'rgba(235, 75, 75, 0.12)', borderRadius: '4px' }}>
                                  {ai.name} (F{ai.floor} / REZ {ai.rez}/{ai.rez_max})
                                  <button
                                    type="button"
                                    data-testid={`join-ice-${ai.en}`}
                                    onClick={async () => {
                                      try {
                                        const res = await api.joinCombatNetEntity(combat.id, { kind: 'ice', key: ai.en, custom_name: ai.name });
                                        setCombat(res.combat);
                                      } catch (err: any) {
                                        alert(err.message);
                                      }
                                    }}
                                    style={{ padding: '1px 6px', fontSize: '0.75rem', cursor: 'pointer' }}
                                  >
                                    先頭で参戦
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}

                          {/* パスファインダで見えている階層の地図 */}
                          {activeArch && (
                            <div data-testid="netrun-floor-map" style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '2px', fontSize: '0.8rem' }}>
                              <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>階層の地図（パスファインダ視認状況）:</span>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {activeArch.floors.map((fl) => {
                                  const isRevealed = revealedSet.has(fl.floor);
                                  const isCurrent = Boolean(curNet.jacked_in && curNet.depth === fl.floor);
                                  const isUnlocked = unlockedSet.has(fl.floor);
                                  const isIdentified = identifiedSet.has(fl.floor);
                                  const isControlled = controlledSet.has(`floor-${fl.floor}`);
                                  return (
                                    <div
                                      key={fl.floor}
                                      data-testid={`netrun-floor-item-${fl.floor}`}
                                      style={{
                                        padding: '3px 8px',
                                        borderRadius: '4px',
                                        border: isCurrent ? '2px solid var(--color-ally)' : '1px solid var(--color-border-light)',
                                        backgroundColor: isCurrent ? 'rgba(0, 240, 255, 0.14)' : 'var(--color-surface)',
                                      }}
                                    >
                                      <strong>F{fl.floor}:</strong>{' '}
                                      {isRevealed ? (
                                        <span>
                                          {fl.label}
                                          {fl.dv && !(fl.label || '').includes('DV') ? ` (DV${fl.dv})` : ''}
                                          {isUnlocked ? ' [突破済]' : ''}
                                          {isIdentified ? ' [確認済]' : ''}
                                          {isControlled ? ' [支配下]' : ''}
                                        </span>
                                      ) : (
                                        <span>
                                          ？ <small style={{ color: 'var(--color-text-muted)' }}>({fl.label}{fl.dv && !(fl.label || '').includes('DV') ? ` DV${fl.dv}` : ''})</small>
                                        </span>
                                      )}
                                      {isCurrent && <span style={{ marginLeft: '4px', color: 'var(--color-ally)', fontWeight: 700 }}>←現在</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* サブ行動と対象の選択 */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                          <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            サブ行動:
                            <select
                              data-testid="net-sub-action-select"
                              aria-label="NETサブ行動"
                              value={netSubAction}
                              onChange={(e) => setNetSubAction(e.target.value)}
                              style={field}
                            >
                              <option value="jack_in">ジャックイン（接続・NET 1）</option>
                              <option value="pathfinder">パスファインダ（構造視認・NET 1）</option>
                              <option value="descend">階層を移動する（降りる／上がる・NET 0）</option>
                              <option value="backdoor">バックドア（パスワード突破・NET 1）</option>
                              <option value="eyedee">アイディール（ファイル確認・NET 1）</option>
                              <option value="control">コントロール（ノード掌握／操作・NET 1）</option>
                              <option value="activate">プログラム起動（Rez・NET 1）</option>
                              <option value="derez">プログラム停止（Derez・NET 1）</option>
                              <option value="program">攻撃プログラムを使う（ソード等・NET 1）</option>
                              <option value="zap">ザップ（1d6 ダメージ・NET 1）</option>
                              <option value="slide">スライド（ICE から逃走・NET 1）</option>
                              <option value="cloak">クローク（痕跡隠蔽・NET 1）</option>
                              <option value="virus">ウイルス（最下層改変・NET 1〜）</option>
                              <option value="jack_out">ジャックアウト（安全に切断・NET 1）</option>
                              <option value="unsafe_jack_out">安全でないジャックアウト（強制切断・NET 0）</option>
                            </select>
                          </label>

                          {netSubAction === 'jack_in' && (
                            <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              接続する構造体:
                              <select
                                data-testid="net-arch-select"
                                aria-label="接続するNET構造体"
                                value={netArchId}
                                onChange={(e) => setNetArchId(e.target.value)}
                                style={field}
                              >
                                {netArchList.length === 0 && <option value="default">デフォルト構造体</option>}
                                {netArchList.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name}（{a.floors.length} 階層 / DV {a.dv}）
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}

                          {['descend', 'backdoor', 'eyedee', 'control', 'slide'].includes(netSubAction) && (
                            <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              対象の階層:
                              <select
                                data-testid="net-target-floor-select"
                                aria-label="対象の階層"
                                value={netTargetFloor}
                                onChange={(e) => setNetTargetFloor(Number(e.target.value))}
                                style={field}
                              >
                                {(activeArch
                                  ? activeArch.floors.map((f) => ({ floor: f.floor, text: `第 ${f.floor} 階層 (${f.label})` }))
                                  : Array.from({ length: 18 }, (_, i) => ({ floor: i + 1, text: `第 ${i + 1} 階層` }))
                                ).map((opt) => (
                                  <option key={opt.floor} value={opt.floor}>
                                    {opt.text}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}

                          {['activate', 'derez', 'program'].includes(netSubAction) && (
                            <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              プログラム:
                              <select
                                data-testid="net-program-select"
                                aria-label="使用するプログラム"
                                value={netProgramKey}
                                onChange={(e) => setNetProgramKey(e.target.value)}
                                style={field}
                              >
                                {netSubAction === 'derez'
                                  ? (rezzedList.length > 0
                                      ? rezzedList.map((r) => ({ key: r.key, label: `${r.name} (起動中 REZ ${r.rez})` }))
                                      : NET_PROGRAMS.map((p) => ({ key: p.en, label: `${p.name} (${p.en})` }))
                                    ).map((opt, idx) => (
                                      <option key={`${opt.key}-${idx}`} value={opt.key}>
                                        {opt.label}
                                      </option>
                                    ))
                                  : netSubAction === 'program'
                                    ? NET_PROGRAMS.filter((p) => p.class.includes('attacker')).map((p) => (
                                        <option key={p.en} value={p.en}>
                                          {p.name} ({p.en} / ATK {p.atk}){deck.programs?.includes(p.en) ? ' ★搭載' : ''}
                                        </option>
                                      ))
                                    : [
                                        ...NET_PROGRAMS.filter((p) => !p.class.includes('attacker')).map((p) => ({
                                          key: p.en,
                                          label: `${p.name} (${p.en} / REZ ${p.rez})${deck.programs?.includes(p.en) ? ' ★搭載' : ''}`,
                                        })),
                                        ...BLACK_ICE_CATALOG.map((ice) => ({
                                          key: ice.en,
                                          label: `[ブラックICE] ${ice.name} (REZ ${ice.rez})`,
                                        })),
                                      ].map((opt) => (
                                        <option key={opt.key} value={opt.key}>
                                          {opt.label}
                                        </option>
                                      ))}
                              </select>
                            </label>
                          )}

                          {['program', 'zap', 'slide'].includes(netSubAction) && (
                            <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              目標 (ICE/対象):
                              <select
                                data-testid="net-target-ice-select"
                                aria-label="目標のブラックICE"
                                value={netTargetIceId}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setNetTargetIceId(val);
                                  if (combat.participants.some((p) => p.id === val)) {
                                    setTargetParticipantId(val);
                                  }
                                }}
                                style={field}
                              >
                                <option value="">現在の階層のブラックICE（自動）</option>
                                {activeIces.map((ai) => (
                                  <option key={ai.id} value={ai.id}>
                                    {ai.name} (第{ai.floor}階層 / REZ {ai.rez}/{ai.rez_max} / DEF {ai.def})
                                  </option>
                                ))}
                                {combat.participants
                                  .filter((p) => !p.out && p.id !== activePart.id)
                                  .map((p) => (
                                    <option key={p.id} value={p.id}>
                                      [参加者] {p.name}
                                    </option>
                                  ))}
                              </select>
                            </label>
                          )}
                        </div>

                        {netSubAction === 'virus' && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                            <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                              ウイルス内容:
                              <input
                                data-testid="net-virus-desc"
                                type="text"
                                value={netVirusDesc}
                                onChange={(e) => setNetVirusDesc(e.target.value)}
                                style={{ ...field, width: '180px' }}
                              />
                            </label>
                            <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                              難易度 (DV):
                              <input
                                data-testid="net-virus-dv"
                                type="number"
                                min={1}
                                value={netVirusDv}
                                onChange={(e) => setNetVirusDv(Number(e.target.value) || 10)}
                                style={{ ...field, width: '56px' }}
                              />
                            </label>
                            <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                              必要 NET アクション数:
                              <input
                                data-testid="net-virus-actions"
                                type="number"
                                min={1}
                                value={netVirusActions}
                                onChange={(e) => setNetVirusActions(Number(e.target.value) || 1)}
                                style={{ ...field, width: '56px' }}
                              />
                            </label>
                          </div>
                        )}

                        {enteringFloorHasIce && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                            <span>遭遇するブラック ICE の速度対抗（任意）:</span>
                            <label>
                              ICE SPD 1d10:{' '}
                              <input
                                data-testid="net-ambush-ice-roll"
                                type="number"
                                min={1}
                                max={10}
                                value={netAmbushIceRoll ?? ''}
                                onChange={(e) => setNetAmbushIceRoll(e.target.value ? Number(e.target.value) : null)}
                                style={{ ...field, width: '48px' }}
                              />
                            </label>
                            <label>
                              ランナー SPD 1d10:{' '}
                              <input
                                data-testid="net-ambush-runner-roll"
                                type="number"
                                min={1}
                                max={10}
                                value={netAmbushRunnerRoll ?? ''}
                                onChange={(e) => setNetAmbushRunnerRoll(e.target.value ? Number(e.target.value) : null)}
                                style={{ ...field, width: '48px' }}
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* ソロ《コンバット・アウェアネス》の割り振り直し（Phase 5x。p.146） */}
                  {selectedActionKey === 'solo_realloc' && (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                      ランク {activePart.character ? roleRank(activePart.character.role, activePart.character.extra, 'Solo') : 0} ポイント:
                      {SOLO_ABILITIES.map((a) => (
                        <label key={a.key}>
                          {a.name}
                          <input aria-label={a.name} type="number" min={0} max={a.max} step={a.step} value={soloAlloc[a.key] ?? ''} onChange={(e) => setSoloAlloc((p) => ({ ...p, [a.key]: e.target.value }))} style={{ width: '44px', marginLeft: '2px', padding: '2px 4px', backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border-light)', borderRadius: '4px', color: 'var(--color-text)' }} />
                        </label>
                      ))}
                    </div>
                  )}

                  {/* ドラッグ・薬品を使う（Phase 5w。日本語版 p.150・227） */}
                  {selectedActionKey === 'use_drug' && (() => {
                    const inv = ((activePart.character?.inventory as Array<{ entry_id: string; name: string; kind?: string; qty?: number }>) ?? []).filter((i) => i.kind === 'drug' || DRUGS.some((d) => d.name === i.name));
                    return (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                        <select aria-label="使うドラッグ・薬品" value={drugEntryId} onChange={(e) => setDrugEntryId(e.target.value)} style={{ padding: '4px 6px', fontSize: '0.85rem', borderRadius: '4px', border: '1px solid var(--color-border-light)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}>
                          <option value="">ドラッグ・薬品を選ぶ</option>
                          {inv.map((i) => (
                            <option key={i.entry_id} value={i.entry_id}>
                              {i.name}
                              {i.qty && i.qty > 1 ? ` ×${i.qty}` : ''}
                            </option>
                          ))}
                        </select>
                        <label>
                          <input type="checkbox" checked={drugUnwilling} onChange={(e) => setDrugUnwilling(e.target.checked)} /> 同意しない相手（エアハイポで近接攻撃。攻撃と回避の出目を入れる）
                        </label>
                        {inv.length === 0 && <span style={{ color: 'var(--color-text-muted)' }}>所持品にドラッグ・薬品がありません</span>}
                        <span style={{ color: 'var(--color-text-muted)' }}>ブラック・レースは人間性喪失 2d6 を「ダメージ出目」に入れます</span>
                      </div>
                    );
                  })()}

                  {/* 投げる・環境ダメージ（Phase 5v。日本語版 p.177〜181） */}
                  {['throw_object', 'hazard', 'hazard_end'].includes(selectedActionKey) && (() => {
                    const field: React.CSSProperties = { padding: '4px 6px', fontSize: '0.85rem', borderRadius: '4px', border: '1px solid var(--color-border-light)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' };
                    if (selectedActionKey === 'throw_object') {
                      const inv = ((activePart.character?.inventory as Array<{ entry_id: string; name: string; kind?: string; qty?: number }>) ?? []).filter((i) => i.kind === 'weapon' || /グレネード|Grenade/.test(i.name));
                      return (
                        <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.85rem' }}>
                          投げる物:
                          <select aria-label="投げる物" value={throwEntryId} onChange={(e) => setThrowEntryId(e.target.value)} style={field}>
                            <option value="">選ぶ</option>
                            {inv.map((i) => (
                              <option key={i.entry_id} value={i.entry_id}>
                                {i.name}
                                {i.qty && i.qty > 1 ? ` ×${i.qty}` : ''}
                              </option>
                            ))}
                          </select>
                          <span style={{ color: 'var(--color-text-muted)' }}>ダメージ: 近接武器はそのまま、グレネードはランチャーと同じ、それ以外は GM が決めた個数</span>
                        </label>
                      );
                    }
                    if (selectedActionKey === 'hazard_end') {
                      const tStatus = (combat.participants.find((p) => p.id === targetParticipantId)?.character?.status ?? []).filter((s) => isHazardStatus(s));
                      return (
                        <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.85rem' }}>
                          終える状態:
                          <select aria-label="終える環境の状態" value={hazardEndStatus} onChange={(e) => setHazardEndStatus(e.target.value)} style={field}>
                            <option value="">選ぶ</option>
                            {tStatus.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                          {tStatus.length === 0 && <span style={{ color: 'var(--color-text-muted)' }}>対象に環境の状態がありません</span>}
                        </label>
                      );
                    }
                    const hz = HAZARDS.find((h) => h.key === hazardKey);
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.85rem' }}>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                          種類:
                          <select aria-label="環境ダメージの種類" value={hazardKey} onChange={(e) => setHazardKey(e.target.value)} style={field}>
                            {HAZARDS.map((h) => (
                              <option key={h.key} value={h.key}>{h.name}</option>
                            ))}
                          </select>
                          {hz?.leveled && (
                            <select aria-label="危険度" value={hazardLevel} onChange={(e) => setHazardLevel(e.target.value as 'small' | 'medium' | 'large')} style={field}>
                              <option value="small">小</option>
                              <option value="medium">中</option>
                              <option value="large">大</option>
                            </select>
                          )}
                          {hazardKey === 'fall' && (
                            <>
                              <input aria-label="落ちた高さ" type="number" min={0} value={fallM} onChange={(e) => setFallM(e.target.value)} style={{ ...field, width: '70px' }} />m
                            </>
                          )}
                        </div>
                        {hz && <span style={{ color: 'var(--color-text-muted)' }}>{hz.desc}</span>}
                        {['fall', 'poison', 'drug'].includes(hazardKey) && <span style={{ color: 'var(--color-text-muted)' }}>判定（〈運動〉または〈拷問／薬物抵抗〉）の出目は「攻撃」の欄に、ダメージは「ダメージ出目」に入れます。</span>}
                      </div>
                    );
                  })()}

                  {/* 武術・つかみ・立ち上がる（Phase 5u。日本語版 p.177〜180） */}
                  {['martial_arts', 'martial_technique', 'grab', 'stand'].includes(selectedActionKey) && (() => {
                    const skills = (activePart.character?.skills ?? {}) as Record<string, number>;
                    const styles = Object.entries(skills).filter(([k, v]) => k.split(':')[0] === 'martial_arts' && v >= 1);
                    const targetChar = combat.participants.find((p) => p.id === targetParticipantId)?.character;
                    const targetItems = ((targetChar?.inventory as Array<{ entry_id: string; name: string; equipped?: boolean }>) ?? []).filter((i) => i.equipped !== false);
                    const tech = MARTIAL_TECHNIQUES.find((t) => t.key === technique);
                    const styleSpec = (martialStyle || styles[0]?.[0] || '').split(':')[1] ?? null;
                    const field: React.CSSProperties = { padding: '4px 6px', fontSize: '0.85rem', borderRadius: '4px', border: '1px solid var(--color-border-light)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' };
                    const styleSelect = (
                      <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.85rem' }}>
                        流派:
                        <select aria-label="武術の流派" value={martialStyle} onChange={(e) => setMartialStyle(e.target.value)} style={field}>
                          <option value="">いちばん高い〈武術〉</option>
                          {styles.map(([k, v]) => (
                            <option key={k} value={k}>
                              {formatSkillName(k)} {v}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                    if (selectedActionKey === 'stand') {
                      return (
                        <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.85rem' }}>
                          <input type="checkbox" checked={kipUp} disabled={styles.length === 0} onChange={(e) => setKipUp(e.target.checked)} />
                          跳ね起き（武術。DEX + 武術 + 1d10 が 13 を上回ればアクションを使わない。攻撃の欄に出目）
                          {styles.length === 0 && <span style={{ color: 'var(--color-text-muted)' }}>— 〈武術〉がありません</span>}
                        </label>
                      );
                    }
                    if (selectedActionKey === 'grab') {
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.85rem' }}>
                          <div style={{ display: 'flex', gap: '10px' }}>
                            <label><input type="radio" checked={grabMode === 'hold'} onChange={() => setGrabMode('hold')} /> 相手を拘束する（つかまれていれば逃れる）</label>
                            <label><input type="radio" checked={grabMode === 'item'} onChange={() => setGrabMode('item')} /> 持ち物を奪う</label>
                          </div>
                          {grabMode === 'item' && (
                            <select aria-label="奪う持ち物" value={heldItemId} onChange={(e) => setHeldItemId(e.target.value)} style={field}>
                              <option value="">奪う持ち物を選ぶ</option>
                              {targetItems.map((i) => (
                                <option key={i.entry_id} value={i.entry_id}>{i.name}</option>
                              ))}
                            </select>
                          )}
                          <span style={{ color: 'var(--color-text-muted)' }}>攻撃の欄に自分の出目、回避の欄に相手の〈格闘〉の出目を入れます。</span>
                        </div>
                      );
                    }
                    if (styles.length === 0) {
                      return <div style={{ color: 'var(--color-warning)', fontSize: '0.85rem' }}>{activePart.name} は〈武術〉を持っていません（PC タブの編集で「種類を選ぶ技能を足す」から〈武術：流派〉を足せます）</div>;
                    }
                    if (selectedActionKey === 'martial_arts') return styleSelect;
                    const usable = MARTIAL_TECHNIQUES.filter((t) => !t.style || !styleSpec || t.style === styleSpec);
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.85rem' }}>
                        {styleSelect}
                        <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          奥義:
                          <select aria-label="武術奥義" value={technique} onChange={(e) => setTechnique(e.target.value)} style={field}>
                            <option value="">奥義を選ぶ</option>
                            {usable.map((t) => (
                              <option key={t.key} value={t.key}>
                                {t.name}（{t.style ?? '共通'}）{t.dv ? ` 難易度 ${t.dv}` : ' 対抗判定'}
                              </option>
                            ))}
                          </select>
                        </label>
                        {tech && (
                          <div style={{ color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                            条件: {tech.requirement}
                            {tech.statReq ? `。【${tech.statReq.stat === 'will' ? '意志' : '移動'}】${tech.statReq.min} 以上` : ''}
                            <br />
                            効果: {tech.effect}
                            {tech.usesAction ? '（アクション 1 回）' : '（アクションを使わない）'}
                            {tech.damage ? '。ダメージの出目も入れます' : ''}
                          </div>
                        )}
                        {tech?.canAimHead && (
                          <label>
                            <input type="checkbox" checked={aimHead} onChange={(e) => setAimHead(e.target.checked)} /> 頭部を狙う（判定 −8）
                          </label>
                        )}
                        {tech?.key === 'disarm' && (
                          <select aria-label="落とさせる持ち物" value={heldItemId} onChange={(e) => setHeldItemId(e.target.value)} style={field}>
                            <option value="">落とさせる持ち物を選ぶ</option>
                            {targetItems.map((i) => (
                              <option key={i.entry_id} value={i.entry_id}>{i.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })()}

                  {/* Weapon Selection (for ranged / melee / reload / suppressive) */}
                  {actionInputSpec.selectors.includes('weapon') && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>使用する武器を選択:</span>
                      <select
                        value={selectedWeaponId || ''}
                        onChange={(e) => setSelectedWeaponId(e.target.value || null)}
                        style={{
                          padding: '6px 10px',
                          backgroundColor: 'var(--color-bg)',
                          border: missBorder(isMissing(false, 'weapon')),
                          borderRadius: '4px',
                          color: 'var(--color-text)',
                          fontSize: '0.85rem',
                        }}
                      >
                        <option value="">-- 武器を選択してください --</option>
                        {actionWeaponEntries.map((wOpt) => (
                          <option key={wOpt.entry_id} value={wOpt.entry_id}>
                            {wOpt.name}{wOpt.malfunctioned ? '（動作不良）' : `（${combatDamageFormula('ranged', activePart.character, wOpt) ?? 'ダメージ不明'}） (残弾: ${wOpt.ammo !== undefined && wOpt.ammo !== null ? wOpt.ammo : '—'})`}
                          </option>
                        ))}
                      </select>
                      {weaponEntries.length === 0 && (
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-warning)' }}>
                          持ち物に武器がありません。PC タブの編集で武器を持たせてください（文字だけの武器は、品目が見つかれば自動で持ち物に移ります）
                        </span>
                      )}
                    </div>
                  )}

                  {/* Melee: Ignore armor percent if unconfigured on weapon */}
                  {selectedActionKey === 'melee' && (() => {
                    const selectedWep = weaponEntries.find((w) => w.entry_id === selectedWeaponId);
                    const weaponIgnore = selectedWep?.ignore_armor_percent;
                    if (typeof weaponIgnore === 'number') {
                      return (
                        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                          防具無視率: <strong style={{ color: 'var(--color-text)' }}>{weaponIgnore}%</strong> (武器データより)
                        </div>
                      );
                    }
                    return (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '8px 10px',
                          backgroundColor: 'rgba(235, 179, 58, 0.1)',
                          borderRadius: '4px',
                          border: '1px solid var(--color-warning)',
                        }}
                      >
                        <span style={{ fontSize: '0.85rem', color: 'var(--color-warning)', fontWeight: 600 }}>
                          防具無視率が不明。GM が入力 (%):
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          placeholder="例: 50"
                          value={meleeIgnoreArmorInput ?? ''}
                          onChange={(e) =>
                            setMeleeIgnoreArmorInput(e.target.value === '' ? undefined : Number(e.target.value))
                          }
                          style={{
                            width: '70px',
                            padding: '4px 6px',
                            backgroundColor: 'var(--color-bg)',
                            border: '1px solid var(--color-border-light)',
                            borderRadius: '4px',
                            color: 'var(--color-text)',
                            fontSize: '0.85rem',
                          }}
                        />
                      </div>
                    );
                  })()}

                  {/* フルオート射撃・制圧射撃は毎回 10 発（日本語版 p.173・174） */}
                  {(selectedActionKey === 'autofire' || selectedActionKey === 'suppressive') && (
                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>弾を 10 発使います（残りが 10 発未満なら撃てません）</div>
                  )}

                  {selectedActionKey === 'suppressive' && (
                    <div data-testid="suppressive-targets" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, border: '1px solid var(--color-border-light)', borderRadius: 6 }}>
                      <label>射手の前方:
                        <select aria-label="制圧射撃の向き" value={suppressiveFacing} onChange={(e) => setSuppressiveFacing(e.target.value as typeof suppressiveFacing)}>
                          {(['N','NE','E','SE','S','SW','W','NW'] as const).map((d) => <option key={d} value={d}>{({N:'北',NE:'北東',E:'東',SE:'南東',S:'南',SW:'南西',W:'西',NW:'北西'})[d]}</option>)}
                        </select>
                      </label>
                      <strong>対象（盤面の自動候補を選択済み。GM は追加・解除できます）</strong>
                      {combat.participants.filter((p) => p.id !== activePart.id && !p.out).map((p) => {
                        const checked = suppressiveTargetIds.includes(p.id);
                        const roll = suppressiveRolls[p.id] ?? {};
                        return <div key={p.id} style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                          <label style={{display:'flex',gap:5,alignItems:'center'}}><input type="checkbox" checked={checked} onChange={(e) => setSuppressiveTargetIds((prev) => e.target.checked ? [...prev,p.id] : prev.filter((id) => id !== p.id))}/>{p.name}{suppressiveCandidates.includes(p.id) ? ' (盤面候補)' : ''}</label>
                          {checked && <><span>抵抗 1d10</span><input aria-label={`${p.name} の制圧抵抗出目`} type="number" min={1} max={10} value={roll.first ?? ''} onChange={(e) => setSuppressiveRolls((prev) => ({...prev,[p.id]:{...prev[p.id],first:e.target.value ? Number(e.target.value):undefined}}))} style={{width:54}}/>{[1,10].includes(roll.first ?? 0) && <input aria-label={`${p.name} の抵抗追加出目`} type="number" min={1} max={10} value={roll.extra ?? ''} onChange={(e) => setSuppressiveRolls((prev) => ({...prev,[p.id]:{...prev[p.id],extra:e.target.value ? Number(e.target.value):undefined}}))} style={{width:54}}/>}{p.character_id && <button type="button" onClick={() => void gmFetch(`/api/combats/${combat.id}/suppressive-resistance-request`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({participant_id:p.id})})}>スマホで出目を入力</button>}</>}
                        </div>;
                      })}
                      {!boardData && <small>盤面がないため、GM が対象を手動で選びます。</small>}
                    </div>
                  )}

                  {/* Target & Distance Selection (for ranged / melee / brawl) */}
                  {actionInputSpec.selectors.includes('target') && selectedActionKey !== 'suppressive' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{selectedActionKey === 'first_aid' ? '手当てする相手（自分も可）:' : '対象を選択:'}</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {combat.participants
                          .filter((p) => (['first_aid', 'hazard', 'hazard_end', 'use_drug', 'net_ice_attack'].includes(selectedActionKey) || p.id !== activePart.id) && !p.out)
                          .map((p) => (
                            <button
                              key={p.id}
                              onClick={() => setTargetParticipantId(p.id)}
                              style={{
                                padding: '4px 10px',
                                borderRadius: '4px',
                                border: isMissing(false, 'target') ? '2px solid var(--color-warning)' : targetParticipantId === p.id ? '2px solid var(--color-enemy)' : '1px solid var(--color-border-light)',
                                backgroundColor: targetParticipantId === p.id ? 'rgba(242, 140, 56, 0.15)' : 'var(--color-bg)',
                                color: 'var(--color-text)',
                                fontSize: '0.8rem',
                                fontWeight: targetParticipantId === p.id ? 700 : 500,
                                cursor: 'pointer',
                              }}
                            >
                              {p.name}
                            </button>
                          ))}
                      </div>

                      {actionInputSpec.selectors.includes('distance') && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '0.85rem' }}>距離 (m):</span>
                            <input
                              type="number"
                              min={0}
                              value={distanceM ?? ''}
                              onChange={(e) => setDistanceM(e.target.value === '' ? null : Number(e.target.value))}
                              style={{
                                width: '60px',
                                padding: '4px 6px',
                                backgroundColor: 'var(--color-bg)',
                                border: missBorder(isMissing(false, 'distance')),
                                borderRadius: '4px',
                                color: 'var(--color-text)',
                              }}
                            />
                            {losInfo && (
                              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                                (盤面自動: {losInfo.autoDistanceM}m)
                              </span>
                            )}
                          </div>

                          {/* LoS Status Badge & Override */}
                          {losInfo && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <span
                                style={{
                                  fontSize: '0.85rem',
                                  fontWeight: 700,
                                  color:
                                    losInfo.status === 'clear'
                                      ? 'var(--color-ally)'
                                      : losInfo.status === 'cover'
                                      ? 'var(--color-warning)'
                                      : 'var(--color-danger)',
                                }}
                              >
                                {losInfo.status === 'clear'
                                  ? '射線: ○ クリア'
                                  : losInfo.status === 'cover'
                                  ? `射線: △ 遮蔽越し (${losInfo.hitCoverObject?.label || '遮蔽物'} HP:${losInfo.hitCoverObject?.cover_hp ?? '未設定'})`
                                  : '射線: × 射撃不可'}
                              </span>

                              <select
                                value={losOverride}
                                onChange={(e) => setLosOverride(e.target.value as any)}
                                style={{
                                  padding: '2px 6px',
                                  backgroundColor: 'var(--color-bg)',
                                  border: '1px solid var(--color-border-light)',
                                  borderRadius: '4px',
                                  color: 'var(--color-text)',
                                  fontSize: '0.75rem',
                                }}
                              >
                                <option value="auto">射線: 自動判定</option>
                                <option value="clear">強制: 通る (クリア)</option>
                                <option value="cover">強制: 遮蔽越し</option>
                                <option value="blocked">強制: 撃てない</option>
                              </select>
                            </div>
                          )}

                          {/* Cover Rule Warning & Damage input */}
                          {(losInfo?.status === 'cover' || losOverride === 'cover') && (
                            <div
                              style={{
                                padding: '8px 10px',
                                backgroundColor: 'rgba(235, 179, 58, 0.15)',
                                borderLeft: '3px solid var(--color-warning)',
                                fontSize: '0.8rem',
                                color: 'var(--color-warning)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '6px',
                              }}
                            >
                              <span>
                                遮蔽物越し（ルール確認中 Issue #5）。遮蔽物に当てるかは GM が決める
                              </span>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 600 }}>
                                <input
                                  type="checkbox"
                                  checked={hitCover}
                                  onChange={(e) => setHitCover(e.target.checked)}
                                />
                                遮蔽物に当てる
                              </label>
                              {hitCover && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                  {boardData && (
                                    <select
                                      value={coverObjectId || losInfo?.hitCoverObject?.id || ''}
                                      onChange={(e) => {
                                        const selId = e.target.value || null;
                                        setCoverObjectId(selId);
                                        const obj = boardData.objects.find((o) => o.id === selId);
                                        if (obj?.cover_hp !== null && obj?.cover_hp !== undefined) {
                                          setCoverHpInput(String(obj.cover_hp));
                                        } else {
                                          setCoverHpInput('');
                                        }
                                      }}
                                      style={{
                                        padding: '4px 8px',
                                        backgroundColor: 'var(--color-bg)',
                                        border: '1px solid var(--color-border-light)',
                                        borderRadius: '4px',
                                        color: 'var(--color-text)',
                                        fontSize: '0.85rem',
                                      }}
                                    >
                                      <option value="">(対象遮蔽物)</option>
                                      {boardData.objects
                                        .filter((o) => o.blocks_los === 'partial' || o.cover_hp !== null)
                                        .map((o) => (
                                          <option key={o.id} value={o.id}>
                                            {o.label || '遮蔽物'} (HP: {o.cover_hp ?? '不明'})
                                          </option>
                                        ))}
                                    </select>
                                  )}

                                  {(() => {
                                    const activeObj =
                                      (coverObjectId && boardData?.objects.find((o) => o.id === coverObjectId)) ||
                                      losInfo?.hitCoverObject;
                                    const isHpEmpty = !activeObj || activeObj.cover_hp === null || activeObj.cover_hp === undefined;
                                    return isHpEmpty ? (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <span style={{ fontSize: '0.85rem', color: 'var(--color-warning)' }}>
                                          遮蔽物のHP:
                                        </span>
                                        <input
                                          type="number"
                                          min={1}
                                          placeholder="遮蔽物HP"
                                          value={coverHpInput}
                                          onChange={(e) => setCoverHpInput(e.target.value)}
                                          style={{
                                            width: '70px',
                                            padding: '3px 6px',
                                            backgroundColor: 'var(--color-bg)',
                                            border: '1px solid var(--color-warning)',
                                            borderRadius: '4px',
                                            color: 'var(--color-text)',
                                            fontSize: '0.85rem',
                                          }}
                                        />
                                      </div>
                                    ) : null;
                                  })()}

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontSize: '0.85rem' }}>遮蔽物へのダメージ:</span>
                                    <input
                                      type="number"
                                      min={0}
                                      placeholder="ダメージ値"
                                      value={coverDamageInput}
                                      onChange={(e) => setCoverDamageInput(e.target.value)}
                                      style={{
                                        width: '70px',
                                        padding: '3px 6px',
                                        backgroundColor: 'var(--color-bg)',
                                        border: '1px solid var(--color-border-light)',
                                        borderRadius: '4px',
                                        color: 'var(--color-text)',
                                      }}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Melee adjacency notice */}
                      {MELEE_LIKE.includes(selectedActionKey) && meleeBlocked && (
                        <div
                          style={{
                            padding: '6px 10px',
                            backgroundColor: 'rgba(235, 75, 75, 0.15)',
                            borderLeft: '3px solid var(--color-danger)',
                            color: 'var(--color-danger)',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                          }}
                        >
                          ⚠ 近接攻撃・格闘は隣接（1マス）の対象のみ可能です（現在 {losInfo?.distSquares} マス離れています）
                        </div>
                      )}

                      {/* Dodge mode if applicable（近接攻撃・格闘はいつも回避で受けるので出さない。Phase 5l） */}
                      {['ranged', 'aimed', 'autofire', 'throw_object'].includes(selectedActionKey) && (targetForDefense?.character?.stats?.ref ?? 0) >= 8 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
                        <span style={{ fontSize: '0.85rem' }}>受け方:</span>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name="dodgeMode"
                            checked={dodgeMode === 'dv'}
                            onChange={() => setDodgeMode('dv')}
                          />
                          難易度 (DV) で受ける
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name="dodgeMode"
                            checked={dodgeMode === 'dodge'}
                            onChange={() => setDodgeMode('dodge')}
                          />
                          回避で受ける
                        </label>
                      </div>
                      )}

                      {/* Aimed shot specific */}
                      {selectedActionKey === 'aimed' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '0.85rem' }}>照準部位:</span>
                            <select
                              value={aimedLocation}
                              onChange={(e) => setAimedLocation(e.target.value as any)}
                              style={{
                                padding: '4px 8px',
                                backgroundColor: 'var(--color-bg)',
                                border: '1px solid var(--color-border-light)',
                                borderRadius: '4px',
                                color: 'var(--color-text)',
                              }}
                            >
                              <option value="head">頭部（ダメージ2倍）</option>
                              <option value="held_item">持っている物（落とさせる）</option>
                              <option value="leg">脚（効果は GM 手入力）</option>
                            </select>
                          </div>
                          {aimedLocation === 'held_item' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '0.85rem' }}>落とすアイテムID:</span>
                              <input
                                type="text"
                                placeholder="アイテムID"
                                value={heldItemId}
                                onChange={(e) => setHeldItemId(e.target.value)}
                                style={{
                                  padding: '4px 8px',
                                  backgroundColor: 'var(--color-bg)',
                                  border: '1px solid var(--color-border-light)',
                                  borderRadius: '4px',
                                  color: 'var(--color-text)',
                                  fontSize: '0.85rem',
                                }}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Dice Roll Inputs */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {attackLineText && (
                      <div data-testid="attack-line" style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)', color: 'var(--color-ally)' }}>
                        {attackLineText.text}
                        {attackLineText.bands?.length ? <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:4}}>{attackLineText.bands.map((b) => <span key={b.range} style={{padding:'2px 5px',background:b.current?'rgba(79,182,227,.25)':'transparent',fontWeight:b.current?800:400,border:b.current?'1px solid var(--color-ally)':'1px solid var(--color-border-light)'}}>{b.range}: DV {b.dv}, {b.needed}</span>)}</div> : null}
                      </div>
                    )}
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>出目の入力:</span>
                    {/* 【運命】点（振る前に使う。1 点につき +1。日本語版 p.130。Phase 5v） */}
                    {activePart.character && ['ranged', 'aimed', 'autofire', 'melee', 'brawl', 'martial_arts', 'grab', 'martial_technique', 'stand', 'first_aid', 'throw_object', 'net_action', 'scanner'].includes(selectedActionKey) && (() => {
                      const left = Math.max(0, (activePart.character.stats?.luck ?? 0) - Number(activePart.character.extra?.luck_used ?? 0));
                      return (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                          【運命】点を使う:
                          <input
                            aria-label="使う運命点"
                            type="number"
                            min={0}
                            max={left}
                            value={luckSpent || ''}
                            placeholder="0"
                            onChange={(e) => setLuckSpent(Math.max(0, Math.min(left, Number(e.target.value) || 0)))}
                            style={{ width: '46px', padding: '4px', textAlign: 'center', backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border-light)', borderRadius: '4px', color: 'var(--color-text)' }}
                          />
                          （残り {left}。1 点につき +1）
                        </label>
                      );
                    })()}
                    {/* 死亡セーブの出目（スマホから届けば入る。NPC は GM が入れる。Phase 5l） */}
                    {selectedActionKey === 'death_save' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>死亡セーブ 1d10:</span>
                        {rollSourceTag('death_save')}
                        <input
                          data-testid="death-save-input"
                          type="number"
                          min={1}
                          max={10}
                          placeholder="1d10"
                          value={deathSaveRoll ?? ''}
                          onChange={(e) => setDeathSaveRoll(e.target.value ? Number(e.target.value) : undefined)}
                          style={{ width: '46px', padding: '4px', textAlign: 'center', backgroundColor: 'var(--color-bg)', border: missBorder(isMissing(false, 'death_save_roll')), borderRadius: '4px', color: 'var(--color-text)' }}
                        />
                      </div>
                    )}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
                      {hasDiceInput('attack_roll') && <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{actionInputSpec.dice.find((d) => d.field === 'attack_roll')?.purpose ?? '判定'} — {activePart.name} 1d10:</span>
                        {rollSourceTag('attack')}
                        <input
                          data-testid="attack-roll-input"
                          type="number"
                          min={1}
                          max={10}
                          value={attackFirst ?? ''}
                          placeholder="1d10"
                          onChange={(e) => setAttackFirst(e.target.value ? Number(e.target.value) : null)}
                          style={{
                            width: '46px',
                            padding: '4px',
                            textAlign: 'center',
                            backgroundColor: 'var(--color-bg)',
                            border: missBorder(isMissing(false, 'attack_roll')),
                            borderRadius: '4px',
                            color: 'var(--color-text)',
                          }}
                        />
                      </div>}

                      {actionInputSpec.dice.some((d) => d.field === 'attack_extra') && (attackFirst === 10 || attackFirst === 1) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '0.8rem', color: attackFirst === 10 ? 'var(--color-ally)' : 'var(--color-warning)' }}>
                            {actionInputSpec.dice.find((d) => d.field === 'attack_roll')?.purpose ?? '判定'}追加出目 — {activePart.name} (1d10):
                          </span>
                          <input
                            data-testid="attack-extra-input"
                            type="number"
                            min={1}
                            max={10}
                            value={attackExtra ?? ''}
                            placeholder="1d10"
                            onChange={(e) => setAttackExtra(e.target.value ? Number(e.target.value) : undefined)}
                            style={{
                              width: '46px',
                              padding: '4px',
                              textAlign: 'center',
                              backgroundColor: 'var(--color-bg)',
                              border: missBorder(isMissing(false, 'attack_extra')),
                              borderRadius: '4px',
                              color: 'var(--color-text)',
                            }}
                          />
                        </div>
                      )}

                      {showDefenseInput && (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{actionInputSpec.dice.find((d) => d.field === 'defense_roll')?.purpose ?? '回避'} — {targetForDefense?.name ?? activePart.name} 1d10:</span>
                            {rollSourceTag('defense')}
                            <input
                              data-testid="defense-roll-input"
                              type="number"
                              min={1}
                              max={10}
                              value={defenseFirst ?? ''}
                              placeholder="1d10"
                              onChange={(e) => setDefenseFirst(e.target.value ? Number(e.target.value) : null)}
                              style={{
                                width: '46px',
                                padding: '4px',
                                textAlign: 'center',
                                backgroundColor: 'var(--color-bg)',
                                border: missBorder(isMissing(false, 'defense_roll')),
                                borderRadius: '4px',
                                color: 'var(--color-text)',
                              }}
                            />
                          </div>

                          {actionInputSpec.dice.some((d) => d.field === 'defense_extra') && (defenseFirst === 10 || defenseFirst === 1) && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '0.8rem', color: defenseFirst === 10 ? 'var(--color-ally)' : 'var(--color-warning)' }}>
                                {defenseFirst === 10 ? '回避クリティカル追加 (1d10):' : '回避ファンブル追加 (1d10):'}
                              </span>
                              <input
                                data-testid="defense-extra-input"
                                type="number"
                                min={1}
                                max={10}
                                value={defenseExtra ?? ''}
                                placeholder="1d10"
                                onChange={(e) => setDefenseExtra(e.target.value ? Number(e.target.value) : undefined)}
                                style={{
                                  width: '46px',
                                  padding: '4px',
                                  textAlign: 'center',
                                  backgroundColor: 'var(--color-bg)',
                                  border: missBorder(isMissing(false, 'defense_extra')),
                                  borderRadius: '4px',
                                  color: 'var(--color-text)',
                                }}
                              />
                            </div>
                          )}
                        </>
                      )}

                      {hasDiceInput('damage_rolls') && (
                        <div data-testid="gm-damage-guide" style={{ fontSize: '0.85rem', color: 'var(--color-ally)' }}>
                          ダメージ: {damageDiceGuide(combatDamageFormula(selectedActionKey, activePart.character, weaponEntries.find((w) => w.entry_id === selectedWeaponId)))}
                        </div>
                      )}
                      {hasDiceInput('damage_rolls') && <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>ダメージ出目:</span>
                        {rollSourceTag('damage')}
                        <input
                          data-testid="damage-dice-input"
                          type="text"
                          value={damageDiceStr}
                          onChange={(e) => setDamageDiceStr(e.target.value)}
                          placeholder="6, 6, 2"
                          style={{
                            width: '90px',
                            padding: '4px 6px',
                            backgroundColor: 'var(--color-bg)',
                            border: missBorder(isMissing(false, 'damage_rolls')),
                            borderRadius: '4px',
                            color: 'var(--color-text)',
                            fontSize: '0.85rem',
                          }}
                        />
                      </div>}

                      {hasDiceInput('crit_roll') && <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>致命傷 2d6:</span>
                        <input
                          type="number"
                          min={2}
                          max={12}
                          value={critRoll ?? ''}
                          placeholder="2d6"
                          onChange={(e) => setCritRoll(e.target.value ? Number(e.target.value) : undefined)}
                          style={{
                            width: '46px',
                            padding: '4px',
                            textAlign: 'center',
                            backgroundColor: 'var(--color-bg)',
                            border: missBorder(isMissing(false, 'crit_roll')),
                            borderRadius: '4px',
                            color: 'var(--color-text)',
                          }}
                        />
                      </div>}
                      {hasDiceInput('crit_roll') && (extraCritRoll !== undefined || isMissing(false, 'extra_crit_roll')) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '0.8rem', color: 'var(--color-warning)' }}>2 つ目の致命傷 2d6:</span>
                          <input
                            aria-label="2 つ目の致命傷"
                            type="number"
                            min={2}
                            max={12}
                            value={extraCritRoll ?? ''}
                            placeholder="2d6"
                            onChange={(e) => setExtraCritRoll(e.target.value ? Number(e.target.value) : undefined)}
                            style={{ width: '46px', padding: '4px', textAlign: 'center', backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-warning)', borderRadius: '4px', color: 'var(--color-text)' }}
                          />
                        </div>
                      )}
                    </div>

                    {/* ROF 2 multi-attack option */}
                    {['ranged', 'melee', 'brawl', 'martial_arts'].includes(selectedActionKey) && (
                      <div
                        style={{
                          marginTop: '6px',
                          padding: '8px 10px',
                          backgroundColor: 'var(--color-bg)',
                          border: '1px solid var(--color-border-light)',
                          borderRadius: '4px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                        }}
                      >
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600 }}>
                          <input
                            type="checkbox"
                            checked={secondAttackEnabled}
                            onChange={(e) => setSecondAttackEnabled(e.target.checked)}
                          />
                          第2攻撃を行う（ROF 2 武器用）
                        </label>

                        {secondAttackEnabled && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', marginTop: '4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>第2 攻撃 1d10:</span>
                              <input
                                type="number"
                                min={1}
                                max={10}
                                value={secondAttackFirst ?? ''}
                                placeholder="1d10"
                                onChange={(e) => setSecondAttackFirst(e.target.value ? Number(e.target.value) : null)}
                                style={{
                                  width: '46px',
                                  padding: '4px',
                                  textAlign: 'center',
                                  backgroundColor: 'var(--color-surface)',
                                  border: missBorder(isMissing(true, 'attack_roll')),
                                  borderRadius: '4px',
                                  color: 'var(--color-text)',
                                }}
                              />
                            </div>

                            {(secondAttackFirst === 10 || secondAttackFirst === 1) && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '0.8rem', color: secondAttackFirst === 10 ? 'var(--color-ally)' : 'var(--color-warning)' }}>
                                  追加 (1d10):
                                </span>
                                <input
                                  type="number"
                                  min={1}
                                  max={10}
                                  value={secondAttackExtra ?? ''}
                                  placeholder="1d10"
                                  onChange={(e) => setSecondAttackExtra(e.target.value ? Number(e.target.value) : undefined)}
                                  style={{
                                    width: '46px',
                                    padding: '4px',
                                    textAlign: 'center',
                                    backgroundColor: 'var(--color-surface)',
                                    border: missBorder(isMissing(true, 'attack_extra')),
                                    borderRadius: '4px',
                                    color: 'var(--color-text)',
                                  }}
                                />
                              </div>
                            )}

                            {(dodgeMode === 'dodge' || selectedActionKey === 'net_action' || selectedActionKey === 'net_ice_attack') && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>第2 回避 1d10:</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={10}
                                  placeholder="1d10"
                                  value={secondDefenseFirst ?? ''}
                                  onChange={(e) => setSecondDefenseFirst(e.target.value ? Number(e.target.value) : null)}
                                  style={{ width: '46px', padding: '4px', textAlign: 'center', backgroundColor: 'var(--color-surface)', border: missBorder(isMissing(true, 'defense_roll')), borderRadius: '4px', color: 'var(--color-text)' }}
                                />
                              </div>
                            )}

                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>第2 致命傷 2d6:</span>
                              <input
                                type="number"
                                min={2}
                                max={12}
                                placeholder="2d6"
                                value={secondCritRoll ?? ''}
                                onChange={(e) => setSecondCritRoll(e.target.value ? Number(e.target.value) : undefined)}
                                style={{ width: '46px', padding: '4px', textAlign: 'center', backgroundColor: 'var(--color-surface)', border: missBorder(isMissing(true, 'crit_roll')), borderRadius: '4px', color: 'var(--color-text)' }}
                              />
                            </div>
                            {(secondExtraCritRoll !== undefined || (previewResult?.missing_inputs ?? []).some((m: string) => m.startsWith('[#2]') && m.includes('2 つ目'))) && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '0.8rem', color: 'var(--color-warning)' }}>第2 の 2 つ目の致命傷 2d6:</span>
                                <input
                                  aria-label="第2 の 2 つ目の致命傷"
                                  type="number"
                                  min={2}
                                  max={12}
                                  placeholder="2d6"
                                  value={secondExtraCritRoll ?? ''}
                                  onChange={(e) => setSecondExtraCritRoll(e.target.value ? Number(e.target.value) : undefined)}
                                  style={{ width: '46px', padding: '4px', textAlign: 'center', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-warning)', borderRadius: '4px', color: 'var(--color-text)' }}
                                />
                              </div>
                            )}

                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>第2 ダメージ出目:</span>
                              <input
                                type="text"
                                value={secondDamageDiceStr}
                                onChange={(e) => setSecondDamageDiceStr(e.target.value)}
                                placeholder="4, 3, 2"
                                style={{
                                  width: '90px',
                                  padding: '4px 6px',
                                  backgroundColor: 'var(--color-surface)',
                                  border: missBorder(isMissing(true, 'damage_rolls')),
                                  borderRadius: '4px',
                                  color: 'var(--color-text)',
                                  fontSize: '0.85rem',
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Manual Unconfirmed Inputs */}
                  {actions.find((a) => a.key === selectedActionKey)?.status === 'unconfirmed' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>GM 手動結果入力:</span>
                      <input
                        type="text"
                        placeholder="メモ・状況 (例: 敵が遮蔽に退避)"
                        value={manualNotes}
                        onChange={(e) => setManualNotes(e.target.value)}
                        style={{
                          padding: '6px',
                          backgroundColor: 'var(--color-bg)',
                          border: '1px solid var(--color-border-light)',
                          borderRadius: '4px',
                          color: 'var(--color-text)',
                        }}
                      />
                      <input
                        type="number"
                        placeholder="HP変化 (例: -10)"
                        value={manualHpChange}
                        onChange={(e) => setManualHpChange(e.target.value)}
                        style={{
                          width: '120px',
                          padding: '6px',
                          backgroundColor: 'var(--color-bg)',
                          border: '1px solid var(--color-border-light)',
                          borderRadius: '4px',
                          color: 'var(--color-text)',
                        }}
                      />
                    </div>
                  )}

                  {/* Calculate preview button */}
                  <button
                    onClick={handleCalculateAction}
                    disabled={isResolving || isCoverHpNeededAndMissing || selectedWeaponIsMalfunctioned}
                    title={selectedWeaponIsMalfunctioned ? '動作不良の武器は修理するまで使えません' : isCoverHpNeededAndMissing ? '遮蔽物のHPを入力するまで計算できません' : undefined}
                    style={{
                      backgroundColor: 'var(--color-surface)',
                      border: '1px solid var(--color-ally)',
                      color: (isCoverHpNeededAndMissing || selectedWeaponIsMalfunctioned) ? 'var(--color-text-muted)' : 'var(--color-ally)',
                      opacity: (isCoverHpNeededAndMissing || selectedWeaponIsMalfunctioned) ? 0.6 : 1,
                      padding: '8px',
                      borderRadius: '4px',
                      fontWeight: 700,
                      cursor: (isCoverHpNeededAndMissing || selectedWeaponIsMalfunctioned) ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isResolving ? '計算中...' : '判定と反映内容を計算'}
                  </button>
                  {isCoverHpNeededAndMissing && (
                    <div style={{ color: 'var(--color-warning)', fontSize: '0.8rem', marginTop: '4px' }}>
                      ※ 遮蔽物のHPを入力するまで計算できません
                    </div>
                  )}
                  {selectedWeaponIsMalfunctioned && <div role="alert" style={{color:'var(--color-warning)',fontSize:'0.8rem'}}>※ 動作不良の武器は「動作不良を直す」まで使えません</div>}

                  {/* Preview of changes */}
                  {previewResult && (
                    <div
                      style={{
                        backgroundColor: 'var(--color-bg)',
                        border: '1px solid var(--color-border)',
                        borderRadius: '6px',
                        padding: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: previewResult.success ? 'var(--color-ally)' : 'var(--color-warning)' }}>
                        {previewResult.formula}
                      </div>

                      {/* Missing inputs warning */}
                      {previewResult.missing_inputs && previewResult.missing_inputs.length > 0 && (
                        <div
                          style={{
                            padding: '8px 12px',
                            backgroundColor: 'rgba(235, 75, 75, 0.15)',
                            border: '1px solid var(--color-warning)',
                            borderRadius: '4px',
                            color: 'var(--color-warning)',
                            fontSize: '0.85rem',
                          }}
                        >
                          <div style={{ fontWeight: 700 }}>不足している入力があります:</div>
                          <ul style={{ margin: '4px 0 0', paddingLeft: '20px' }}>
                            {previewResult.missing_inputs.map((msg: string, idx: number) => (
                              <li key={idx}>{msg}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {previewResult.changes.length > 0 && (
                        <div>
                          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>
                            反映する内容:
                          </span>
                          <ul style={{ margin: '4px 0 0', paddingLeft: '20px', fontSize: '0.85rem' }}>
                            {previewResult.changes.map((ch: any, idx: number) => (
                              <li key={idx}>{ch.desc}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <button
                        onClick={handleApplyAction}
                        disabled={isApplying || (previewResult.missing_inputs && previewResult.missing_inputs.length > 0) || previewResult.changes.length === 0}
                        style={{
                          marginTop: '6px',
                          backgroundColor: (previewResult.missing_inputs && previewResult.missing_inputs.length > 0) || previewResult.changes.length === 0
                            ? 'var(--color-surface-elevated)'
                            : 'var(--color-ally)',
                          color: (previewResult.missing_inputs && previewResult.missing_inputs.length > 0) || previewResult.changes.length === 0
                            ? 'var(--color-text-muted)'
                            : '#000',
                          border: 'none',
                          padding: '10px',
                          borderRadius: '4px',
                          fontWeight: 800,
                          fontSize: '0.95rem',
                          cursor: (previewResult.missing_inputs && previewResult.missing_inputs.length > 0) || previewResult.changes.length === 0
                            ? 'not-allowed'
                            : 'pointer',
                        }}
                      >
                        {isApplying ? '反映中...' : '確定して反映'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div style={{ color: 'var(--color-text-muted)' }}>手番の参加者がいません。</div>
          )}
        </div>

        {/* Right: Enemy Participant Cards (hidden on mobile if ally tab selected) */}
        <div style={{ display: mobileSideTab === 'enemy' ? 'flex' : 'none', flexDirection: 'column', gap: '12px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--color-enemy)' }}>敵</h3>
          {enemies.map((p) => renderParticipantCard(p, p.id === activePart?.id))}
        </div>
      </div>

      {/* Combat Log Bottom Section */}
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          padding: '16px',
        }}
      >
        <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 10px' }}>戦闘ログ</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto' }}>
          {combat.logs && combat.logs.length > 0 ? (
            combat.logs.map((l) => (
              <div
                key={l.id}
                style={{
                  fontSize: '0.85rem',
                  padding: '6px 10px',
                  backgroundColor: 'var(--color-surface-elevated)',
                  borderRadius: '4px',
                  opacity: l.undone ? 0.4 : 1,
                  textDecoration: l.undone ? 'line-through' : 'none',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>
                  [R{l.round}] <strong>{l.action_key}</strong>: {l.changes.map((c: any) => c.desc).join(', ')}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  {new Date(l.at).toLocaleTimeString()}
                </span>
              </div>
            ))
          ) : (
            <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>ログはまだありません。</div>
          )}
        </div>
      </div>

      {showJoinDialog && combat && (
        <JoinCombatDialog
          combatId={combat.id}
          characters={characters}
          joinedCharacterIds={combat.participants.map((p) => p.character_id).filter((id): id is string => !!id)}
          onClose={() => setShowJoinDialog(false)}
          onJoined={refreshCombat}
        />
      )}

      {itemPopup && <ItemDetailPopup name={itemPopup.name} itemId={itemPopup.itemId} onClose={() => setItemPopup(null)} />}
    </div>
  );

  // Helper renderer for Participant Card
  function renderParticipantCard(p: CombatParticipant, isCurrentTurn: boolean) {
    const char = p.character;
    const isAlly = p.side === 'ally';
    const hasHp = char?.hp !== undefined && char?.hp !== null;
    const hp = char?.hp ?? 0;
    const hpMax = char?.hp_max ?? 1;
    const hpPercent = hasHp ? Math.min(100, Math.max(0, (hp / hpMax) * 100)) : 0;

    let hpColor = isAlly ? 'var(--color-ally)' : 'var(--color-enemy)';
    if (hp < hpMax / 2 && hp > 0) hpColor = 'var(--color-warning)';
    if (hp <= 0) hpColor = 'var(--color-danger)';

    const expanded = expandedParticipantId === p.id;
    const inventory = ((char?.inventory as any[]) || []).filter((i) => i && typeof i === 'object');
    const cyberware = char?.cyberware || [];
    const textWeapons = ((char?.weapons as unknown[]) || []).filter((w): w is string => typeof w === 'string');
    const itemRow = (key: string, label: string, itemId?: string | null, extra?: string) => (
      <button
        key={key}
        type="button"
        data-testid="card-item-row"
        onClick={(e) => {
          e.stopPropagation();
          openItemPopup(label, itemId);
        }}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          width: '100%',
          padding: '3px 6px',
          background: 'var(--color-surface-elevated)',
          border: '1px solid var(--color-border-light)',
          borderRadius: '3px',
          color: 'var(--color-text)',
          fontSize: '0.75rem',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span>{label}</span>
        {extra && <span style={{ color: 'var(--color-text-muted)' }}>{extra}</span>}
      </button>
    );

    return (
      <div
        key={p.id}
        data-testid={`participant-card-${p.id}`}
        onClick={() => setExpandedParticipantId(expanded ? null : p.id)}
        style={{
          cursor: 'pointer',
          backgroundColor: isCurrentTurn ? 'rgba(79, 182, 227, 0.08)' : 'var(--color-surface)',
          border: isCurrentTurn
            ? `2px solid ${isAlly ? 'var(--color-ally)' : 'var(--color-enemy)'}`
            : '1px solid var(--color-border)',
          borderRadius: '8px',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          opacity: p.out ? 0.4 : 1,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: isAlly ? 'rgba(79, 182, 227, 0.2)' : 'rgba(242, 140, 56, 0.2)',
                color: isAlly ? 'var(--color-ally)' : 'var(--color-enemy)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '0.9rem',
              }}
            >
              {p.name.charAt(0)}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{p.name}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                {char?.role || '—'}
              </div>
            </div>
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            イニシア {p.initiative}
          </span>
        </div>

        {/* HP Bar */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '2px' }}>
            <span>HP</span>
            <span>{hasHp ? `${hp} / ${hpMax}` : '—'}</span>
          </div>
          {hasHp && (
            <div
              style={{
                height: '6px',
                backgroundColor: 'var(--color-surface-elevated)',
                borderRadius: '3px',
                overflow: 'hidden',
              }}
            >
              <div
                role="progressbar"
                aria-label={`${p.name} HP`}
                aria-valuemin={0}
                aria-valuemax={hpMax}
                aria-valuenow={hp}
                data-testid={`gm-hp-${p.character_id}`}
                style={{
                  width: `${hpPercent}%`,
                  height: '100%',
                  backgroundColor: hpColor,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          )}
        </div>

        {/* SP & Ammo */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
          <span>SP 頭 {char?.sp_head ?? '—'} / 胴 {char?.sp_body ?? '—'}</span>
          <span>{char?.status && char.status.length > 0 ? char.status.join(', ') : '通常'}</span>
        </div>

        {expanded && char && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.75rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', fontFamily: 'var(--font-mono)' }}>
              {Object.entries(char.stats || {}).map(([k, v]) => (
                <span key={k}>
                  {k.toUpperCase()} {v as number}
                </span>
              ))}
            </div>
            {Object.keys(char.skills || {}).length > 0 && (
              <div style={{ color: 'var(--color-text-muted)' }}>
                {Object.entries(char.skills)
                  .map(([k, lv]) => `${formatSkillName(k)} ${lv}`)
                  .join(' / ')}
              </div>
            )}
            <div style={{ color: 'var(--color-text-muted)' }}>武器・防具・所持品</div>
            {inventory.length === 0 && textWeapons.length === 0 && <span>—</span>}
            {inventory.map((i: any) =>
              itemRow(i.entry_id ?? i.name, i.name, i.item_id, i.kind === 'weapon' && typeof i.ammo === 'number' ? `残弾 ${i.ammo}` : i.qty > 1 ? `×${i.qty}` : undefined),
            )}
            {textWeapons.map((w) => itemRow(`w-${w}`, w, null))}
            {cyberware.length > 0 && <div style={{ color: 'var(--color-text-muted)' }}>サイバーウェア</div>}
            {cyberware.map((cw, idx) => itemRow(`cw-${idx}`, cw.name, cw.item_id))}
            {!p.out && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`${p.name} を退場させますか？（取り消しで戻せます）`)) handleLeave(p.id);
                }}
                style={{ alignSelf: 'flex-end', padding: '3px 8px', borderRadius: '3px', border: '1px solid var(--color-danger)', background: 'none', color: 'var(--color-danger)', fontSize: '0.75rem', cursor: 'pointer' }}
              >
                退場させる
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
};
