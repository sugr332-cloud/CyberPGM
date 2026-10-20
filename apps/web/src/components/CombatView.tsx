import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api.js';
import {
  Combat,
  CombatParticipant,
  CombatActionDef,
  CombatChange,
  CharacterSheet,
  Board,
  BoardObject,
  BoardToken,
  BoardDrop,
} from '@cyberpgm/shared';
import {
  initiativeTotal,
  sortInitiative,
  InitiativeEntry,
  findReachableSquares,
  checkLineOfSight,
  gridDistance,
  DEFAULT_RULES,
  LosStatus,
} from '@cyberpgm/rules';
import { BoardView } from './BoardView.js';

interface CombatViewProps {
  characters: CharacterSheet[];
  onRefreshCharacters: () => void;
  token?: string | null;
  wsMessage?: { type: string; payload: any } | null;
  isStandaloneWindow?: boolean;
}

export const CombatView: React.FC<CombatViewProps> = ({
  characters,
  onRefreshCharacters,
  token,
  wsMessage,
  isStandaloneWindow = false,
}) => {
  const [combat, setCombat] = useState<Combat | null>(null);
  const activePart = combat?.participants?.[combat.turn_index];
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
  const [sessionCode, setSessionCode] = useState<string>('');
  const [isTvBroadcasting, setIsTvBroadcasting] = useState<boolean>(true);

  // Board Interaction & Movements
  const [destination, setDestination] = useState<{ x: number; y: number } | null>(null);
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
  const [tieBreakMode, setTieBreakMode] = useState<'ref' | 'manual'>('ref');

  // Active Combat: Turn Guide State
  const [selectedActionKey, setSelectedActionKey] = useState<string | null>(null);
  const [targetParticipantId, setTargetParticipantId] = useState<string | null>(null);
  const [distanceM, setDistanceM] = useState<number>(5);
  const [selectedWeaponId, setSelectedWeaponId] = useState<string | null>(null);
  const [meleeIgnoreArmorInput, setMeleeIgnoreArmorInput] = useState<number | undefined>(undefined);
  const [ammoSpent, setAmmoSpent] = useState<number>(10);
  const [dodgeMode, setDodgeMode] = useState<'dv' | 'dodge'>('dv');
  const [aimedLocation, setAimedLocation] = useState<'head' | 'held_item' | 'leg'>('head');
  const [heldItemId, setHeldItemId] = useState<string>('');
  
  // Rolls in Guide
  const [attackFirst, setAttackFirst] = useState<number>(7);
  const [attackExtra, setAttackExtra] = useState<number | undefined>(undefined);
  const [defenseFirst, setDefenseFirst] = useState<number>(5);
  const [defenseExtra, setDefenseExtra] = useState<number | undefined>(undefined);
  const [damageDiceStr, setDamageDiceStr] = useState<string>('6, 6, 2');
  const [critRoll, setCritRoll] = useState<number | undefined>(undefined);
  const [deathSaveRoll, setDeathSaveRoll] = useState<number>(5);

  // Multi-attack for ROF 2
  const [secondAttackEnabled, setSecondAttackEnabled] = useState<boolean>(false);
  const [secondAttackFirst, setSecondAttackFirst] = useState<number>(7);
  const [secondAttackExtra, setSecondAttackExtra] = useState<number | undefined>(undefined);
  const [secondDamageDiceStr, setSecondDamageDiceStr] = useState<string>('4, 3, 2');
  
  // Unconfirmed / Manual Inputs
  const [manualNotes, setManualNotes] = useState<string>('');
  const [manualHpChange, setManualHpChange] = useState<string>('');

  // Resolution preview
  const [previewResult, setPreviewResult] = useState<any | null>(null);
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

  useEffect(() => {
    refreshCombat();
    refreshBoardsList();
    api.getCombatActions().then((res) => setActions(res.actions)).catch(() => {});
  }, [refreshCombat, refreshBoardsList]);

  useEffect(() => {
    if (combat?.board_id) {
      refreshBoard(combat.board_id);
    } else {
      setBoardData(null);
    }
  }, [combat?.board_id, refreshBoard]);

  // Board Object & Token Handlers
  const handleAutoPlaceTokens = async () => {
    if (!combat || !boardData) return;
    const existingIds = new Set(boardData.tokens.map((t) => t.character_id));
    let allyCount = 0;
    let enemyCount = 0;
    for (const p of combat.participants) {
      const matchId = p.character_id || p.id;
      if (!existingIds.has(matchId)) {
        const isAlly = p.side === 'ally';
        const x = isAlly ? 2 : 12;
        const y = isAlly ? 2 + allyCount++ : 2 + enemyCount++;
        await api.createBoardToken(boardData.board.id, {
          character_id: matchId,
          x,
          y,
          gm_only: false,
        });
      }
    }
    refreshBoard(boardData.board.id);
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
      await api.updateBoardToken(boardData.board.id, tokenId, { x, y });
      refreshBoard(boardData.board.id);
    } catch (err: any) {
      console.warn('Failed to update token position:', err);
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
    const charMove = activePart.character?.stats?.move ?? 6;
    const maxMoves = selectedActionKey === 'run' ? charMove * 2 : charMove;

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

  useEffect(() => {
    if (losInfo && ['ranged', 'aimed', 'autofire'].includes(selectedActionKey || '')) {
      setDistanceM(losInfo.autoDistanceM);
    }
  }, [losInfo, selectedActionKey]);

  const meleeBlocked = useMemo(() => {
    if (!['melee', 'brawl'].includes(selectedActionKey || '')) return false;
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

  // Weapon entries in inventory for active participant (kind === 'weapon')
  const weaponEntries = useMemo(() => {
    const inv = (activePart?.character?.inventory as any[]) || [];
    return inv.filter((i: any) => i.kind === 'weapon');
  }, [activePart]);

  // Auto-select first weapon entry for active participant if none or invalid is selected
  useEffect(() => {
    if (selectedActionKey && activePart?.character) {
      const isValid = weaponEntries.some((w) => w.entry_id === selectedWeaponId);
      if (!isValid) {
        if (weaponEntries.length > 0) {
          setSelectedWeaponId(weaponEntries[0].entry_id);
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
      const { action_key, weapon_id, target_id, distance_m, aimed_location } = wsMessage.payload;
      if (action_key) setSelectedActionKey(action_key);
      if (weapon_id) setSelectedWeaponId(weapon_id);
      if (target_id) setTargetParticipantId(target_id);
      if (distance_m) setDistanceM(distance_m);
      if (aimed_location) setAimedLocation(aimed_location);
    } else if (wsMessage.type === 'combat:roll') {
      // Player submitted dice roll
      const { roll_type, first, extra, dice } = wsMessage.payload;
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

    const entries: InitiativeEntry[] = combat.participants.map((p) => {
      const ref = p.character?.stats?.ref ?? 5;
      let rollObj = initInputs[p.character_id || p.id];
      if (autoRollAll || !rollObj) {
        // Roll 1d10
        const rolledFirst = Math.floor(Math.random() * 10) + 1;
        rollObj = { first: rolledFirst };
      }
      const res = initiativeTotal(ref, rollObj.first, rollObj.extra);
      return {
        id: p.id,
        ref,
        total: res.total,
        roll: rollObj,
      };
    });

    const sorted = sortInitiative(entries, combat.settings.tieBreak || 'ref');
    const updatePayload = sorted.map((s, index) => ({
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
          distance_m: distanceM,
          dodge_mode: dodgeMode,
          attack_roll: { first: attackFirst, extra: attackExtra },
          defense_roll: dodgeMode === 'dodge' ? { first: defenseFirst, extra: defenseExtra } : undefined,
          damage_dice: damageDice.length > 0 ? damageDice : undefined,
          crit_injury_roll: critRoll,
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
          distance_m: distanceM,
          dodge_mode: dodgeMode,
          attack_roll: { first: secondAttackFirst, extra: secondAttackExtra },
          defense_roll: dodgeMode === 'dodge' ? { first: defenseFirst, extra: defenseExtra } : undefined,
          damage_dice: secondDamageDice.length > 0 ? secondDamageDice : undefined,
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
        distance_m: distanceM,
        weapon_id: selectedWeaponId || undefined,
        weapon_entry_id: selectedWeaponId || undefined,
        ignore_armor_percent: ignoreArmorToSend,
        ammo_spent: selectedActionKey === 'autofire' ? ammoSpent : undefined,
        aimed_location: aimedLocation,
        held_item_id: heldItemId || undefined,
        dodge_mode: dodgeMode,
        attack_roll: { first: attackFirst, extra: attackExtra },
        defense_roll: { first: defenseFirst, extra: defenseExtra },
        damage_dice: damageDice.length > 0 ? damageDice : undefined,
        crit_injury_roll: critRoll,
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
          distance_m: distanceM,
          dodge_mode: dodgeMode,
          attack_roll: { first: attackFirst, extra: attackExtra },
          defense_roll: dodgeMode === 'dodge' ? { first: defenseFirst, extra: defenseExtra } : undefined,
          damage_dice: damageDice.length > 0 ? damageDice : undefined,
          crit_injury_roll: critRoll,
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
          distance_m: distanceM,
          dodge_mode: dodgeMode,
          attack_roll: { first: secondAttackFirst, extra: secondAttackExtra },
          defense_roll: dodgeMode === 'dodge' ? { first: defenseFirst, extra: defenseExtra } : undefined,
          damage_dice: secondDamageDice.length > 0 ? secondDamageDice : undefined,
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
        distance_m: distanceM,
        weapon_id: selectedWeaponId || undefined,
        weapon_entry_id: selectedWeaponId || undefined,
        ignore_armor_percent: ignoreArmorToSend,
        ammo_spent: selectedActionKey === 'autofire' ? ammoSpent : undefined,
        aimed_location: aimedLocation,
        held_item_id: heldItemId || undefined,
        dodge_mode: dodgeMode,
        attack_roll: { first: attackFirst, extra: attackExtra },
        defense_roll: { first: defenseFirst, extra: defenseExtra },
        damage_dice: damageDice.length > 0 ? damageDice : undefined,
        crit_injury_roll: critRoll,
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
      });

      setCombat(res.combat);
      if (combat.board_id) {
        refreshBoard(combat.board_id);
      }
      setDestination(null);
      setHitCover(false);
      setCoverDamageInput('');
      setPickupDropId(null);
      setPreviewResult(null);
      setSelectedActionKey(null);
      setSecondAttackEnabled(false);
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
    if (!window.confirm('直前の確定結果を取り消して元に戻しますか？')) return;

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

  if (loading) {
    return <div style={{ padding: '24px', color: 'var(--color-text-muted)' }}>戦闘データを読み込み中...</div>;
  }

  // --- 1. SETUP / PARTICIPANT CHECK VIEW ---
  if (!combat || combat.status === 'setup' || combat.status === 'ended') {
    const npcList = characters.filter((c) => c.kind === 'npc' || c.kind === 'mook');

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
                              value={initInputs[p.character_id || p.id]?.first ?? ''}
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
                  onChange={(e) => setTieBreakMode(e.target.value as 'ref' | 'manual')}
                  style={{
                    width: '100%',
                    padding: '6px',
                    backgroundColor: 'var(--color-bg)',
                    border: '1px solid var(--color-border-light)',
                    borderRadius: '4px',
                    color: 'var(--color-text)',
                  }}
                >
                  <option value="ref">REFの高い順（既定）</option>
                  <option value="manual">手動で振り直す</option>
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
            >
              取り消す
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
              手番を終える
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

      {/* Board View Section */}
      {boardData ? (
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
                未配置の参加者コマを配置
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

          <BoardView
            board={boardData.board}
            objects={boardData.objects}
            tokens={boardData.tokens}
            drops={boardData.drops}
            combat={combat}
            activeParticipantId={activePart?.id}
            targetParticipantId={targetParticipantId}
            mode={selectedActionKey === 'move' || selectedActionKey === 'run' ? 'move' : 'view'}
            reachableCells={reachableCells}
            destination={destination}
            onSelectDestination={(dest) => setDestination(dest)}
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
            onUpdateObject={handleUpdateObject}
            onDeleteObject={handleDeleteObject}
            onCreateObject={handleCreateObject}
            onMoveToken={handleMoveToken}
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
      )}

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
                <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '0.85rem' }}>
                  <span style={{ color: activePart.move_used ? 'var(--color-text-muted)' : 'var(--color-ally)' }}>
                    移動アクション: {activePart.move_used ? '使用済み' : '未使用'}
                  </span>
                  <span style={{ color: activePart.action_used ? 'var(--color-text-muted)' : 'var(--color-ally)' }}>
                    アクション: {activePart.action_used ? '使用済み' : '未使用'}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-muted)', display: 'block', marginBottom: '8px' }}>
                  行動を選択:
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {actions.map((act) => {
                    const isSelected = selectedActionKey === act.key;
                    return (
                      <button
                        key={act.key}
                        onClick={() => {
                          setSelectedActionKey(act.key);
                          setPreviewResult(null);
                        }}
                        style={{
                          backgroundColor: isSelected ? 'var(--color-ally)' : 'var(--color-surface-elevated)',
                          color: isSelected ? '#000' : 'var(--color-text)',
                          border: isSelected ? 'none' : '1px solid var(--color-border-light)',
                          padding: '6px 12px',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                          fontWeight: isSelected ? 800 : 500,
                          cursor: 'pointer',
                        }}
                      >
                        {act.label}
                      </button>
                    );
                  })}
                </div>
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

                  {/* Weapon Selection (for ranged / melee / reload) */}
                  {['ranged', 'aimed', 'autofire', 'melee', 'reload'].includes(selectedActionKey) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>使用する武器を選択:</span>
                      <select
                        value={selectedWeaponId || ''}
                        onChange={(e) => setSelectedWeaponId(e.target.value || null)}
                        style={{
                          padding: '6px 10px',
                          backgroundColor: 'var(--color-bg)',
                          border: '1px solid var(--color-border-light)',
                          borderRadius: '4px',
                          color: 'var(--color-text)',
                          fontSize: '0.85rem',
                        }}
                      >
                        <option value="">-- 武器を選択してください --</option>
                        {weaponEntries.map((wOpt) => (
                          <option key={wOpt.entry_id} value={wOpt.entry_id}>
                            {wOpt.name} (残弾: {wOpt.ammo !== undefined && wOpt.ammo !== null ? wOpt.ammo : '—'})
                          </option>
                        ))}
                      </select>
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

                  {/* Autofire Ammo Spent */}
                  {selectedActionKey === 'autofire' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>消費弾数 (発):</span>
                      <input
                        type="number"
                        min={1}
                        value={ammoSpent}
                        onChange={(e) => setAmmoSpent(Number(e.target.value) || 0)}
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
                  )}

                  {/* Target & Distance Selection (for ranged / melee / brawl) */}
                  {['ranged', 'aimed', 'autofire', 'melee', 'brawl'].includes(selectedActionKey) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>対象を選択:</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {combat.participants
                          .filter((p) => p.id !== activePart.id && !p.out)
                          .map((p) => (
                            <button
                              key={p.id}
                              onClick={() => setTargetParticipantId(p.id)}
                              style={{
                                padding: '4px 10px',
                                borderRadius: '4px',
                                border: targetParticipantId === p.id ? '2px solid var(--color-enemy)' : '1px solid var(--color-border-light)',
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

                      {['ranged', 'aimed', 'autofire'].includes(selectedActionKey) && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '0.85rem' }}>距離 (m):</span>
                            <input
                              type="number"
                              min={0}
                              value={distanceM}
                              onChange={(e) => setDistanceM(Number(e.target.value) || 0)}
                              style={{
                                width: '60px',
                                padding: '4px 6px',
                                backgroundColor: 'var(--color-bg)',
                                border: '1px solid var(--color-border-light)',
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
                      {['melee', 'brawl'].includes(selectedActionKey) && meleeBlocked && (
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

                      {/* Dodge mode if applicable */}
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
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>出目の入力:</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>攻撃 1d10:</span>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={attackFirst}
                          onChange={(e) => setAttackFirst(Number(e.target.value) || 1)}
                          style={{
                            width: '46px',
                            padding: '4px',
                            textAlign: 'center',
                            backgroundColor: 'var(--color-bg)',
                            border: '1px solid var(--color-border-light)',
                            borderRadius: '4px',
                            color: 'var(--color-text)',
                          }}
                        />
                      </div>

                      {(attackFirst === 10 || attackFirst === 1) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '0.8rem', color: attackFirst === 10 ? 'var(--color-ally)' : 'var(--color-warning)' }}>
                            {attackFirst === 10 ? '攻撃クリティカル追加 (1d10):' : '攻撃ファンブル追加 (1d10):'}
                          </span>
                          <input
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
                              border: '1px solid var(--color-border-light)',
                              borderRadius: '4px',
                              color: 'var(--color-text)',
                            }}
                          />
                        </div>
                      )}

                      {dodgeMode === 'dodge' && (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>回避 1d10:</span>
                            <input
                              type="number"
                              min={1}
                              max={10}
                              value={defenseFirst}
                              onChange={(e) => setDefenseFirst(Number(e.target.value) || 1)}
                              style={{
                                width: '46px',
                                padding: '4px',
                                textAlign: 'center',
                                backgroundColor: 'var(--color-bg)',
                                border: '1px solid var(--color-border-light)',
                                borderRadius: '4px',
                                color: 'var(--color-text)',
                              }}
                            />
                          </div>

                          {(defenseFirst === 10 || defenseFirst === 1) && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '0.8rem', color: defenseFirst === 10 ? 'var(--color-ally)' : 'var(--color-warning)' }}>
                                {defenseFirst === 10 ? '回避クリティカル追加 (1d10):' : '回避ファンブル追加 (1d10):'}
                              </span>
                              <input
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
                                  border: '1px solid var(--color-border-light)',
                                  borderRadius: '4px',
                                  color: 'var(--color-text)',
                                }}
                              />
                            </div>
                          )}
                        </>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>ダメージ出目:</span>
                        <input
                          type="text"
                          value={damageDiceStr}
                          onChange={(e) => setDamageDiceStr(e.target.value)}
                          placeholder="6, 6, 2"
                          style={{
                            width: '90px',
                            padding: '4px 6px',
                            backgroundColor: 'var(--color-bg)',
                            border: '1px solid var(--color-border-light)',
                            borderRadius: '4px',
                            color: 'var(--color-text)',
                            fontSize: '0.85rem',
                          }}
                        />
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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
                            border: '1px solid var(--color-border-light)',
                            borderRadius: '4px',
                            color: 'var(--color-text)',
                          }}
                        />
                      </div>
                    </div>

                    {/* ROF 2 multi-attack option */}
                    {['ranged', 'melee'].includes(selectedActionKey) && (
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
                                value={secondAttackFirst}
                                onChange={(e) => setSecondAttackFirst(Number(e.target.value) || 1)}
                                style={{
                                  width: '46px',
                                  padding: '4px',
                                  textAlign: 'center',
                                  backgroundColor: 'var(--color-surface)',
                                  border: '1px solid var(--color-border-light)',
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
                                    border: '1px solid var(--color-border-light)',
                                    borderRadius: '4px',
                                    color: 'var(--color-text)',
                                  }}
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
                                  border: '1px solid var(--color-border-light)',
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
                    disabled={isResolving || isCoverHpNeededAndMissing}
                    title={isCoverHpNeededAndMissing ? '遮蔽物のHPを入力するまで計算できません' : undefined}
                    style={{
                      backgroundColor: 'var(--color-surface)',
                      border: '1px solid var(--color-ally)',
                      color: isCoverHpNeededAndMissing ? 'var(--color-text-muted)' : 'var(--color-ally)',
                      opacity: isCoverHpNeededAndMissing ? 0.6 : 1,
                      padding: '8px',
                      borderRadius: '4px',
                      fontWeight: 700,
                      cursor: isCoverHpNeededAndMissing ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isResolving ? '計算中...' : '判定と反映内容を計算'}
                  </button>
                  {isCoverHpNeededAndMissing && (
                    <div style={{ color: 'var(--color-warning)', fontSize: '0.8rem', marginTop: '4px' }}>
                      ※ 遮蔽物のHPを入力するまで計算できません
                    </div>
                  )}

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

    return (
      <div
        key={p.id}
        style={{
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
      </div>
    );
  }
};
