import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CharacterSheet,
  Scenario,
  ScenarioFull,
  ScenarioSession,
  SessionLogEntry,
  SKILL_CATALOG,
  formatSkillName,
} from '@cyberpgm/shared';
import { BoardView } from './BoardView.js';
import { StoryCheckRow, StoryCheckView } from './StoryCheckRow.js';
import { StagePanel } from './StagePanel.js';
import { getGmToken, gmFetch } from '../api.js';
import { useWebSocket } from '../hooks/useWebSocket.js';

interface ScenarioPlayViewProps {
  characters: CharacterSheet[];
}

const DV_PRESETS = [
  { label: '日常的', dv: 13 },
  { label: '困難', dv: 15 },
  { label: '専門的', dv: 17 },
  { label: '英雄的', dv: 21 },
  { label: '非現実的', dv: 24 },
];

export const ScenarioPlayView: React.FC<ScenarioPlayViewProps> = ({ characters }) => {
  // Scenario sessions & data
  const [activeSession, setActiveSession] = useState<ScenarioSession | null>(null);
  const [allScenarios, setAllScenarios] = useState<Scenario[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('');
  const [scenarioData, setScenarioData] = useState<ScenarioFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Checks and logs
  const [checks, setChecks] = useState<StoryCheckView[]>([]);
  const [logs, setLogs] = useState<SessionLogEntry[]>([]);
  const [noteInput, setNoteInput] = useState('');

  // Adhoc scene & choice states
  const [showAdhocSceneModal, setShowAdhocSceneModal] = useState(false);
  const [adhocSceneTitle, setAdhocSceneTitle] = useState('');
  const [showAdhocChoiceModal, setShowAdhocChoiceModal] = useState(false);
  const [adhocChoiceLabel, setAdhocChoiceLabel] = useState('');
  const [adhocChoiceSkill, setAdhocChoiceSkill] = useState('');
  const [adhocChoiceDv, setAdhocChoiceDv] = useState<number | null>(null);
  const [adhocChoiceWho] = useState('全員');

  // Group check setup modal
  const [showGroupCheckModal, setShowGroupCheckModal] = useState(false);
  const [groupCheckSkill, setGroupCheckSkill] = useState('');
  const [groupCheckDv, setGroupCheckDv] = useState<number | null>(null);

  // Projections
  const [, setTvProjectedImage] = useState<string | null>(null);
  const [, setPlayerProjectedImage] = useState<string | null>(null);

  // WebSocket for real-time check updates & player choices
  useWebSocket({
    token: getGmToken(),
    onMessage: (type, payload: any) => {
      if (type === 'story:check_update') {
        if (activeSession && payload?.scenario_session_id === activeSession.id) {
          fetchChecks(activeSession.id);
          fetchLogs(activeSession.id);
        }
      }
    },
  });

  // Fetch active session and scenario list
  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionRes, scenariosRes] = await Promise.all([
        gmFetch('/api/scenario-sessions/active').then((r) => r.json()),
        gmFetch('/api/scenarios').then((r) => r.json()),
      ]);

      const scenarioList: Scenario[] = scenariosRes?.scenarios ?? [];
      setAllScenarios(scenarioList);
      if (scenarioList.length > 0) {
        setSelectedScenarioId(scenarioList[0].id);
      }

      if (sessionRes?.session) {
        setActiveSession(sessionRes.session);
        // Load scenario full details
        const fullRes = await gmFetch(`/api/scenarios/${sessionRes.session.scenario_id}`).then((r) => r.json());
        setScenarioData(fullRes);
        await Promise.all([
          fetchChecks(sessionRes.session.id),
          fetchLogs(sessionRes.session.id),
        ]);
      } else {
        setActiveSession(null);
        setScenarioData(null);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'データ取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const fetchChecks = async (sessionId: string) => {
    try {
      const res = await gmFetch(`/api/scenario-sessions/${sessionId}/checks`).then((r) => r.json());
      setChecks(res.checks || []);
    } catch {
      // ignore
    }
  };

  const fetchLogs = async (sessionId: string) => {
    try {
      const res = await gmFetch(`/api/scenario-sessions/${sessionId}/logs`).then((r) => r.json());
      setLogs(res.logs || []);
    } catch {
      // ignore
    }
  };

  // Start scenario session
  const handleStartSession = async () => {
    if (!selectedScenarioId) return;
    setErrorMsg(null);
    try {
      const res = await gmFetch('/api/scenario-sessions/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario_id: selectedScenarioId }),
      }).then((r) => r.json());

      if (res.error) throw new Error(res.error);
      setSuccessMsg('シナリオ進行を開始しました');
      loadInitialData();
    } catch (err: any) {
      setErrorMsg(err.message || '進行開始に失敗しました');
    }
  };

  // End scenario session
  const handleEndSession = async () => {
    if (!activeSession) return;
    if (!confirm('現在のシナリオ進行を終了しますか？ログは保存されます。')) return;
    try {
      await gmFetch(`/api/scenario-sessions/${activeSession.id}/end`, {
        method: 'POST',
      });
      setSuccessMsg('シナリオ進行を終了しました');
      setActiveSession(null);
      loadInitialData();
    } catch (err: any) {
      setErrorMsg(err.message || '進行終了に失敗しました');
    }
  };

  // Navigate to scene
  const handleMoveScene = async (sceneId: string) => {
    if (!activeSession) return;
    try {
      await gmFetch(`/api/scenario-sessions/${activeSession.id}/move-scene`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene_id: sceneId }),
      });
      setActiveSession({
        ...activeSession,
        current_scene_id: sceneId,
      });
      fetchLogs(activeSession.id);
    } catch (err: any) {
      setErrorMsg(err.message || 'シーン移動に失敗しました');
    }
  };

  // Add adhoc scene
  const handleCreateAdhocScene = async () => {
    if (!activeSession || !adhocSceneTitle.trim()) return;
    try {
      const res = await gmFetch(`/api/scenario-sessions/${activeSession.id}/adhoc-scene`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: adhocSceneTitle.trim() }),
      }).then((r) => r.json());

      if (res.error) throw new Error(res.error);
      setShowAdhocSceneModal(false);
      setAdhocSceneTitle('');
      setSuccessMsg(`臨時シーン「${res.title}」を追加しました`);
      loadInitialData();
    } catch (err: any) {
      setErrorMsg(err.message || '臨時シーン追加に失敗しました');
    }
  };

  // Fog update on board
  const handleUpdateBoardFog = async (boardId: string, fog: { x: number; y: number }[]) => {
    try {
      await gmFetch(`/api/boards/${boardId}/fog`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fog }),
      });
    } catch (err: any) {
      console.error('Fog update failed:', err);
    }
  };

  // Project image to TV or Player
  const handleProjectImage = async (imageId: string | null, imagePath: string | null, target: 'tv' | 'players' | 'all') => {
    if (!activeSession) return;
    setErrorMsg(null);
    try {
      const res = await gmFetch(`/api/scenario-sessions/${activeSession.id}/project-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_id: imageId, image_path: imagePath, target }),
      }).then((r) => r.json());

      if (res.error) throw new Error(res.error);
      if (target === 'tv' || target === 'all') setTvProjectedImage(res.image_path);
      if (target === 'players' || target === 'all') setPlayerProjectedImage(res.image_path);
      setSuccessMsg(target === 'tv' ? 'TVに投影しました' : target === 'players' ? 'プレイヤー画面に表示しました' : '投影しました');
    } catch (err: any) {
      setErrorMsg(err.message || '投影に失敗しました');
    }
  };

  // Publish choices to player mobile
  const handlePublishChoices = async (sceneId: string, choiceIds?: string[]) => {
    if (!activeSession) return;
    try {
      await gmFetch(`/api/scenario-sessions/${activeSession.id}/choices/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene_id: sceneId, choice_ids: choiceIds }),
      });
      setSuccessMsg('プレイヤー画面に選択肢を公開しました');
    } catch (err: any) {
      setErrorMsg(err.message || '選択肢の公開に失敗しました');
    }
  };

  // Add adhoc choice
  const handleAddAdhocChoice = async () => {
    if (!activeSession || !adhocChoiceLabel.trim()) return;
    try {
      const res = await gmFetch(`/api/scenario-sessions/${activeSession.id}/choices/adhoc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: adhocChoiceLabel.trim(),
          skill_key: adhocChoiceSkill || null,
          dv: adhocChoiceDv,
          who: adhocChoiceWho,
        }),
      }).then((r) => r.json());

      if (res.error) throw new Error(res.error);
      setShowAdhocChoiceModal(false);
      setAdhocChoiceLabel('');
      setSuccessMsg('選択肢を追加しました');
      loadInitialData();
    } catch (err: any) {
      setErrorMsg(err.message || '選択肢追加に失敗しました');
    }
  };

  // Reveal / unreveal clue or handout
  const handleToggleReveal = async (kind: 'clue' | 'handout', itemId: string, currentRevealed: boolean, showOnTv = false) => {
    if (!activeSession) return;
    setErrorMsg(null);
    try {
      const endpoint = currentRevealed ? 'unreveal' : 'reveal';
      const res = await gmFetch(`/api/scenario-sessions/${activeSession.id}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, itemId, show_on_tv: showOnTv }),
      }).then((r) => r.json());

      if (res.error) throw new Error(res.error);
      setActiveSession({
        ...activeSession,
        revealed: res.revealed,
      });
      fetchLogs(activeSession.id);
      setSuccessMsg(currentRevealed ? '非公開にしました' : '公開しました');
    } catch (err: any) {
      setErrorMsg(err.message || '公開操作に失敗しました');
    }
  };

  // Create check line for PC
  const handleCreateCheck = async (charId: string, skillKey: string, dv: number, choiceId?: string) => {
    if (!activeSession) return;
    try {
      await gmFetch(`/api/scenario-sessions/${activeSession.id}/checks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor_character_ids: [charId],
          skill_key: skillKey,
          dv,
          choice_id: choiceId,
        }),
      });
      fetchChecks(activeSession.id);
    } catch (err: any) {
      setErrorMsg(err.message || '判定の作成に失敗しました');
    }
  };

  // Create group check (all PCs in party)
  const handleCreateGroupCheck = async () => {
    if (!activeSession) return;
    const pcIds = characters.map((c) => c.id);
    if (pcIds.length === 0) {
      setErrorMsg('判定対象のPCが存在しません');
      return;
    }
    try {
      await gmFetch(`/api/scenario-sessions/${activeSession.id}/checks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor_character_ids: pcIds,
          skill_key: groupCheckSkill,
          dv: groupCheckDv,
        }),
      });
      setShowGroupCheckModal(false);
      fetchChecks(activeSession.id);
      setSuccessMsg('全員分の判定を作成しました');
    } catch (err: any) {
      setErrorMsg(err.message || '全員判定の作成に失敗しました');
    }
  };

  // Evaluate roll on check
  const handleRollCheck = async (checkId: string, rolls: number[], opposedRolls?: number[]) => {
    if (!activeSession) return;
    try {
      const res = await gmFetch(`/api/scenario-sessions/${activeSession.id}/checks/${checkId}/roll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rolls, opposed_rolls: opposedRolls }),
      }).then((r) => r.json());

      if (res.error) throw new Error(res.error);
      if (res.missing_inputs?.length) setErrorMsg(res.missing_inputs.join(' / '));
      fetchChecks(activeSession.id);
      fetchLogs(activeSession.id);
    } catch (err: any) {
      setErrorMsg(err.message || '判定ダイス送信に失敗しました');
    }
  };

  // Change skill / difficulty / opposed target of a check row
  const handlePatchCheck = async (checkId: string, body: Record<string, unknown>) => {
    if (!activeSession) return;
    try {
      const res = await gmFetch(`/api/scenario-sessions/${activeSession.id}/checks/${checkId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      fetchChecks(activeSession.id);
    } catch (err: any) {
      setErrorMsg(err.message || '判定の変更に失敗しました');
    }
  };

  // Apply consequences
  const handleApplyCheck = async (checkId: string) => {
    if (!activeSession) return;
    try {
      const res = await gmFetch(`/api/scenario-sessions/${activeSession.id}/checks/${checkId}/apply`, {
        method: 'POST',
      }).then((r) => r.json());

      if (res.error) throw new Error(res.error);
      setSuccessMsg(`判定結果を反映しました: ${res.summary?.join(' / ') || '完了'}`);
      loadInitialData();
    } catch (err: any) {
      setErrorMsg(err.message || '反映に失敗しました');
    }
  };

  // Undo consequences
  const handleUndoCheck = async (checkId: string) => {
    if (!activeSession) return;
    try {
      const res = await gmFetch(`/api/scenario-sessions/${activeSession.id}/checks/${checkId}/undo`, {
        method: 'POST',
      }).then((r) => r.json());

      if (res.error) throw new Error(res.error);
      setSuccessMsg('反映を取り消しました');
      loadInitialData();
    } catch (err: any) {
      setErrorMsg(err.message || '取り消しに失敗しました');
    }
  };

  // Add session note
  const handleAddNote = async () => {
    if (!activeSession || !noteInput.trim()) return;
    try {
      await gmFetch(`/api/scenario-sessions/${activeSession.id}/logs/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: noteInput.trim() }),
      });
      setNoteInput('');
      fetchLogs(activeSession.id);
    } catch (err: any) {
      setErrorMsg(err.message || 'メモ記録に失敗しました');
    }
  };

  // Start encounter combat transition
  const handleStartCombatFromEncounter = async (encounterId: string) => {
    if (!activeSession) return;
    if (!confirm('このエンカウンターで戦闘を開始しますか？参加者が自動配置されます。')) return;
    try {
      const res = await gmFetch(`/api/scenarios/encounters/${encounterId}/start-combat`, {
        method: 'POST',
      }).then((r) => r.json());

      if (res.error) throw new Error(res.error);
      setSuccessMsg('戦闘を開始しました。「戦闘」タブに切り替えて進行してください。');
      fetchLogs(activeSession.id);
    } catch (err: any) {
      setErrorMsg(err.message || '戦闘開始に失敗しました');
    }
  };

  // Identify current scene
  const currentScene = useMemo(() => {
    if (!scenarioData || !activeSession?.current_scene_id) return null;
    return scenarioData.scenes.find((s) => s.id === activeSession.current_scene_id) || null;
  }, [scenarioData, activeSession?.current_scene_id]);

  const [activeBoard, setActiveBoard] = useState<any | null>(null);

  useEffect(() => {
    if (currentScene?.board_id) {
      gmFetch(`/api/boards/${currentScene.board_id}`)
        .then((r) => r.json())
        .then((b) => setActiveBoard(b))
        .catch(() => setActiveBoard(null));
    } else {
      setActiveBoard(null);
    }
  }, [currentScene?.board_id]);

  const sceneChoices = useMemo(() => {
    if (!scenarioData || !currentScene) return [];
    return scenarioData.choices.filter((ch) => ch.scene_id === currentScene.id);
  }, [scenarioData, currentScene]);

  const sceneEncounter = useMemo(() => {
    if (!scenarioData || !currentScene) return null;
    return scenarioData.encounters.find((e) => e.scene_id === currentScene.id) || null;
  }, [scenarioData, currentScene]);

  // Set of visited scene IDs
  const visitedSceneIds = useMemo(() => {
    const set = new Set<string>();
    for (const l of logs) {
      if (l.kind === 'scene' && l.ref?.scene_id) {
        set.add(l.ref.scene_id);
      }
    }
    if (activeSession?.current_scene_id) {
      set.add(activeSession.current_scene_id);
    }
    return set;
  }, [logs, activeSession?.current_scene_id]);

  if (loading) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
        進行データを読み込み中…
      </div>
    );
  }

  // 1. Idle state (No active session)
  if (!activeSession) {
    return (
      <div
        style={{
          padding: '40px 24px',
          maxWidth: '680px',
          margin: '0 auto',
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '8px', color: 'var(--color-ally)' }}>
            シナリオ進行（Play モード）
          </h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
            現在アクティブなシナリオ進行セッションはありません。シナリオを選択して進行を開始してください。
          </p>
        </div>

        {errorMsg && (
          <div style={{ padding: '12px', backgroundColor: 'rgba(235, 75, 75, 0.15)', border: '1px solid var(--color-accent)', borderRadius: '6px', color: 'var(--color-accent)', fontSize: '0.9rem' }}>
            {errorMsg}
          </div>
        )}

        {allScenarios.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-muted)' }}>
            作成されたシナリオがありません。「作る」モードでシナリオを作成してください。
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '6px' }}>
                進行するシナリオ:
              </label>
              <select
                value={selectedScenarioId}
                onChange={(e) => setSelectedScenarioId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: 'var(--color-bg)',
                  border: '1px solid var(--color-border-light)',
                  borderRadius: '6px',
                  color: 'var(--color-text)',
                  fontSize: '1rem',
                }}
              >
                {allScenarios.map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.title}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleStartSession}
              style={{
                padding: '14px',
                backgroundColor: 'var(--color-ally)',
                color: '#000',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 700,
                fontSize: '1.05rem',
                cursor: 'pointer',
                marginTop: '8px',
              }}
            >
              進行を開始する
            </button>
          </div>
        )}
      </div>
    );
  }

  // 2. Active Session Play View
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 120px)',
        gap: '12px',
        overflow: 'hidden',
      }}
    >
      {/* Top Banner: Scenario Title, Elapsed Time, Controls */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          padding: '10px 16px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--color-ally)' }}>
            進行中: {scenarioData?.scenario.title || 'シナリオ'}
          </span>
          <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            現在シーン: <strong style={{ color: 'var(--color-text)' }}>{currentScene?.title || '未選択'}</strong>
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
            開始: {new Date(activeSession.started_at).toLocaleTimeString('ja-JP')}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {successMsg && (
            <span style={{ fontSize: '0.85rem', color: 'var(--color-success)', fontWeight: 600 }}>
              {successMsg}
            </span>
          )}
          {errorMsg && (
            <span style={{ fontSize: '0.85rem', color: 'var(--color-accent)', fontWeight: 600 }}>
              {errorMsg}
            </span>
          )}
          <button
            type="button"
            onClick={handleEndSession}
            style={{
              padding: '6px 12px',
              backgroundColor: 'rgba(235, 75, 75, 0.15)',
              border: '1px solid var(--color-accent)',
              borderRadius: '4px',
              color: 'var(--color-accent)',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            進行終了
          </button>
        </div>
      </div>

      {/* 3 Columns Layout */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '260px 1fr 340px',
          gap: '12px',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* Left Column: Scene Navigation List */}
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '12px',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>シーン一覧</span>
            <button
              type="button"
              onClick={() => setShowAdhocSceneModal(true)}
              style={{
                padding: '4px 8px',
                backgroundColor: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border-light)',
                borderRadius: '4px',
                fontSize: '0.75rem',
                color: 'var(--color-ally)',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              ＋ 臨時シーン
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {scenarioData?.scenes.map((sc) => {
              const isCurrent = sc.id === activeSession.current_scene_id;
              const isVisited = visitedSceneIds.has(sc.id);

              return (
                <div
                  key={sc.id}
                  onClick={() => handleMoveScene(sc.id)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: isCurrent ? '2px solid var(--color-ally)' : '1px solid var(--color-border-light)',
                    backgroundColor: isCurrent ? 'rgba(79, 182, 227, 0.15)' : 'var(--color-surface-elevated)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: isCurrent ? 700 : 500, fontSize: '0.85rem' }}>
                      {sc.title}
                    </span>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        backgroundColor: isVisited ? 'rgba(46, 204, 113, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                        color: isVisited ? 'var(--color-success)' : 'var(--color-text-muted)',
                      }}
                    >
                      {isVisited ? '既読' : '未読'}
                    </span>
                  </div>
                  {sc.location && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      場所: {sc.location}
                    </span>
                  )}
                  {sc.is_adhoc && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--color-warning)' }}>
                      [臨時]
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Center Column: Current Scene Detail & Board/Art */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            overflowY: 'auto',
          }}
        >
          {currentScene ? (
            <>
              {/* Scene Description Card */}
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-text)' }}>
                    {currentScene.title}
                  </h3>
                  {currentScene.location && (
                    <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                      場所: {currentScene.location}
                    </span>
                  )}
                </div>

                {currentScene.read_aloud && (
                  <div
                    style={{
                      padding: '12px',
                      backgroundColor: 'var(--color-surface-elevated)',
                      borderLeft: '4px solid var(--color-ally)',
                      borderRadius: '4px',
                      fontSize: '0.9rem',
                      lineHeight: 1.6,
                      color: 'var(--color-text)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-ally)', marginBottom: '4px' }}>
                      【描写・朗読】
                    </div>
                    {currentScene.read_aloud}
                  </div>
                )}

                {currentScene.gm_notes && (
                  <div
                    style={{
                      padding: '10px',
                      backgroundColor: 'rgba(235, 179, 58, 0.08)',
                      borderLeft: '4px solid var(--color-warning)',
                      borderRadius: '4px',
                      fontSize: '0.85rem',
                      lineHeight: 1.5,
                      color: 'var(--color-text-muted)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-warning)', marginBottom: '2px' }}>
                      【GMメモ】
                    </div>
                    {currentScene.gm_notes}
                  </div>
                )}

                {/* Projection controls for scene background */}
                {currentScene.background_image_id && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>背景画像:</span>
                    <button
                      type="button"
                      onClick={() => handleProjectImage(currentScene.background_image_id || null, null, 'tv')}
                      style={{
                        padding: '4px 10px',
                        backgroundColor: 'var(--color-surface-elevated)',
                        border: '1px solid var(--color-border-light)',
                        borderRadius: '4px',
                        fontSize: '0.8rem',
                        color: 'var(--color-text)',
                        cursor: 'pointer',
                      }}
                    >
                      TVに出す
                    </button>
                    <button
                      type="button"
                      onClick={() => handleProjectImage(currentScene.background_image_id || null, null, 'players')}
                      style={{
                        padding: '4px 10px',
                        backgroundColor: 'var(--color-surface-elevated)',
                        border: '1px solid var(--color-border-light)',
                        borderRadius: '4px',
                        fontSize: '0.8rem',
                        color: 'var(--color-text)',
                        cursor: 'pointer',
                      }}
                    >
                      プレイヤーに出す
                    </button>
                  </div>
                )}
              </div>

              {/* Board View with Fog controls if scene has board */}
              {currentScene.board_id && activeBoard && (
                <div
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    padding: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    minHeight: '400px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>シーン盤面</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (sceneEncounter) {
                          handleStartCombatFromEncounter(sceneEncounter.id);
                        } else {
                          alert('このシーンに設定されたエンカウンターがありません');
                        }
                      }}
                      style={{
                        padding: '4px 12px',
                        backgroundColor: 'var(--color-enemy)',
                        color: '#000',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      戦闘に入る
                    </button>
                  </div>

                  <div style={{ flex: 1, minHeight: '360px', position: 'relative' }}>
                    <BoardView
                      board={activeBoard}
                      objects={activeBoard.objects || []}
                      tokens={activeBoard.tokens || []}
                      isGm={true}
                      onUpdateFog={(newFog) => handleUpdateBoardFog(activeBoard.id, newFog)}
                      style={{ height: '360px' }}
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
              シーンを選択してください
            </div>
          )}
        </div>

        {/* Right Column: Choices, Check Board, Clues & Handouts */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            overflowY: 'auto',
          }}
        >
          {/* Section A: Published Choices */}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>選択肢</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => currentScene && handlePublishChoices(currentScene.id)}
                  style={{
                    padding: '3px 8px',
                    backgroundColor: 'rgba(79, 182, 227, 0.2)',
                    border: '1px solid var(--color-ally)',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    color: 'var(--color-ally)',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  プレイヤーに公開
                </button>
                <button
                  type="button"
                  onClick={() => setShowAdhocChoiceModal(true)}
                  style={{
                    padding: '3px 8px',
                    backgroundColor: 'var(--color-surface-elevated)',
                    border: '1px solid var(--color-border-light)',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    color: 'var(--color-text)',
                    cursor: 'pointer',
                  }}
                >
                  ＋ 追加
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {sceneChoices.length > 0 ? (
                sceneChoices.map((ch) => (
                  <div
                    key={ch.id}
                    style={{
                      padding: '8px',
                      backgroundColor: 'var(--color-surface-elevated)',
                      border: '1px solid var(--color-border-light)',
                      borderRadius: '4px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{ch.label}</span>
                      {ch.who && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', backgroundColor: 'var(--color-surface)', padding: '1px 4px', borderRadius: '3px' }}>
                          {ch.who}
                        </span>
                      )}
                    </div>
                    {ch.skill_key && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-ally)' }}>
                          {formatSkillName(ch.skill_key)} vs 難易度 {ch.dv ?? '—'}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (characters.length > 0) {
                              handleCreateCheck(characters[0].id, ch.skill_key!, ch.dv ?? 13, ch.id);
                            }
                          }}
                          style={{
                            padding: '2px 6px',
                            backgroundColor: 'var(--color-surface)',
                            border: '1px solid var(--color-border-light)',
                            borderRadius: '3px',
                            fontSize: '0.7rem',
                            color: 'var(--color-text)',
                            cursor: 'pointer',
                          }}
                        >
                          判定作成
                        </button>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  このシーンの選択肢はありません
                </span>
              )}
            </div>
          </div>

          {/* Section B: Check Board (判定ボード) */}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>判定ボード</span>
              <button
                type="button"
                onClick={() => setShowGroupCheckModal(true)}
                style={{
                  padding: '3px 8px',
                  backgroundColor: 'rgba(235, 179, 58, 0.2)',
                  border: '1px solid var(--color-warning)',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  color: 'var(--color-warning)',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                全員判定
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {checks.map((chk) => (
                <StoryCheckRow
                  key={chk.id}
                  check={chk}
                  characters={characters}
                  onPatch={(body) => handlePatchCheck(chk.id, body)}
                  onRoll={(rolls, opposedRolls) => handleRollCheck(chk.id, rolls, opposedRolls)}
                  onApply={() => handleApplyCheck(chk.id)}
                  onUndo={() => handleUndoCheck(chk.id)}
                />
              ))}
              {checks.length === 0 && (
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  判定待ちはありません
                </span>
              )}
            </div>
          </div>

          {/* 舞台（表示ウィンドウの背景・立ち絵・BGM）。GM のメインウィンドウだけ */}
          <StagePanel key={activeSession.current_scene_id ?? 'none'} characters={characters} />

          {/* Section: Encounters of this scenario（盤面がなくても戦闘に入れられる） */}
          {scenarioData && scenarioData.encounters.length > 0 && (
            <div
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>エンカウンター</span>
              {scenarioData.encounters
                .slice()
                .sort((a, b) => Number(b.scene_id === currentScene?.id) - Number(a.scene_id === currentScene?.id))
                .map((enc) => (
                  <div key={enc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.8rem' }}>
                      {enc.title}
                      <span style={{ color: 'var(--color-text-muted)', marginLeft: '6px' }}>
                        {enc.participants
                          .map((p) => `${characters.find((c) => c.id === p.character_id)?.name ?? '—'}${p.count > 1 ? ` ×${p.count}` : ''}`)
                          .join('、')}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleStartCombatFromEncounter(enc.id)}
                      style={{
                        padding: '3px 8px',
                        backgroundColor: 'rgba(242, 140, 56, 0.2)',
                        border: '1px solid var(--color-enemy)',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        color: 'var(--color-enemy)',
                        cursor: 'pointer',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      戦闘に入れる
                    </button>
                  </div>
                ))}
            </div>
          )}

          {/* Section C: Clues & Handouts */}
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
            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>手掛かり・ハンドアウト</span>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {/* Clues */}
              {scenarioData?.clues.map((cl) => {
                const isRevealed = activeSession.revealed.clue_ids.includes(cl.id);
                return (
                  <div
                    key={cl.id}
                    style={{
                      padding: '8px',
                      backgroundColor: 'var(--color-surface-elevated)',
                      border: '1px solid var(--color-border-light)',
                      borderRadius: '4px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>[手掛かり] {cl.title}</span>
                      <button
                        type="button"
                        onClick={() => handleToggleReveal('clue', cl.id, isRevealed)}
                        style={{
                          padding: '2px 6px',
                          backgroundColor: isRevealed ? 'rgba(46, 204, 113, 0.2)' : 'var(--color-surface)',
                          border: `1px solid ${isRevealed ? 'var(--color-success)' : 'var(--color-border-light)'}`,
                          borderRadius: '3px',
                          fontSize: '0.7rem',
                          color: isRevealed ? 'var(--color-success)' : 'var(--color-text)',
                          cursor: 'pointer',
                        }}
                      >
                        {isRevealed ? '公開中' : '公開'}
                      </button>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      {cl.body}
                    </p>
                  </div>
                );
              })}

              {/* Handouts */}
              {scenarioData?.handouts.map((h) => {
                const isRevealed = activeSession.revealed.handout_ids.includes(h.id);
                return (
                  <div
                    key={h.id}
                    style={{
                      padding: '8px',
                      backgroundColor: 'var(--color-surface-elevated)',
                      border: '1px solid var(--color-border-light)',
                      borderRadius: '4px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>[資料] {h.title}</span>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          type="button"
                          onClick={() => handleToggleReveal('handout', h.id, isRevealed, true)}
                          style={{
                            padding: '2px 6px',
                            backgroundColor: 'var(--color-surface)',
                            border: '1px solid var(--color-border-light)',
                            borderRadius: '3px',
                            fontSize: '0.7rem',
                            color: 'var(--color-text)',
                            cursor: 'pointer',
                          }}
                        >
                          TVに出す
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleReveal('handout', h.id, isRevealed)}
                          style={{
                            padding: '2px 6px',
                            backgroundColor: isRevealed ? 'rgba(46, 204, 113, 0.2)' : 'var(--color-surface)',
                            border: `1px solid ${isRevealed ? 'var(--color-success)' : 'var(--color-border-light)'}`,
                            borderRadius: '3px',
                            fontSize: '0.7rem',
                            color: isRevealed ? 'var(--color-success)' : 'var(--color-text)',
                            cursor: 'pointer',
                          }}
                        >
                          {isRevealed ? '公開中' : '公開'}
                        </button>
                      </div>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      {h.body}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Section: Real-time Session Log */}
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          height: '140px',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '6px 12px',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'var(--color-surface-elevated)',
          }}
        >
          <span style={{ fontWeight: 700, fontSize: '0.8rem' }}>セッションログ</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="text"
              placeholder="GMメモを入力…"
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
              style={{
                width: '260px',
                padding: '4px 8px',
                backgroundColor: 'var(--color-bg)',
                border: '1px solid var(--color-border-light)',
                borderRadius: '4px',
                color: 'var(--color-text)',
                fontSize: '0.8rem',
              }}
            />
            <button
              type="button"
              onClick={handleAddNote}
              style={{
                padding: '4px 10px',
                backgroundColor: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border-light)',
                borderRadius: '4px',
                fontSize: '0.75rem',
                color: 'var(--color-text)',
                cursor: 'pointer',
              }}
            >
              記録
            </button>
            <a
              href={`/api/scenario-sessions/${activeSession.id}/logs/export`}
              download
              style={{
                padding: '4px 10px',
                backgroundColor: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border-light)',
                borderRadius: '4px',
                fontSize: '0.75rem',
                color: 'var(--color-ally)',
                textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              ログ書き出し
            </a>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 12px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {logs.map((l) => (
            <div key={l.id} style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>
              <span style={{ opacity: 0.7 }}>[{new Date(l.at).toLocaleTimeString('ja-JP')}]</span>{' '}
              <span style={{ color: l.kind === 'check' ? 'var(--color-ally)' : l.kind === 'scene' ? 'var(--color-warning)' : 'var(--color-text)' }}>
                {l.text}
              </span>
            </div>
          ))}
          {logs.length === 0 && (
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>ログはまだありません</span>
          )}
        </div>
      </div>

      {/* Modal: Adhoc Scene */}
      {showAdhocSceneModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '20px',
              maxWidth: '400px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>臨時シーン追加</h3>
            <input
              type="text"
              placeholder="シーン名（例: 路地裏の密談）"
              value={adhocSceneTitle}
              onChange={(e) => setAdhocSceneTitle(e.target.value)}
              style={{
                padding: '8px 12px',
                backgroundColor: 'var(--color-bg)',
                border: '1px solid var(--color-border-light)',
                borderRadius: '4px',
                color: 'var(--color-text)',
                fontSize: '0.9rem',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setShowAdhocSceneModal(false)}
                style={{
                  padding: '6px 12px',
                  backgroundColor: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-border-light)',
                  borderRadius: '4px',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                }}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleCreateAdhocScene}
                disabled={!adhocSceneTitle.trim()}
                style={{
                  padding: '6px 16px',
                  backgroundColor: 'var(--color-ally)',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#000',
                  fontWeight: 700,
                  cursor: adhocSceneTitle.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                追加して移動
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Adhoc Choice */}
      {showAdhocChoiceModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '20px',
              maxWidth: '420px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>選択肢追加</h3>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: '4px' }}>
                行動テキスト:
              </label>
              <input
                type="text"
                placeholder="例: 防犯カメラの映像をハックする"
                value={adhocChoiceLabel}
                onChange={(e) => setAdhocChoiceLabel(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: 'var(--color-bg)',
                  border: '1px solid var(--color-border-light)',
                  borderRadius: '4px',
                  color: 'var(--color-text)',
                  fontSize: '0.9rem',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: '4px' }}>
                判定スキル:
              </label>
              <select
                value={adhocChoiceSkill}
                onChange={(e) => setAdhocChoiceSkill(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  backgroundColor: 'var(--color-bg)',
                  border: '1px solid var(--color-border-light)',
                  borderRadius: '4px',
                  color: 'var(--color-text)',
                  fontSize: '0.85rem',
                }}
              >
                <option value="">（判定なし）</option>
                {Object.keys(SKILL_CATALOG).map((key) => (
                  <option key={key} value={key}>
                    {formatSkillName(key)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: '4px' }}>
                難易度:
              </label>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  type="number"
                  value={adhocChoiceDv ?? ''}
                  placeholder="空欄なら GM が後で決める"
                  onChange={(e) => setAdhocChoiceDv(e.target.value === '' ? null : parseInt(e.target.value, 10))}
                  style={{
                    width: '80px',
                    padding: '6px',
                    backgroundColor: 'var(--color-bg)',
                    border: '1px solid var(--color-border-light)',
                    borderRadius: '4px',
                    color: 'var(--color-text)',
                    fontSize: '0.9rem',
                    textAlign: 'center',
                  }}
                />
                <div style={{ display: 'flex', gap: '4px' }}>
                  {DV_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setAdhocChoiceDv(p.dv)}
                      style={{
                        padding: '3px 6px',
                        backgroundColor: adhocChoiceDv === p.dv ? 'var(--color-ally)' : 'var(--color-surface-elevated)',
                        color: adhocChoiceDv === p.dv ? '#000' : 'var(--color-text-muted)',
                        border: '1px solid var(--color-border-light)',
                        borderRadius: '3px',
                        fontSize: '0.7rem',
                        cursor: 'pointer',
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
              <button
                type="button"
                onClick={() => setShowAdhocChoiceModal(false)}
                style={{
                  padding: '6px 12px',
                  backgroundColor: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-border-light)',
                  borderRadius: '4px',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                }}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleAddAdhocChoice}
                disabled={!adhocChoiceLabel.trim()}
                style={{
                  padding: '6px 16px',
                  backgroundColor: 'var(--color-ally)',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#000',
                  fontWeight: 700,
                  cursor: adhocChoiceLabel.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                追加
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Group Check Setup */}
      {showGroupCheckModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '20px',
              maxWidth: '400px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>全員判定の作成</h3>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: '4px' }}>
                技能:
              </label>
              <select
                value={groupCheckSkill}
                onChange={(e) => setGroupCheckSkill(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  backgroundColor: 'var(--color-bg)',
                  border: '1px solid var(--color-border-light)',
                  borderRadius: '4px',
                  color: 'var(--color-text)',
                  fontSize: '0.9rem',
                }}
              >
                <option value="">技能を選ぶ</option>
                {Object.keys(SKILL_CATALOG).map((key) => (
                  <option key={key} value={key}>
                    {formatSkillName(key)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: '4px' }}>
                難易度:
              </label>
              <input
                type="number"
                value={groupCheckDv ?? ''}
                onChange={(e) => setGroupCheckDv(e.target.value === '' ? null : parseInt(e.target.value, 10))}
                style={{
                  width: '100%',
                  padding: '8px',
                  backgroundColor: 'var(--color-bg)',
                  border: '1px solid var(--color-border-light)',
                  borderRadius: '4px',
                  color: 'var(--color-text)',
                  fontSize: '0.9rem',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
              <button
                type="button"
                onClick={() => setShowGroupCheckModal(false)}
                style={{
                  padding: '6px 12px',
                  backgroundColor: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-border-light)',
                  borderRadius: '4px',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                }}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleCreateGroupCheck}
                style={{
                  padding: '6px 16px',
                  backgroundColor: 'var(--color-ally)',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#000',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                全員分作成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
