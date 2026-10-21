import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  CharacterSheet,
  Scenario,
  ScenarioFull,
  Scene,
  SceneLink,
  SceneChoice,
  RandomTable,
  SKILL_CATALOG,
  formatSkillName,
  validateRandomTableRanges,
} from '@cyberpgm/shared';
import { api } from '../api.js';
import { SceneBgmField } from './SceneBgmField.js';

interface ScenarioMakerViewProps {
  characters: CharacterSheet[];
}

const DV_PRESETS = [
  { label: '日常的', dv: 13 },
  { label: '困難', dv: 15 },
  { label: '専門的', dv: 17 },
  { label: '英雄的', dv: 21 },
  { label: '非現実的', dv: 24 },
];

export const ScenarioMakerView: React.FC<ScenarioMakerViewProps> = ({ characters }) => {
  // Scenario List & Active Scenario State
  const [scenariosList, setScenariosList] = useState<Scenario[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [scenarioData, setScenarioData] = useState<ScenarioFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Active View Tab: 'flowchart' | 'random_tables'
  const [activeSubTab, setActiveSubTab] = useState<'flowchart' | 'random_tables'>('flowchart');

  // Mobile mode toggle (or auto detection)
  const [isMobileMode, setIsMobileMode] = useState(false);

  // Selected Scene in Flowchart
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);

  // Link Condition Modal
  const [editingLink, setEditingLink] = useState<SceneLink | null>(null);
  const [linkConditionInput, setLinkConditionInput] = useState('');

  // Version History Modal
  const [showVersionsModal, setShowVersionsModal] = useState(false);
  const [versionsList, setVersionsList] = useState<Array<{ id: string; version: number; saved_at: number }>>([]);

  // Image Picker Modal
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [imagePickerTarget, setImagePickerTarget] = useState<{
    type: 'scene_bg' | 'clue' | 'handout';
    id?: string;
  } | null>(null);
  const [imagesList, setImagesList] = useState<Array<{ id: string; title: string | null; path: string; visibility: string; source_book: string | null }>>([]);
  const [imageSearchQuery, setImageSearchQuery] = useState('');
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // Random Tables State
  const [randomTables, setRandomTables] = useState<RandomTable[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [manualRollInput, setManualRollInput] = useState<string>('7');
  const [rollResult, setRollResult] = useState<{ roll: number; text: string } | null>(null);

  // Auto-detect window width for mobile mode
  useEffect(() => {
    const checkWidth = () => {
      setIsMobileMode(window.innerWidth <= 640);
    };
    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  // Fetch scenarios list on mount
  const fetchScenarios = async () => {
    try {
      setLoading(true);
      const res = await api.listScenarios();
      setScenariosList(res.scenarios);
      if (res.scenarios.length > 0 && !activeScenarioId) {
        setActiveScenarioId(res.scenarios[0].id);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'シナリオ一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScenarios();
  }, []);

  // Load active scenario full details
  const loadScenarioDetails = async (id: string) => {
    try {
      setLoading(true);
      const full = await api.getScenario(id);
      setScenarioData(full);
      if (full.scenes.length > 0 && (!selectedSceneId || !full.scenes.some((s) => s.id === selectedSceneId))) {
        setSelectedSceneId(full.scenes[0].id);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'シナリオ情報の読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeScenarioId) {
      loadScenarioDetails(activeScenarioId);
    } else {
      setScenarioData(null);
    }
  }, [activeScenarioId]);

  // Load random tables for active scenario
  const fetchRandomTables = async () => {
    try {
      const res = await api.listRandomTables(activeScenarioId || undefined);
      setRandomTables(res.tables);
      if (res.tables.length > 0 && !selectedTableId) {
        setSelectedTableId(res.tables[0].id);
      }
    } catch (err: any) {
      console.error('Failed to load random tables:', err);
    }
  };

  useEffect(() => {
    if (activeSubTab === 'random_tables') {
      fetchRandomTables();
    }
  }, [activeSubTab, activeScenarioId]);

  // Selected Scene Object
  const selectedScene = useMemo(() => {
    if (!scenarioData || !selectedSceneId) return null;
    return scenarioData.scenes.find((s) => s.id === selectedSceneId) || null;
  }, [scenarioData, selectedSceneId]);

  // Selected Scene Choices
  const selectedSceneChoices = useMemo(() => {
    if (!scenarioData || !selectedSceneId) return [];
    return scenarioData.choices.filter((c) => c.scene_id === selectedSceneId);
  }, [scenarioData, selectedSceneId]);

  // Selected Scene Clues & Handouts & Encounters
  const selectedSceneClues = useMemo(() => {
    if (!scenarioData || !selectedSceneId) return [];
    return scenarioData.clues.filter((c) => c.scene_id === selectedSceneId);
  }, [scenarioData, selectedSceneId]);

  const selectedSceneHandouts = useMemo(() => {
    if (!scenarioData || !selectedSceneId) return [];
    return scenarioData.handouts.filter((h) => h.scene_id === selectedSceneId);
  }, [scenarioData, selectedSceneId]);

  const selectedSceneEncounters = useMemo(() => {
    if (!scenarioData || !selectedSceneId) return [];
    return scenarioData.encounters.filter((e) => e.scene_id === selectedSceneId);
  }, [scenarioData, selectedSceneId]);

  // Selected Random Table
  const selectedTable = useMemo(() => {
    return randomTables.find((t) => t.id === selectedTableId) || null;
  }, [randomTables, selectedTableId]);

  // Random Table Range Validation
  const tableRangeValidation = useMemo(() => {
    if (!selectedTable) return { valid: true, warnings: [] };
    return validateRandomTableRanges(selectedTable.dice, selectedTable.rows);
  }, [selectedTable]);

  // --- Handlers for Scenario Actions ---

  const handleCreateNewScenario = async (useTemplate = false) => {
    const title = useTemplate ? '新規テンプレートシナリオ' : '新規シナリオ';
    try {
      const created = await api.createScenario({
        title,
        summary: '',
        use_template: useTemplate,
      });
      setSuccessMsg(`シナリオ「${created.scenario.title}」を作成しました`);
      await fetchScenarios();
      setActiveScenarioId(created.scenario.id);
    } catch (err: any) {
      setErrorMsg(err.message || '作成に失敗しました');
    }
  };

  const handleDuplicateScenario = async () => {
    if (!activeScenarioId) return;
    try {
      const dup = await api.duplicateScenario(activeScenarioId);
      setSuccessMsg(`シナリオを複製しました`);
      await fetchScenarios();
      setActiveScenarioId(dup.scenario.id);
    } catch (err: any) {
      setErrorMsg(err.message || '複製に失敗しました');
    }
  };

  const handleDeleteScenario = async () => {
    if (!activeScenarioId) return;
    if (!confirm('このシナリオを削除してもよろしいですか？')) return;
    try {
      await api.deleteScenario(activeScenarioId);
      setSuccessMsg('シナリオを削除しました');
      setActiveScenarioId(null);
      await fetchScenarios();
    } catch (err: any) {
      setErrorMsg(err.message || '削除に失敗しました');
    }
  };

  const handleSaveScenario = async (saveVersion = true) => {
    if (!scenarioData) return;
    try {
      const updated = await api.updateScenario(scenarioData.scenario.id, {
        title: scenarioData.scenario.title,
        summary: scenarioData.scenario.summary,
        meta: scenarioData.scenario.meta,
        save_version: saveVersion,
      });
      setScenarioData(updated);
      setSuccessMsg(saveVersion ? `版 ${updated.scenario.version} を保存しました` : '保存しました');
      await fetchScenarios();
    } catch (err: any) {
      setErrorMsg(err.message || '保存に失敗しました');
    }
  };

  const handleExportJson = async () => {
    if (!activeScenarioId) return;
    try {
      const full = await api.exportScenario(activeScenarioId);
      const blob = new Blob([JSON.stringify(full, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${full.scenario.title || 'scenario'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setErrorMsg(err.message || 'エクスポートに失敗しました');
    }
  };

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const imported = await api.importScenario(json);
      setSuccessMsg(`シナリオ「${imported.scenario.title}」を取り込みました`);
      await fetchScenarios();
      setActiveScenarioId(imported.scenario.id);
    } catch (err: any) {
      setErrorMsg(err.message || 'インポートに失敗しました');
    } finally {
      e.target.value = '';
    }
  };

  const handleOpenVersions = async () => {
    if (!activeScenarioId) return;
    try {
      const res = await api.listScenarioVersions(activeScenarioId);
      setVersionsList(res.versions);
      setShowVersionsModal(true);
    } catch (err: any) {
      setErrorMsg(err.message || '履歴の取得に失敗しました');
    }
  };

  const handleRestoreVersion = async (vid: string) => {
    if (!activeScenarioId) return;
    if (!confirm('この版に戻しますか？（現在の状態も新しい版として保存されます）')) return;
    try {
      const restored = await api.restoreScenarioVersion(activeScenarioId, vid);
      setScenarioData(restored);
      setShowVersionsModal(false);
      setSuccessMsg(`版 ${restored.scenario.version} に復元しました`);
      await fetchScenarios();
    } catch (err: any) {
      setErrorMsg(err.message || '復元に失敗しました');
    }
  };

  // --- Handlers for Scenes & Links ---

  const handleAddScene = async () => {
    if (!activeScenarioId) return;
    try {
      // Find a non-overlapping default position
      const count = scenarioData?.scenes.length || 0;
      const x = 80 + (count % 3) * 220;
      const y = 80 + Math.floor(count / 3) * 160;

      const newScene = await api.createScene(activeScenarioId, {
        title: `シーン ${count + 1}`,
        position: { x, y },
      });

      if (scenarioData) {
        setScenarioData({
          ...scenarioData,
          scenes: [...scenarioData.scenes, newScene],
        });
      }
      setSelectedSceneId(newScene.id);
    } catch (err: any) {
      setErrorMsg(err.message || 'シーンの追加に失敗しました');
    }
  };

  const handleUpdateActiveSceneField = async (field: string, value: any) => {
    if (!selectedScene) return;
    try {
      const updated = await api.updateScene(selectedScene.id, { [field]: value });
      if (scenarioData) {
        setScenarioData({
          ...scenarioData,
          scenes: scenarioData.scenes.map((s) => (s.id === selectedScene.id ? updated : s)),
        });
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'シーンの更新に失敗しました');
    }
  };

  const handleDeleteActiveScene = async () => {
    if (!selectedScene) return;
    if (!confirm(`シーン「${selectedScene.title}」を削除しますか？`)) return;
    try {
      await api.deleteScene(selectedScene.id);
      if (scenarioData) {
        setScenarioData({
          ...scenarioData,
          scenes: scenarioData.scenes.filter((s) => s.id !== selectedScene.id),
          links: scenarioData.links.filter(
            (l) => l.from_scene_id !== selectedScene.id && l.to_scene_id !== selectedScene.id
          ),
          choices: scenarioData.choices.filter((c) => c.scene_id !== selectedScene.id),
        });
      }
      setSelectedSceneId(null);
    } catch (err: any) {
      setErrorMsg(err.message || 'シーンの削除に失敗しました');
    }
  };

  // Dragging node on SVG canvas
  const [draggedNode, setDraggedNode] = useState<{ id: string; startX: number; startY: number; nodeX: number; nodeY: number } | null>(null);
  // Connecting link from handle
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
  const [connectingMousePos, setConnectingMousePos] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Zoom & Pan state
  const [zoom, setZoom] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const fitToView = useCallback(() => {
    if (!scenarioData || scenarioData.scenes.length === 0) {
      setZoom(1.0);
      setPan({ x: 0, y: 0 });
      return;
    }
    const svg = svgRef.current;
    const viewWidth = svg?.clientWidth || 700;
    const viewHeight = svg?.clientHeight || 500;

    const nodeWidth = 160;
    const nodeHeight = 80;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const s of scenarioData.scenes) {
      if (s.position.x < minX) minX = s.position.x;
      if (s.position.x + nodeWidth > maxX) maxX = s.position.x + nodeWidth;
      if (s.position.y < minY) minY = s.position.y;
      if (s.position.y + nodeHeight > maxY) maxY = s.position.y + nodeHeight;
    }

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const padding = 40;

    const scaleX = (viewWidth - padding * 2) / Math.max(contentWidth, 100);
    const scaleY = (viewHeight - padding * 2) / Math.max(contentHeight, 100);
    const newZoom = Math.min(1.0, Math.max(0.3, Math.min(scaleX, scaleY)));

    const contentCenterX = (minX + maxX) / 2;
    const contentCenterY = (minY + maxY) / 2;

    const newPanX = viewWidth / 2 - contentCenterX * newZoom;
    const newPanY = viewHeight / 2 - contentCenterY * newZoom;

    setZoom(Number(newZoom.toFixed(2)));
    setPan({ x: Math.round(newPanX), y: Math.round(newPanY) });
  }, [scenarioData]);

  useEffect(() => {
    if (scenarioData && scenarioData.scenes.length > 0) {
      const timer = setTimeout(() => {
        fitToView();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [activeScenarioId]);

  const getSvgCanvasPoint = (e: React.MouseEvent) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - pan.x) / zoom,
      y: (e.clientY - rect.top - pan.y) / zoom,
    };
  };

  const handleMouseDownNode = (scene: Scene, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelectedSceneId(scene.id);
    const pt = getSvgCanvasPoint(e);
    setDraggedNode({
      id: scene.id,
      startX: pt.x,
      startY: pt.y,
      nodeX: scene.position.x,
      nodeY: scene.position.y,
    });
  };

  const handleMouseDownHandle = (scene: Scene, e: React.MouseEvent) => {
    e.stopPropagation();
    setConnectingFromId(scene.id);
    const pt = getSvgCanvasPoint(e);
    setConnectingMousePos(pt);
  };

  const handleSvgMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && e.target === svgRef.current) {
      setIsPanning(true);
      setPanStart({
        x: e.clientX - pan.x,
        y: e.clientY - pan.y,
      });
    }
  };

  const handleSvgMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
      return;
    }

    const pt = getSvgCanvasPoint(e);
    if (draggedNode && scenarioData) {
      const dx = pt.x - draggedNode.startX;
      const dy = pt.y - draggedNode.startY;
      const newX = Math.max(20, Math.round(draggedNode.nodeX + dx));
      const newY = Math.max(20, Math.round(draggedNode.nodeY + dy));

      setScenarioData({
        ...scenarioData,
        scenes: scenarioData.scenes.map((s) =>
          s.id === draggedNode.id ? { ...s, position: { x: newX, y: newY } } : s
        ),
      });
    } else if (connectingFromId) {
      setConnectingMousePos(pt);
    }
  };

  const handleSvgMouseUp = async (_e: React.MouseEvent) => {
    if (isPanning) {
      setIsPanning(false);
    }
    if (draggedNode && scenarioData) {
      const s = scenarioData.scenes.find((sc) => sc.id === draggedNode.id);
      if (s) {
        api.updateScene(s.id, { position: s.position }).catch(console.error);
      }
      setDraggedNode(null);
    }
    if (connectingFromId) {
      setConnectingFromId(null);
      setConnectingMousePos(null);
    }
  };

  const handleNodeMouseUp = async (targetScene: Scene, e: React.MouseEvent) => {
    if (connectingFromId && connectingFromId !== targetScene.id && activeScenarioId && scenarioData) {
      e.stopPropagation();
      try {
        const link = await api.createSceneLink(activeScenarioId, {
          from_scene_id: connectingFromId,
          to_scene_id: targetScene.id,
          condition: '',
        });
        setScenarioData({
          ...scenarioData,
          links: [...scenarioData.links, link],
        });
      } catch (err: any) {
        setErrorMsg(err.message || '分岐の接続に失敗しました');
      }
    }
    setConnectingFromId(null);
    setConnectingMousePos(null);
  };

  const handleSaveLinkCondition = async () => {
    if (!editingLink || !scenarioData) return;
    try {
      const updated = await api.updateSceneLink(editingLink.id, {
        condition: linkConditionInput,
      });
      setScenarioData({
        ...scenarioData,
        links: scenarioData.links.map((l) => (l.id === editingLink.id ? updated : l)),
      });
      setEditingLink(null);
    } catch (err: any) {
      setErrorMsg(err.message || '条件の保存に失敗しました');
    }
  };

  const handleDeleteLink = async (linkId: string) => {
    if (!scenarioData) return;
    try {
      await api.deleteSceneLink(linkId);
      setScenarioData({
        ...scenarioData,
        links: scenarioData.links.filter((l) => l.id !== linkId),
      });
      setEditingLink(null);
    } catch (err: any) {
      setErrorMsg(err.message || '分岐の削除に失敗しました');
    }
  };

  // --- Handlers for Choices ---

  const handleAddChoice = async () => {
    if (!selectedScene || !scenarioData) return;
    try {
      const choice = await api.createSceneChoice(selectedScene.id, {
        label: '新しい選択肢',
        skill_key: 'perception',
        dv: 13,
        who: '全員',
        on_success: [{ kind: 'memo', text: '情報が得られる' }],
        on_failure: [],
      });
      setScenarioData({
        ...scenarioData,
        choices: [...scenarioData.choices, choice],
      });
    } catch (err: any) {
      setErrorMsg(err.message || '選択肢の追加に失敗しました');
    }
  };

  const handleUpdateChoice = async (choiceId: string, updates: Partial<SceneChoice>) => {
    if (!scenarioData) return;
    try {
      const updated = await api.updateSceneChoice(choiceId, updates);
      setScenarioData({
        ...scenarioData,
        choices: scenarioData.choices.map((c) => (c.id === choiceId ? updated : c)),
      });
    } catch (err: any) {
      setErrorMsg(err.message || '選択肢の更新に失敗しました');
    }
  };

  const handleDeleteChoice = async (choiceId: string) => {
    if (!scenarioData) return;
    try {
      await api.deleteSceneChoice(choiceId);
      setScenarioData({
        ...scenarioData,
        choices: scenarioData.choices.filter((c) => c.id !== choiceId),
      });
    } catch (err: any) {
      setErrorMsg(err.message || '選択肢の削除に失敗しました');
    }
  };

  // --- Handlers for Clues, Handouts, Encounters ---

  const handleAddClue = async () => {
    if (!activeScenarioId || !selectedScene || !scenarioData) return;
    try {
      const clue = await api.createClue(activeScenarioId, {
        scene_id: selectedScene.id,
        title: '手がかり名',
        body: '',
      });
      setScenarioData({
        ...scenarioData,
        clues: [...scenarioData.clues, clue],
      });
    } catch (err: any) {
      setErrorMsg(err.message || '手がかりの追加に失敗しました');
    }
  };

  const handleAddHandout = async () => {
    if (!activeScenarioId || !selectedScene || !scenarioData) return;
    try {
      const handout = await api.createHandout(activeScenarioId, {
        scene_id: selectedScene.id,
        title: 'ハンドアウト名',
        body: '',
      });
      setScenarioData({
        ...scenarioData,
        handouts: [...scenarioData.handouts, handout],
      });
    } catch (err: any) {
      setErrorMsg(err.message || 'ハンドアウトの追加に失敗しました');
    }
  };

  const handleAddEncounter = async () => {
    if (!activeScenarioId || !selectedScene || !scenarioData) return;
    try {
      const encounter = await api.createEncounter(activeScenarioId, {
        scene_id: selectedScene.id,
        title: '戦闘遭遇',
        notes: '',
        participants: [],
      });
      setScenarioData({
        ...scenarioData,
        encounters: [...scenarioData.encounters, encounter],
      });
    } catch (err: any) {
      setErrorMsg(err.message || 'エンカウンターの追加に失敗しました');
    }
  };

  // --- Handlers for Random Tables ---

  const handleCreateRandomTable = async () => {
    try {
      const created = await api.createRandomTable({
        scenario_id: activeScenarioId || null,
        title: '新規ランダム表',
        dice: '2d6',
        rows: [
          { from: 2, to: 6, text: '通常イベント' },
          { from: 7, to: 7, text: '注目イベント' },
          { from: 8, to: 12, text: '波乱イベント' },
        ],
      });
      setRandomTables([...randomTables, created]);
      setSelectedTableId(created.id);
      setSuccessMsg('ランダム表を作成しました');
    } catch (err: any) {
      setErrorMsg(err.message || 'ランダム表の作成に失敗しました');
    }
  };

  const handleUpdateTableField = async (field: string, value: any) => {
    if (!selectedTable) return;
    try {
      const updated = await api.updateRandomTable(selectedTable.id, { [field]: value });
      setRandomTables(randomTables.map((t) => (t.id === selectedTable.id ? updated : t)));
    } catch (err: any) {
      setErrorMsg(err.message || 'ランダム表の更新に失敗しました');
    }
  };

  const handleDeleteRandomTable = async () => {
    if (!selectedTable) return;
    if (!confirm(`ランダム表「${selectedTable.title}」を削除しますか？`)) return;
    try {
      await api.deleteRandomTable(selectedTable.id);
      setRandomTables(randomTables.filter((t) => t.id !== selectedTable.id));
      setSelectedTableId(null);
      setSuccessMsg('ランダム表を削除しました');
    } catch (err: any) {
      setErrorMsg(err.message || '削除に失敗しました');
    }
  };

  const handleRollRandomTable = async (manual = false) => {
    if (!selectedTable) return;
    try {
      const rollNum = manual ? parseInt(manualRollInput, 10) : undefined;
      const res = await api.rollRandomTable(selectedTable.id, rollNum);
      setRollResult({
        roll: res.roll,
        text: res.matched_row ? res.matched_row.text : '該当する結果がありませんでした',
      });
    } catch (err: any) {
      setErrorMsg(err.message || 'ロール評価に失敗しました');
    }
  };

  // Open Image Picker
  const handleOpenImagePicker = async (target: { type: 'scene_bg' | 'clue' | 'handout'; id?: string }) => {
    setImagePickerTarget(target);
    try {
      const res = await api.listImages();
      setImagesList(res.images);
      setShowImagePicker(true);
    } catch (err: any) {
      setErrorMsg(err.message || '画像一覧の取得に失敗しました');
    }
  };

  const handleSelectImage = async (imageId: string) => {
    if (!imagePickerTarget) return;
    if (imagePickerTarget.type === 'scene_bg' && selectedScene) {
      handleUpdateActiveSceneField('background_image_id', imageId);
    } else if (imagePickerTarget.type === 'clue' && imagePickerTarget.id && scenarioData) {
      await api.updateClue(imagePickerTarget.id, { image_id: imageId });
      setScenarioData({
        ...scenarioData,
        clues: scenarioData.clues.map((c) => (c.id === imagePickerTarget.id ? { ...c, image_id: imageId } : c)),
      });
    } else if (imagePickerTarget.type === 'handout' && imagePickerTarget.id && scenarioData) {
      await api.updateHandout(imagePickerTarget.id, { image_id: imageId });
      setScenarioData({
        ...scenarioData,
        handouts: scenarioData.handouts.map((h) => (h.id === imagePickerTarget.id ? { ...h, image_id: imageId } : h)),
      });
    }
    setShowImagePicker(false);
  };

  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsUploadingImage(true);
      const formData = new FormData();
      formData.append('image', file);
      formData.append('title', file.name);

      const token = localStorage.getItem('cpgm_gm_token');
      const res = await fetch('/api/images', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || '画像のアップロードに失敗しました');
      }

      const created = await res.json();
      setSuccessMsg('画像をアップロードしました');
      const refreshed = await api.listImages();
      setImagesList(refreshed.images);
      if (created.image?.id) {
        handleSelectImage(created.image.id);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'アップロードに失敗しました');
    } finally {
      setIsUploadingImage(false);
      e.target.value = '';
    }
  };

  return (
    <div
      data-testid="scenario-maker-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 120px)',
        minHeight: '650px',
        backgroundColor: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'sans-serif',
      }}
    >
      {/* Top Notification Bars */}
      {errorMsg && (
        <div
          style={{
            padding: '8px 16px',
            backgroundColor: 'rgba(239, 68, 68, 0.2)',
            borderBottom: '1px solid #ef4444',
            color: '#ef4444',
            fontSize: '0.875rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{errorMsg}</span>
          <button
            onClick={() => setErrorMsg(null)}
            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 'bold' }}
          >
            ✕
          </button>
        </div>
      )}
      {successMsg && (
        <div
          style={{
            padding: '8px 16px',
            backgroundColor: 'rgba(16, 185, 129, 0.2)',
            borderBottom: '1px solid #10b981',
            color: '#10b981',
            fontSize: '0.875rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{successMsg}</span>
          <button
            onClick={() => setSuccessMsg(null)}
            style={{ background: 'none', border: 'none', color: '#10b981', cursor: 'pointer', fontWeight: 'bold' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Top Header: Tabs & Mode Controls */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 16px',
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface)',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {loading && (
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>読込中...</span>
          )}
          <button
            data-testid="tab-flowchart"
            onClick={() => setActiveSubTab('flowchart')}
            style={{
              padding: '6px 14px',
              fontSize: '0.875rem',
              fontWeight: activeSubTab === 'flowchart' ? 'bold' : 'normal',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: activeSubTab === 'flowchart' ? 'var(--color-accent)' : 'transparent',
              color: activeSubTab === 'flowchart' ? '#fff' : 'var(--color-text-muted)',
              cursor: 'pointer',
            }}
          >
            フローチャート & シーン編集
          </button>
          <button
            data-testid="tab-random-tables"
            onClick={() => setActiveSubTab('random_tables')}
            style={{
              padding: '6px 14px',
              fontSize: '0.875rem',
              fontWeight: activeSubTab === 'random_tables' ? 'bold' : 'normal',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: activeSubTab === 'random_tables' ? 'var(--color-accent)' : 'transparent',
              color: activeSubTab === 'random_tables' ? '#fff' : 'var(--color-text-muted)',
              cursor: 'pointer',
            }}
          >
            ランダム表
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {activeSubTab === 'flowchart' && (
            <button
              onClick={() => setIsMobileMode(!isMobileMode)}
              style={{
                padding: '4px 10px',
                fontSize: '0.75rem',
                borderRadius: '4px',
                border: '1px solid var(--color-border)',
                backgroundColor: isMobileMode ? 'var(--color-accent)' : 'var(--color-surface)',
                color: isMobileMode ? '#fff' : 'var(--color-text-muted)',
                cursor: 'pointer',
              }}
            >
              {isMobileMode ? 'フローチャート表示に切替' : 'スマホ一覧表示に切替'}
            </button>
          )}

          {scenarioData && (
            <>
              <button
                data-testid="btn-save-scenario"
                onClick={() => handleSaveScenario(true)}
                style={{
                  padding: '6px 14px',
                  fontSize: '0.875rem',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: 'var(--color-accent)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                }}
              >
                保存 (v{scenarioData.scenario.version})
              </button>
              <button
                onClick={handleOpenVersions}
                style={{
                  padding: '6px 12px',
                  fontSize: '0.875rem',
                  borderRadius: '4px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                }}
              >
                バージョン履歴
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Workspace Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Sidebar: Scenarios Management & Metadata */}
        <div
          style={{
            width: isMobileMode ? '100%' : '280px',
            borderRight: isMobileMode ? 'none' : '1px solid var(--color-border)',
            borderBottom: isMobileMode ? '1px solid var(--color-border)' : 'none',
            backgroundColor: 'var(--color-surface)',
            display: isMobileMode ? 'none' : 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            overflowY: 'auto',
          }}
        >
          {/* Action Toolbar */}
          <div style={{ padding: '12px', borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--color-text-muted)', marginBottom: '8px' }}>
              シナリオ管理
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
              <button
                data-testid="btn-new-scenario"
                onClick={() => handleCreateNewScenario(false)}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  fontSize: '0.75rem',
                  borderRadius: '4px',
                  border: '1px solid var(--color-accent)',
                  backgroundColor: 'transparent',
                  color: 'var(--color-accent)',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                }}
              >
                + 新規
              </button>
              <button
                data-testid="btn-template-scenario"
                onClick={() => handleCreateNewScenario(true)}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  fontSize: '0.75rem',
                  borderRadius: '4px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'transparent',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                }}
              >
                雛形から
              </button>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button
                data-testid="btn-export-scenario"
                disabled={!activeScenarioId}
                onClick={handleExportJson}
                style={{
                  flex: 1,
                  padding: '4px 6px',
                  fontSize: '0.75rem',
                  borderRadius: '4px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'transparent',
                  color: activeScenarioId ? 'var(--color-text-muted)' : '#666',
                  cursor: activeScenarioId ? 'pointer' : 'not-allowed',
                }}
              >
                書き出し
              </button>
              <label
                data-testid="btn-import-scenario"
                style={{
                  flex: 1,
                  padding: '4px 6px',
                  fontSize: '0.75rem',
                  borderRadius: '4px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'transparent',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                取り込み
                <input type="file" accept=".json" onChange={handleImportJson} style={{ display: 'none' }} />
              </label>
            </div>
          </div>

          {/* Scenario List */}
          <div style={{ padding: '8px', borderBottom: '1px solid var(--color-border)', maxHeight: '200px', overflowY: 'auto' }}>
            {scenariosList.length === 0 ? (
              <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', padding: '8px' }}>
                シナリオがありません
              </div>
            ) : (
              scenariosList.map((sc) => (
                <div
                  key={sc.id}
                  data-testid={`scenario-item-${sc.id}`}
                  onClick={() => setActiveScenarioId(sc.id)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '4px',
                    marginBottom: '4px',
                    cursor: 'pointer',
                    backgroundColor: activeScenarioId === sc.id ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                    borderLeft: activeScenarioId === sc.id ? '3px solid var(--color-accent)' : '3px solid transparent',
                  }}
                >
                  <div style={{ fontSize: '0.875rem', fontWeight: 'bold' }}>{sc.title}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    版 {sc.version} · {sc.summary ? sc.summary.slice(0, 15) + '...' : '概要なし'}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Scenario Basic Info Editor */}
          {scenarioData && (
            <div style={{ padding: '12px', flex: 1 }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--color-text-muted)', marginBottom: '8px' }}>
                基本情報
              </div>
              <div style={{ marginBottom: '8px' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>タイトル</label>
                <input
                  type="text"
                  value={scenarioData.scenario.title}
                  onChange={(e) =>
                    setScenarioData({
                      ...scenarioData,
                      scenario: { ...scenarioData.scenario, title: e.target.value },
                    })
                  }
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    fontSize: '0.8125rem',
                    borderRadius: '4px',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ marginBottom: '8px' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>概要</label>
                <textarea
                  rows={2}
                  value={scenarioData.scenario.summary}
                  onChange={(e) =>
                    setScenarioData({
                      ...scenarioData,
                      scenario: { ...scenarioData.scenario, summary: e.target.value },
                    })
                  }
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    fontSize: '0.8125rem',
                    borderRadius: '4px',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    boxSizing: 'border-box',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>推奨人数（人）</label>
                  <input
                    type="number"
                    value={scenarioData.scenario.meta?.players_min || ''}
                    onChange={(e) =>
                      setScenarioData({
                        ...scenarioData,
                        scenario: {
                          ...scenarioData.scenario,
                          meta: { ...scenarioData.scenario.meta, players_min: parseInt(e.target.value, 10) || undefined },
                        },
                      })
                    }
                    style={{
                      width: '100%',
                      padding: '4px 6px',
                      fontSize: '0.75rem',
                      borderRadius: '4px',
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'var(--color-bg)',
                      color: 'var(--color-text)',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>想定時間（時間）</label>
                  <input
                    type="number"
                    value={scenarioData.scenario.meta?.hours || ''}
                    onChange={(e) =>
                      setScenarioData({
                        ...scenarioData,
                        scenario: {
                          ...scenarioData.scenario,
                          meta: { ...scenarioData.scenario.meta, hours: parseFloat(e.target.value) || undefined },
                        },
                      })
                    }
                    style={{
                      width: '100%',
                      padding: '4px 6px',
                      fontSize: '0.75rem',
                      borderRadius: '4px',
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'var(--color-bg)',
                      color: 'var(--color-text)',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '8px' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>報酬目安</label>
                <input
                  type="text"
                  value={scenarioData.scenario.meta?.reward_note || ''}
                  onChange={(e) =>
                    setScenarioData({
                      ...scenarioData,
                      scenario: {
                        ...scenarioData.scenario,
                        meta: { ...scenarioData.scenario.meta, reward_note: e.target.value },
                      },
                    })
                  }
                  style={{
                    width: '100%',
                    padding: '4px 6px',
                    fontSize: '0.75rem',
                    borderRadius: '4px',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '6px', marginTop: '16px' }}>
                <button
                  data-testid="btn-duplicate-scenario"
                  onClick={handleDuplicateScenario}
                  style={{
                    flex: 1,
                    padding: '6px',
                    fontSize: '0.75rem',
                    borderRadius: '4px',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'transparent',
                    color: 'var(--color-text)',
                    cursor: 'pointer',
                  }}
                >
                  複製
                </button>
                <button
                  onClick={handleDeleteScenario}
                  style={{
                    flex: 1,
                    padding: '6px',
                    fontSize: '0.75rem',
                    borderRadius: '4px',
                    border: '1px solid rgba(239, 68, 68, 0.5)',
                    backgroundColor: 'transparent',
                    color: '#ef4444',
                    cursor: 'pointer',
                  }}
                >
                  削除
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Center & Right Area */}
        {activeSubTab === 'flowchart' ? (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Center Canvas or Mobile List */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                backgroundColor: 'var(--color-bg)',
                overflow: isMobileMode ? 'auto' : 'hidden',
              }}
            >
              {/* Canvas Header / Controls */}
              <div
                style={{
                  padding: '8px 12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: '1px solid var(--color-border)',
                  backgroundColor: 'rgba(0,0,0,0.1)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                    {scenarioData ? `${scenarioData.scenes.length} シーン · ${scenarioData.links.length} 分岐` : ''}
                  </span>
                  {!isMobileMode && scenarioData && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '12px' }}>
                      <button
                        type="button"
                        data-testid="btn-fit-flowchart"
                        onClick={fitToView}
                        style={{
                          padding: '3px 8px',
                          fontSize: '0.75rem',
                          borderRadius: '4px',
                          border: '1px solid var(--color-border)',
                          backgroundColor: 'var(--color-surface)',
                          color: 'var(--color-text)',
                          cursor: 'pointer',
                        }}
                      >
                        全体を表示
                      </button>
                      <button
                        type="button"
                        data-testid="btn-zoom-out"
                        onClick={() => setZoom((z) => Math.max(0.3, Number((z - 0.1).toFixed(2))))}
                        style={{
                          padding: '3px 8px',
                          fontSize: '0.75rem',
                          borderRadius: '4px',
                          border: '1px solid var(--color-border)',
                          backgroundColor: 'var(--color-surface)',
                          color: 'var(--color-text)',
                          cursor: 'pointer',
                        }}
                      >
                        -
                      </button>
                      <span data-testid="zoom-level" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', minWidth: '36px', textAlign: 'center' }}>
                        {Math.round(zoom * 100)}%
                      </span>
                      <button
                        type="button"
                        data-testid="btn-zoom-in"
                        onClick={() => setZoom((z) => Math.min(2.0, Number((z + 0.1).toFixed(2))))}
                        style={{
                          padding: '3px 8px',
                          fontSize: '0.75rem',
                          borderRadius: '4px',
                          border: '1px solid var(--color-border)',
                          backgroundColor: 'var(--color-surface)',
                          color: 'var(--color-text)',
                          cursor: 'pointer',
                        }}
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={handleAddScene}
                  disabled={!scenarioData}
                  style={{
                    padding: '4px 10px',
                    fontSize: '0.8125rem',
                    borderRadius: '4px',
                    border: '1px solid var(--color-accent)',
                    backgroundColor: 'var(--color-accent)',
                    color: '#fff',
                    cursor: scenarioData ? 'pointer' : 'not-allowed',
                    fontWeight: 'bold',
                  }}
                >
                  + シーン追加
                </button>
              </div>

              {isMobileMode ? (
                /* Mobile List View */
                <div data-testid="mobile-list-view" style={{ padding: '16px' }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 'bold', marginBottom: '12px' }}>
                    シーン一覧 (スマホ表示)
                  </div>
                  {scenarioData?.scenes.map((scene, idx) => {
                    const outgoing = scenarioData.links.filter((l) => l.from_scene_id === scene.id);
                    return (
                      <div
                        key={scene.id}
                        onClick={() => setSelectedSceneId(scene.id)}
                        style={{
                          padding: '12px',
                          borderRadius: '8px',
                          border: selectedSceneId === scene.id ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                          backgroundColor: 'var(--color-surface)',
                          marginBottom: '12px',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 'bold' }}>
                            {idx + 1}. {scene.title}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                            {scene.location || '場所未指定'}
                          </span>
                        </div>

                        {/* Outgoing branches */}
                        <div style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                          <div>次のシーン:</div>
                          {outgoing.length === 0 ? (
                            <div style={{ fontStyle: 'italic', color: '#888' }}>分岐なし</div>
                          ) : (
                            outgoing.map((l) => {
                              const target = scenarioData.scenes.find((s) => s.id === l.to_scene_id);
                              return (
                                <div key={l.id} style={{ marginLeft: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  → {target?.title || '未指定'}
                                  {l.condition && <span style={{ color: 'var(--color-accent)' }}>({l.condition})</span>}
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Flowchart SVG Canvas */
                <svg
                  ref={svgRef}
                  data-testid="flowchart-svg"
                  onMouseDown={handleSvgMouseDown}
                  onMouseMove={handleSvgMouseMove}
                  onMouseUp={handleSvgMouseUp}
                  style={{
                    width: '100%',
                    height: '100%',
                    userSelect: 'none',
                    cursor: isPanning ? 'grabbing' : draggedNode ? 'grabbing' : connectingFromId ? 'crosshair' : 'default',
                  }}
                >
                  <defs>
                    <marker
                      id="arrow"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-accent)" />
                    </marker>
                  </defs>

                  <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                    {/* Links / Arrows */}
                    {scenarioData?.links.map((link) => {
                      const fromNode = scenarioData.scenes.find((s) => s.id === link.from_scene_id);
                      const toNode = scenarioData.scenes.find((s) => s.id === link.to_scene_id);
                      if (!fromNode || !toNode) return null;

                      const x1 = fromNode.position.x + 160;
                      const y1 = fromNode.position.y + 40;
                      const x2 = toNode.position.x;
                      const y2 = toNode.position.y + 40;
                      const midX = (x1 + x2) / 2;
                      const midY = (y1 + y2) / 2;

                      // Curved bezier path
                      const pathData = `M ${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`;
                      const hasCondition = Boolean(link.condition && link.condition.trim());

                      return (
                        <g key={link.id} style={{ cursor: 'pointer' }}>
                          <path
                            d={pathData}
                            fill="none"
                            stroke="var(--color-accent)"
                            strokeWidth="2.5"
                            markerEnd="url(#arrow)"
                            onClick={() => {
                              setEditingLink(link);
                              setLinkConditionInput(link.condition);
                            }}
                          />
                          {/* Condition Text Badge: only render if condition is not empty */}
                          {hasCondition && (
                            <text
                              x={midX}
                              y={midY - 6}
                              textAnchor="middle"
                              fill="var(--color-text)"
                              fontSize="11"
                              fontWeight="bold"
                              onClick={() => {
                                setEditingLink(link);
                                setLinkConditionInput(link.condition);
                              }}
                              style={{
                                paintOrder: 'stroke',
                                stroke: 'var(--color-surface)',
                                strokeWidth: '4px',
                                strokeLinejoin: 'round',
                              }}
                            >
                              {link.condition}
                            </text>
                          )}
                        </g>
                      );
                    })}

                    {/* In-progress connecting line */}
                    {connectingFromId && connectingMousePos && (() => {
                      const fromNode = scenarioData?.scenes.find((s) => s.id === connectingFromId);
                      if (!fromNode) return null;
                      const x1 = fromNode.position.x + 160;
                      const y1 = fromNode.position.y + 40;
                      return (
                        <line
                          x1={x1}
                          y1={y1}
                          x2={connectingMousePos.x}
                          y2={connectingMousePos.y}
                          stroke="var(--color-accent)"
                          strokeDasharray="4"
                          strokeWidth="2"
                        />
                      );
                    })()}

                    {/* Scene Nodes */}
                    {scenarioData?.scenes.map((scene) => {
                      const isSelected = selectedSceneId === scene.id;
                      return (
                        <g
                          key={scene.id}
                          data-testid={`scene-node-${scene.id}`}
                          transform={`translate(${scene.position.x}, ${scene.position.y})`}
                          onMouseDown={(e) => handleMouseDownNode(scene, e)}
                          onMouseUp={(e) => handleNodeMouseUp(scene, e)}
                          style={{ cursor: 'grab' }}
                        >
                          {/* Node Box */}
                          <rect
                            width="160"
                            height="80"
                            rx="6"
                            fill="var(--color-surface)"
                            stroke={isSelected ? 'var(--color-accent)' : 'var(--color-border)'}
                            strokeWidth={isSelected ? '2.5' : '1'}
                            style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}
                          />

                          {/* Node Header */}
                          <rect width="160" height="24" rx="6" fill={isSelected ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.05)'} />
                          <text
                            x="8"
                            y="16"
                            fill="var(--color-text)"
                            fontSize="11"
                            fontWeight="bold"
                            style={{ pointerEvents: 'none' }}
                          >
                            {scene.title.length > 12 ? scene.title.slice(0, 12) + '...' : scene.title}
                          </text>

                          {/* Location preview */}
                          <text
                            x="8"
                            y="42"
                            fill="var(--color-text-muted)"
                            fontSize="10"
                            style={{ pointerEvents: 'none' }}
                          >
                            {scene.location || '場所未指定'}
                          </text>

                          {/* Connection Handle (Right Circle) */}
                          <circle
                            cx="160"
                            cy="40"
                            r="6"
                            fill="var(--color-accent)"
                            stroke="#fff"
                            strokeWidth="1.5"
                            onMouseDown={(e) => handleMouseDownHandle(scene, e)}
                            style={{ cursor: 'crosshair' }}
                          />
                        </g>
                      );
                    })}
                  </g>
                </svg>
              )}
            </div>

            {/* Right Panel: Scene Detail Editor */}
            <div
              data-testid="scene-detail-editor"
              style={{
                width: isMobileMode ? '100%' : '420px',
                borderLeft: isMobileMode ? 'none' : '1px solid var(--color-border)',
                borderTop: isMobileMode ? '1px solid var(--color-border)' : 'none',
                backgroundColor: 'var(--color-surface)',
                display: isMobileMode ? 'none' : 'flex',
                flexDirection: 'column',
                flexShrink: 0,
                overflowY: 'auto',
                padding: '16px',
              }}
            >
              {selectedScene ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ fontSize: '1rem', fontWeight: 'bold' }}>シーン編集</div>
                    <button
                      onClick={handleDeleteActiveScene}
                      style={{
                        padding: '4px 8px',
                        fontSize: '0.75rem',
                        borderRadius: '4px',
                        border: '1px solid rgba(239, 68, 68, 0.5)',
                        backgroundColor: 'transparent',
                        color: '#ef4444',
                        cursor: 'pointer',
                      }}
                    >
                      シーン削除
                    </button>
                  </div>

                  {/* Title & Location */}
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>シーンタイトル</label>
                    <input
                      data-testid="input-scene-title"
                      type="text"
                      value={selectedScene.title}
                      onChange={(e) => handleUpdateActiveSceneField('title', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        fontSize: '0.875rem',
                        borderRadius: '4px',
                        border: '1px solid var(--color-border)',
                        backgroundColor: 'var(--color-bg)',
                        color: 'var(--color-text)',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>場所</label>
                    <input
                      type="text"
                      value={selectedScene.location}
                      onChange={(e) => handleUpdateActiveSceneField('location', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        fontSize: '0.8125rem',
                        borderRadius: '4px',
                        border: '1px solid var(--color-border)',
                        backgroundColor: 'var(--color-bg)',
                        color: 'var(--color-text)',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  {/* Read Aloud Prose */}
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>読み上げ文 (情景描写)</label>
                    <textarea
                      data-testid="input-scene-read-aloud"
                      rows={3}
                      placeholder="プレイヤーへ読み上げる文"
                      value={selectedScene.read_aloud}
                      onChange={(e) => handleUpdateActiveSceneField('read_aloud', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        fontSize: '0.8125rem',
                        borderRadius: '4px',
                        border: '1px solid var(--color-border)',
                        backgroundColor: 'var(--color-bg)',
                        color: 'var(--color-text)',
                        boxSizing: 'border-box',
                        resize: 'vertical',
                      }}
                    />
                  </div>

                  {/* GM Notes */}
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>GM メモ (秘密情報・進行)</label>
                    <textarea
                      data-testid="input-scene-gm-notes"
                      rows={3}
                      placeholder="GM用メモ"
                      value={selectedScene.gm_notes}
                      onChange={(e) => handleUpdateActiveSceneField('gm_notes', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        fontSize: '0.8125rem',
                        borderRadius: '4px',
                        border: '1px solid var(--color-border)',
                        backgroundColor: 'var(--color-bg)',
                        color: 'var(--color-text)',
                        boxSizing: 'border-box',
                        resize: 'vertical',
                      }}
                    />
                  </div>

                  {/* Background Image & Board Picker */}
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                    <button
                      onClick={() => handleOpenImagePicker({ type: 'scene_bg' })}
                      style={{
                        flex: 1,
                        padding: '6px',
                        fontSize: '0.75rem',
                        borderRadius: '4px',
                        border: '1px solid var(--color-border)',
                        backgroundColor: selectedScene.background_image_id ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                        color: 'var(--color-text)',
                        cursor: 'pointer',
                      }}
                    >
                      {selectedScene.background_image_id ? '背景画像設定済' : '背景画像選択'}
                    </button>
                  </div>

                  <SceneBgmField value={selectedScene.bgm} onChange={(bgm) => handleUpdateActiveSceneField('bgm', bgm)} />

                  {/* NPCs selection */}
                  <div style={{ marginBottom: '16px' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>登場 NPC</label>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                      {characters.filter((c) => c.kind === 'npc').length === 0 ? (
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                          NPCが登録されていません (PCタブの「NPC/モブ追加」で作成)
                        </span>
                      ) : (
                        characters
                          .filter((c) => c.kind === 'npc')
                          .map((npc) => {
                            const currentIds: string[] = Array.isArray(selectedScene.npc_ids) ? selectedScene.npc_ids : [];
                            const isSelected = currentIds.includes(npc.id);
                            return (
                              <button
                                key={npc.id}
                                type="button"
                                onClick={() => {
                                  const newNpcs = isSelected
                                    ? currentIds.filter((id) => id !== npc.id)
                                    : [...currentIds, npc.id];
                                  handleUpdateActiveSceneField('npc_ids', newNpcs);
                                }}
                                style={{
                                  padding: '2px 8px',
                                  fontSize: '0.75rem',
                                  borderRadius: '12px',
                                  border: isSelected ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                                  backgroundColor: isSelected ? 'var(--color-accent)' : 'var(--color-bg)',
                                  color: isSelected ? '#fff' : 'var(--color-text)',
                                  cursor: 'pointer',
                                }}
                              >
                                {npc.name}
                              </button>
                            );
                          })
                      )}
                    </div>
                  </div>

                  {/* Choices Section */}
                  <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '12px', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <div style={{ fontSize: '0.875rem', fontWeight: 'bold' }}>
                        選択肢 ({selectedSceneChoices.length})
                      </div>
                      <button
                        data-testid="btn-add-choice"
                        onClick={handleAddChoice}
                        style={{
                          padding: '2px 8px',
                          fontSize: '0.75rem',
                          borderRadius: '4px',
                          border: '1px solid var(--color-accent)',
                          backgroundColor: 'transparent',
                          color: 'var(--color-accent)',
                          cursor: 'pointer',
                        }}
                      >
                        + 選択肢追加
                      </button>
                    </div>

                    {selectedSceneChoices.map((choice) => (
                      <div
                        key={choice.id}
                        style={{
                          padding: '10px',
                          borderRadius: '6px',
                          border: '1px solid var(--color-border)',
                          backgroundColor: 'var(--color-bg)',
                          marginBottom: '8px',
                        }}
                      >
                        <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                          <input
                            type="text"
                            value={choice.label}
                            onChange={(e) => handleUpdateChoice(choice.id, { label: e.target.value })}
                            placeholder="ラベル"
                            style={{
                              flex: 1,
                              padding: '4px 6px',
                              fontSize: '0.8125rem',
                              borderRadius: '4px',
                              border: '1px solid var(--color-border)',
                              backgroundColor: 'var(--color-surface)',
                              color: 'var(--color-text)',
                            }}
                          />
                          <button
                            onClick={() => handleDeleteChoice(choice.id)}
                            style={{
                              padding: '2px 6px',
                              background: 'none',
                              border: 'none',
                              color: '#ef4444',
                              cursor: 'pointer',
                            }}
                          >
                            ✕
                          </button>
                        </div>

                        {/* Skill Picker & DV input */}
                        <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                          <select
                            data-testid="choice-skill-select"
                            value={choice.skill_key || ''}
                            onChange={(e) => handleUpdateChoice(choice.id, { skill_key: e.target.value || null })}
                            style={{
                              flex: 1,
                              padding: '4px 6px',
                              fontSize: '0.75rem',
                              borderRadius: '4px',
                              border: '1px solid var(--color-border)',
                              backgroundColor: 'var(--color-surface)',
                              color: 'var(--color-text)',
                            }}
                          >
                            <option value="">技能判定なし</option>
                            {Object.values(SKILL_CATALOG).map((sk) => (
                              <option key={sk.key} value={sk.key}>
                                {formatSkillName(sk.key)} ({sk.key})
                              </option>
                            ))}
                          </select>

                          <input
                            type="number"
                            placeholder="DV"
                            value={choice.dv ?? ''}
                            onChange={(e) =>
                              handleUpdateChoice(choice.id, {
                                dv: e.target.value ? parseInt(e.target.value, 10) : null,
                              })
                            }
                            style={{
                              width: '50px',
                              padding: '4px 6px',
                              fontSize: '0.75rem',
                              borderRadius: '4px',
                              border: '1px solid var(--color-border)',
                              backgroundColor: 'var(--color-surface)',
                              color: 'var(--color-text)',
                            }}
                          />
                        </div>

                        {/* DV Guideline Presets */}
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' }}>
                          <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>目安:</span>
                          {DV_PRESETS.map((p) => (
                            <button
                              key={p.dv}
                              data-testid={`dv-preset-${p.dv}`}
                              onClick={() => handleUpdateChoice(choice.id, { dv: p.dv })}
                              style={{
                                padding: '1px 5px',
                                fontSize: '0.6875rem',
                                borderRadius: '3px',
                                border: '1px solid var(--color-border)',
                                backgroundColor: choice.dv === p.dv ? 'var(--color-accent)' : 'transparent',
                                color: choice.dv === p.dv ? '#fff' : 'var(--color-text-muted)',
                                cursor: 'pointer',
                              }}
                            >
                              {p.label}({p.dv})
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Clues, Handouts, Encounters Section */}
                  <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '12px' }}>
                    {/* Clues */}
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontSize: '0.8125rem', fontWeight: 'bold' }}>手がかり ({selectedSceneClues.length})</span>
                        <button
                          data-testid="btn-add-clue"
                          onClick={handleAddClue}
                          style={{
                            padding: '2px 6px',
                            fontSize: '0.6875rem',
                            borderRadius: '3px',
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'transparent',
                            color: 'var(--color-text-muted)',
                            cursor: 'pointer',
                          }}
                        >
                          + 追加
                        </button>
                      </div>
                      {selectedSceneClues.map((c) => (
                        <div key={c.id} style={{ fontSize: '0.75rem', padding: '4px 6px', backgroundColor: 'var(--color-bg)', borderRadius: '4px', marginBottom: '4px' }}>
                          {c.title}
                        </div>
                      ))}
                    </div>

                    {/* Handouts */}
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontSize: '0.8125rem', fontWeight: 'bold' }}>ハンドアウト ({selectedSceneHandouts.length})</span>
                        <button
                          data-testid="btn-add-handout"
                          onClick={handleAddHandout}
                          style={{
                            padding: '2px 6px',
                            fontSize: '0.6875rem',
                            borderRadius: '3px',
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'transparent',
                            color: 'var(--color-text-muted)',
                            cursor: 'pointer',
                          }}
                        >
                          + 追加
                        </button>
                      </div>
                      {selectedSceneHandouts.map((h) => (
                        <div key={h.id} style={{ fontSize: '0.75rem', padding: '4px 6px', backgroundColor: 'var(--color-bg)', borderRadius: '4px', marginBottom: '4px' }}>
                          {h.title}
                        </div>
                      ))}
                    </div>

                    {/* Encounters */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontSize: '0.8125rem', fontWeight: 'bold' }}>エンカウンター ({selectedSceneEncounters.length})</span>
                        <button
                          data-testid="btn-add-encounter"
                          onClick={handleAddEncounter}
                          style={{
                            padding: '2px 6px',
                            fontSize: '0.6875rem',
                            borderRadius: '3px',
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'transparent',
                            color: 'var(--color-text-muted)',
                            cursor: 'pointer',
                          }}
                        >
                          + 追加
                        </button>
                      </div>
                      {selectedSceneEncounters.map((e) => (
                        <div key={e.id} style={{ fontSize: '0.75rem', padding: '4px 6px', backgroundColor: 'var(--color-bg)', borderRadius: '4px', marginBottom: '4px' }}>
                          {e.title}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', marginTop: '48px', fontSize: '0.875rem' }}>
                  シーンを選択すると詳細を編集できます
                </div>
              )}
            </div>
          </div>
        ) : (
          /* SubTab: Random Tables */
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Table List */}
            <div
              style={{
                width: '240px',
                borderRight: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-surface)',
                display: 'flex',
                flexDirection: 'column',
                padding: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '0.8125rem', fontWeight: 'bold' }}>表一覧</span>
                <button
                  data-testid="btn-new-random-table"
                  onClick={handleCreateRandomTable}
                  style={{
                    padding: '4px 8px',
                    fontSize: '0.75rem',
                    borderRadius: '4px',
                    border: '1px solid var(--color-accent)',
                    backgroundColor: 'var(--color-accent)',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  + 新規表
                </button>
              </div>

              {randomTables.map((t) => (
                <div
                  key={t.id}
                  onClick={() => {
                    setSelectedTableId(t.id);
                    setRollResult(null);
                  }}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '4px',
                    marginBottom: '4px',
                    cursor: 'pointer',
                    backgroundColor: selectedTableId === t.id ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                    borderLeft: selectedTableId === t.id ? '3px solid var(--color-accent)' : '3px solid transparent',
                  }}
                >
                  <div style={{ fontSize: '0.875rem', fontWeight: 'bold' }}>{t.title}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    {t.dice} · {t.rows.length} 行
                  </div>
                </div>
              ))}
            </div>

            {/* Table Detail & Rolling */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
              {selectedTable ? (
                <div style={{ maxWidth: '800px', margin: '0 auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>{selectedTable.title}</div>
                    <button
                      onClick={handleDeleteRandomTable}
                      style={{
                        padding: '4px 8px',
                        fontSize: '0.75rem',
                        borderRadius: '4px',
                        border: '1px solid rgba(239, 68, 68, 0.5)',
                        backgroundColor: 'transparent',
                        color: '#ef4444',
                        cursor: 'pointer',
                      }}
                    >
                      表を削除
                    </button>
                  </div>

                  {/* Range Validation Warning Banner */}
                  {!tableRangeValidation.valid && (
                    <div
                      data-testid="random-table-warnings"
                      style={{
                        padding: '12px 16px',
                        borderRadius: '6px',
                        backgroundColor: 'rgba(239, 68, 68, 0.15)',
                        border: '1px solid #ef4444',
                        color: '#ef4444',
                        marginBottom: '16px',
                        fontSize: '0.875rem',
                      }}
                    >
                      <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>範囲の警告があります:</div>
                      {tableRangeValidation.warnings.map((w, idx) => (
                        <div key={idx} style={{ marginLeft: '12px' }}>
                          • {w}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Settings */}
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                    <div style={{ flex: 2 }}>
                      <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>表のタイトル</label>
                      <input
                        type="text"
                        value={selectedTable.title}
                        onChange={(e) => handleUpdateTableField('title', e.target.value)}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          fontSize: '0.875rem',
                          borderRadius: '4px',
                          border: '1px solid var(--color-border)',
                          backgroundColor: 'var(--color-surface)',
                          color: 'var(--color-text)',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>ダイス式</label>
                      <input
                        type="text"
                        placeholder="2d6, 1d100..."
                        value={selectedTable.dice}
                        onChange={(e) => handleUpdateTableField('dice', e.target.value)}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          fontSize: '0.875rem',
                          borderRadius: '4px',
                          border: '1px solid var(--color-border)',
                          backgroundColor: 'var(--color-surface)',
                          color: 'var(--color-text)',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  </div>

                  {/* Rows List */}
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 'bold' }}>行設定</span>
                      <button
                        onClick={() => {
                          const lastTo = selectedTable.rows.length > 0 ? selectedTable.rows[selectedTable.rows.length - 1].to : 1;
                          const newRows = [...selectedTable.rows, { from: lastTo + 1, to: lastTo + 2, text: '結果テキスト' }];
                          handleUpdateTableField('rows', newRows);
                        }}
                        style={{
                          padding: '4px 8px',
                          fontSize: '0.75rem',
                          borderRadius: '4px',
                          border: '1px solid var(--color-border)',
                          backgroundColor: 'var(--color-surface)',
                          color: 'var(--color-text)',
                          cursor: 'pointer',
                        }}
                      >
                        + 行を追加
                      </button>
                    </div>

                    {selectedTable.rows.map((row, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          gap: '8px',
                          alignItems: 'center',
                          marginBottom: '6px',
                        }}
                      >
                        <input
                          type="number"
                          value={row.from}
                          onChange={(e) => {
                            const newRows = [...selectedTable.rows];
                            newRows[idx] = { ...row, from: parseInt(e.target.value, 10) || 0 };
                            handleUpdateTableField('rows', newRows);
                          }}
                          style={{
                            width: '60px',
                            padding: '4px 6px',
                            fontSize: '0.8125rem',
                            borderRadius: '4px',
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'var(--color-surface)',
                            color: 'var(--color-text)',
                            textAlign: 'center',
                          }}
                        />
                        <span>〜</span>
                        <input
                          type="number"
                          value={row.to}
                          onChange={(e) => {
                            const newRows = [...selectedTable.rows];
                            newRows[idx] = { ...row, to: parseInt(e.target.value, 10) || 0 };
                            handleUpdateTableField('rows', newRows);
                          }}
                          style={{
                            width: '60px',
                            padding: '4px 6px',
                            fontSize: '0.8125rem',
                            borderRadius: '4px',
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'var(--color-surface)',
                            color: 'var(--color-text)',
                            textAlign: 'center',
                          }}
                        />
                        <input
                          type="text"
                          value={row.text}
                          onChange={(e) => {
                            const newRows = [...selectedTable.rows];
                            newRows[idx] = { ...row, text: e.target.value };
                            handleUpdateTableField('rows', newRows);
                          }}
                          style={{
                            flex: 1,
                            padding: '4px 6px',
                            fontSize: '0.8125rem',
                            borderRadius: '4px',
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'var(--color-surface)',
                            color: 'var(--color-text)',
                          }}
                        />
                        <button
                          onClick={() => {
                            const newRows = selectedTable.rows.filter((_, i) => i !== idx);
                            handleUpdateTableField('rows', newRows);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Roll Testing Section */}
                  <div
                    style={{
                      padding: '16px',
                      borderRadius: '8px',
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'var(--color-surface)',
                    }}
                  >
                    <div style={{ fontSize: '0.875rem', fontWeight: 'bold', marginBottom: '12px' }}>
                      出目テスト・リアルダイス評価
                    </div>

                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <label style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>出目指定:</label>
                        <input
                          data-testid="input-manual-roll"
                          type="number"
                          value={manualRollInput}
                          onChange={(e) => setManualRollInput(e.target.value)}
                          style={{
                            width: '60px',
                            padding: '4px 6px',
                            fontSize: '0.875rem',
                            borderRadius: '4px',
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'var(--color-bg)',
                            color: 'var(--color-text)',
                            textAlign: 'center',
                          }}
                        />
                        <button
                          data-testid="btn-manual-roll"
                          onClick={() => handleRollRandomTable(true)}
                          style={{
                            padding: '6px 12px',
                            fontSize: '0.8125rem',
                            borderRadius: '4px',
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'var(--color-bg)',
                            color: 'var(--color-text)',
                            cursor: 'pointer',
                          }}
                        >
                          出目で引く
                        </button>
                      </div>

                      <div style={{ borderLeft: '1px solid var(--color-border)', height: '24px' }} />

                      <button
                        data-testid="btn-digital-roll"
                        onClick={() => handleRollRandomTable(false)}
                        style={{
                          padding: '6px 14px',
                          fontSize: '0.8125rem',
                          borderRadius: '4px',
                          border: 'none',
                          backgroundColor: 'var(--color-accent)',
                          color: '#fff',
                          fontWeight: 'bold',
                          cursor: 'pointer',
                        }}
                      >
                        アプリでダイスを振る ({selectedTable.dice})
                      </button>
                    </div>

                    {rollResult && (
                      <div
                        style={{
                          marginTop: '16px',
                          padding: '12px',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(59, 130, 246, 0.1)',
                          border: '1px solid var(--color-accent)',
                        }}
                      >
                        <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                          出目: <strong style={{ color: 'var(--color-accent)' }}>{rollResult.roll}</strong>
                        </div>
                        <div
                          data-testid="roll-result-text"
                          style={{ fontSize: '1rem', fontWeight: 'bold', marginTop: '4px' }}
                        >
                          {rollResult.text}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', marginTop: '48px', fontSize: '0.875rem' }}>
                  ランダム表を選択してください
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Link Condition Edit Modal */}
      {editingLink && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: '360px',
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '16px',
            }}
          >
            <div style={{ fontSize: '1rem', fontWeight: 'bold', marginBottom: '12px' }}>分岐条件の編集</div>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>条件テキスト</label>
              <input
                type="text"
                placeholder="例: 知覚判定 成功 / 失敗"
                value={linkConditionInput}
                onChange={(e) => setLinkConditionInput(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  fontSize: '0.875rem',
                  borderRadius: '4px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                onClick={() => handleDeleteLink(editingLink.id)}
                style={{
                  padding: '6px 10px',
                  fontSize: '0.75rem',
                  borderRadius: '4px',
                  border: '1px solid rgba(239, 68, 68, 0.5)',
                  backgroundColor: 'transparent',
                  color: '#ef4444',
                  cursor: 'pointer',
                }}
              >
                分岐削除
              </button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setEditingLink(null)}
                  style={{
                    padding: '6px 12px',
                    fontSize: '0.75rem',
                    borderRadius: '4px',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'transparent',
                    color: 'var(--color-text)',
                    cursor: 'pointer',
                  }}
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSaveLinkCondition}
                  style={{
                    padding: '6px 14px',
                    fontSize: '0.75rem',
                    borderRadius: '4px',
                    border: 'none',
                    backgroundColor: 'var(--color-accent)',
                    color: '#fff',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                  }}
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Version History Modal */}
      {showVersionsModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: '440px',
              maxHeight: '80vh',
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ fontSize: '1rem', fontWeight: 'bold' }}>バージョン履歴</div>
              <button
                onClick={() => setShowVersionsModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {versionsList.length === 0 ? (
                <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', textAlign: 'center', padding: '16px' }}>
                  保存された履歴はありません
                </div>
              ) : (
                versionsList.map((ver) => (
                  <div
                    key={ver.id}
                    style={{
                      padding: '10px',
                      borderRadius: '6px',
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'var(--color-bg)',
                      marginBottom: '8px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 'bold' }}>版 {ver.version}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        {new Date(ver.saved_at).toLocaleString()}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRestoreVersion(ver.id)}
                      style={{
                        padding: '4px 10px',
                        fontSize: '0.75rem',
                        borderRadius: '4px',
                        border: '1px solid var(--color-accent)',
                        backgroundColor: 'transparent',
                        color: 'var(--color-accent)',
                        cursor: 'pointer',
                      }}
                    >
                      この版に戻す
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Image Picker Modal */}
      {showImagePicker && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: '600px',
              maxHeight: '80vh',
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ fontSize: '1rem', fontWeight: 'bold' }}>画像選択</div>
              <button
                onClick={() => setShowImagePicker(false)}
                style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* Filter & Upload Toolbar */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input
                type="text"
                placeholder="タイトルや出典で絞り込み..."
                value={imageSearchQuery}
                onChange={(e) => setImageSearchQuery(e.target.value)}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  fontSize: '0.8125rem',
                  borderRadius: '4px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-bg)',
                  color: 'var(--color-text)',
                }}
              />
              <label
                style={{
                  padding: '6px 12px',
                  fontSize: '0.75rem',
                  borderRadius: '4px',
                  border: '1px solid var(--color-accent)',
                  backgroundColor: 'var(--color-accent)',
                  color: '#fff',
                  cursor: isUploadingImage ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold',
                }}
              >
                {isUploadingImage ? 'アップロード中...' : '+ アップロード'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={isUploadingImage}
                  onChange={handleUploadImage}
                  style={{ display: 'none' }}
                />
              </label>
            </div>

            {/* Images Grid */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                gap: '8px',
                padding: '4px',
              }}
            >
              {imagesList
                .filter((img) => {
                  if (!imageSearchQuery) return true;
                  const q = imageSearchQuery.toLowerCase();
                  return (
                    (img.title && img.title.toLowerCase().includes(q)) ||
                    (img.source_book && img.source_book.toLowerCase().includes(q))
                  );
                })
                .map((img) => (
                  <div
                    key={img.id}
                    onClick={() => handleSelectImage(img.id)}
                    style={{
                      border: '1px solid var(--color-border)',
                      borderRadius: '6px',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      backgroundColor: 'var(--color-bg)',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <div style={{ width: '100%', height: '80px', backgroundColor: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      <img
                        src={`/api/images/${img.id}`}
                        alt={img.title || 'image'}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    </div>
                    <div style={{ padding: '4px 6px', fontSize: '0.6875rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {img.title || '無題'}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
