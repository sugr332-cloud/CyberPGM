import React, { useState, useEffect, useCallback } from 'react';
import {
  CharacterSheet,
  DeviceInfo,
  SessionInfo,
  SaveSummary,
  MoneyLogEntry,
  WsClaimRequestPayload,
} from '@cyberpgm/shared';
import {
  api,
  getGmToken,
  setGmToken,
  gmFetch,
} from '../api.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { Footer } from '../components/Footer.js';
import { ShopView } from '../components/ShopView.js';
import { SkillsView } from '../components/SkillsView.js';
import { CharacterReceptionView } from '../components/CharacterReceptionView.js';
import { CombatView } from '../components/CombatView.js';
import { ScenarioMakerView } from '../components/ScenarioMakerView.js';
import { ScenarioPlayView } from '../components/ScenarioPlayView.js';
import { ResumeQrPanel } from '../components/ResumeQrPanel.js';
import { CharacterEditorView } from '../components/CharacterEditorView.js';
import { CharacterDetail } from '../components/CharacterDetail.js';
import { BgmPlayer, BgmState } from '../components/BgmPlayer.js';
import { getGmBgmOn, onGmBgmChange } from '../gmBgm.js';

export const GmPage: React.FC = () => {
  const [token, setToken] = useState<string | null>(getGmToken());

  // Automatically acquire GM token on mount if not present
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

  // GM Main View State
  const [activeTab, setActiveTab] = useState<'pc' | 'chara' | 'combat' | 'scenario' | 'shop' | 'skills' | 'db'>('pc');
  const [scenarioSubMode, setScenarioSubMode] = useState<'maker' | 'play'>('maker');
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth <= 640;
    }
    return false;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 640);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const [characters, setCharacters] = useState<CharacterSheet[]>([]);
  // キャラの持ち主と、縛られているシナリオの題名（Phase 5i）
  const [playerList, setPlayerList] = useState<Array<{ id: string; name: string }>>([]);
  const [scenarioTitles, setScenarioTitles] = useState<Record<string, string>>({});
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [moneyLogs, setMoneyLogs] = useState<MoneyLogEntry[]>([]);
  const [startingFunds, setStartingFunds] = useState<string>('');
  const [isUpdatingFunds, setIsUpdatingFunds] = useState(false);
  const [pcSubTab, setPcSubTab] = useState<'list' | 'reception'>('list');
  // キャラ作成タブ（Phase 5f）: PC タブの「編集」「＋ 追加」から開く対象
  const [editorRequest, setEditorRequest] = useState<{ id: string } | { kind: 'pc' | 'npc' | 'mook' } | null>(null);
  const [detailPcIds, setDetailPcIds] = useState<Set<string>>(new Set());
  // スマホからの購入申請（Phase 5g）: 来たら商店タブに数を出し、商店タブを読み直す
  const [purchaseRefreshKey, setPurchaseRefreshKey] = useState(0);
  const [pendingPurchaseCount, setPendingPurchaseCount] = useState(0);
  const openEditor = (req: { id: string } | { kind: 'pc' | 'npc' | 'mook' }) => {
    setEditorRequest(req);
    setActiveTab('chara');
  };
  const [pendingSubmissionsCount, setPendingSubmissionsCount] = useState<number>(0);

  // Money Quick Send State
  const [selectedAmount, setSelectedAmount] = useState<number | 'custom'>(500);
  const [customAmount, setCustomAmount] = useState('');
  const [reason, setReason] = useState('依頼の報酬');

  // Modals
  const [showQrModal, setShowQrModal] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [isQrFullscreen, setIsQrFullscreen] = useState(false);

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveList, setSaveList] = useState<SaveSummary[]>([]);
  const [newSaveName, setNewSaveName] = useState('');

  // Claim Request Alert from other devices
  const [pendingClaim, setPendingClaim] = useState<WsClaimRequestPayload | null>(null);
  const [latestWsMessage, setLatestWsMessage] = useState<{ type: string; payload: any } | null>(null);

  // NPC / Mook creation state
  // WebSocket Message Handler
  const handleWsMessage = useCallback((type: string, payload: unknown) => {
    setLatestWsMessage({ type, payload });
    if (type === 'bgm:update') {
      setGmBgm((payload as BgmState | null) ?? null);
    } else if (type === 'gm:presence') {
      const p = payload as { devices: DeviceInfo[] };
      setDevices(p.devices);
    } else if (type === 'gm:claim-request') {
      setPendingClaim(payload as WsClaimRequestPayload);
    } else if (type === 'gm:purchase-request') {
      setPurchaseRefreshKey((k) => k + 1);
    }
  }, []);

  useWebSocket({
    token,
    onMessage: handleWsMessage,
  });

  // この PC（GM 画面）で BGM を鳴らす（Phase 5n）。いまの曲は bgm:update で届く
  const [gmBgm, setGmBgm] = useState<BgmState | null>(null);
  const [gmBgmOn, setGmBgmOnState] = useState(getGmBgmOn());
  useEffect(() => onGmBgmChange(setGmBgmOnState), []);
  useEffect(() => {
    if (!token) return;
    gmFetch('/api/display')
      .then((r: Response) => r.json())
      .then((res: { display?: { bgm?: BgmState | null } }) => setGmBgm(res.display?.bgm ?? null))
      .catch(() => {});
  }, [token]);

  // Fetch initial data
  const refreshAllData = useCallback(() => {
    if (!token) return;

    api.getCharacters()
      .then((res: { characters: CharacterSheet[] }) => setCharacters(res.characters))
      .catch((err: unknown) => {
        console.warn('Failed to load characters:', err);
        // Automatically renew token if expired or revoked
        api.fetchGmToken()
          .then((res) => {
            setGmToken(res.token);
            setToken(res.token);
          })
          .catch(() => {});
      });

    api.getPlayers()
      .then((res) => setPlayerList(res.players))
      .catch(() => {});

    api.listScenarios()
      .then((res) => setScenarioTitles(Object.fromEntries(res.scenarios.map((s) => [s.id, s.title]))))
      .catch(() => {});

    api.getSettings()
      .then((res: { starting_funds: number | null }) => {
        setStartingFunds(res.starting_funds !== null ? String(res.starting_funds) : '');
      })
      .catch(() => {});

    api.getMoneyLogs()
      .then((res: { logs: MoneyLogEntry[] }) => setMoneyLogs(res.logs))
      .catch(() => {});

    api.getPurchaseRequests()
      .then((res) => setPendingPurchaseCount(res.requests.length))
      .catch(() => {});

    api.getCharacterSubmissions()
      .then((res) => {
        const count = res.submissions.filter((s) => s.status === 'pending').length;
        setPendingSubmissionsCount(count);
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    refreshAllData();
  }, [refreshAllData]);

  useEffect(() => {
    if (!token || purchaseRefreshKey === 0) return;
    api.getPurchaseRequests()
      .then((res) => setPendingPurchaseCount(res.requests.length))
      .catch(() => {});
  }, [purchaseRefreshKey, token]);

  // Resolve Claim Request
  const handleResolveClaim = async (allow: boolean) => {
    if (!pendingClaim) return;
    try {
      await api.resolveClaim(pendingClaim.requestId, allow);
      setPendingClaim(null);
    } catch (err) {
      console.warn('Failed to resolve claim:', err);
    }
  };

  // Open QR Modal
  const handleOpenQr = async () => {
    try {
      const info = await api.getSessionInfo();
      setSessionInfo(info);
      setShowQrModal(true);
    } catch (err) {
      console.warn('Failed to load session info:', err);
    }
  };

  // Open Saves Modal
  const handleOpenSaves = async () => {
    try {
      const res = await api.getSaves();
      setSaveList(res.saves);
      setShowSaveModal(true);
    } catch (err) {
      console.warn('Failed to load saves:', err);
    }
  };

  // Update starting funds
  const handleSaveStartingFunds = async () => {
    setIsUpdatingFunds(true);
    try {
      const val = startingFunds.trim() === '' ? null : Number(startingFunds);
      await api.updateSettings(val);
    } catch (err) {
      console.warn('Failed to update starting funds:', err);
    } finally {
      setIsUpdatingFunds(false);
    }
  };

  // Get active amount
  const getActiveAmount = (): number => {
    if (selectedAmount === 'custom') {
      return Number(customAmount) || 0;
    }
    return selectedAmount;
  };

  // Send Money to single PC
  const handleSendMoney = async (pcId: string, sign: 1 | -1) => {
    const amt = getActiveAmount() * sign;
    if (amt === 0) return;
    try {
      await api.sendMoney(pcId, amt, reason.trim() || '資金の調整');
      refreshAllData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`送金に失敗しました: ${msg}`);
    }
  };

  // Send Money to All
  const handleSendMoneyAll = async (sign: 1 | -1) => {
    const amt = getActiveAmount() * sign;
    if (amt === 0) return;
    try {
      await api.sendMoneyAll(amt, reason.trim() || '全員への資金');
      refreshAllData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`全員送金に失敗しました: ${msg}`);
    }
  };

  // Split Money
  const handleSplitMoney = async () => {
    const total = getActiveAmount();
    if (total <= 0) return;
    try {
      const res = await api.splitMoney(total, reason.trim() || '報酬の山分け');
      alert(`山分け完了: 1人あたり ${res.per_pc} eb（余り: ${res.remainder} eb）`);
      refreshAllData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`山分けに失敗しました: ${msg}`);
    }
  };

  // Save actions
  const handleCreateSave = async () => {
    if (!newSaveName.trim()) return;
    try {
      await api.createSave(newSaveName.trim());
      setNewSaveName('');
      const res = await api.getSaves();
      setSaveList(res.saves);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`保存に失敗しました: ${msg}`);
    }
  };

  // 再開用 QR（Phase 5d）: 読み込みのあと全員分、PC タブからは 1 人分
  const [resumeQr, setResumeQr] = useState<{ title: string; pcId?: string } | null>(null);

  const handleLoadSave = async (id: string, name: string) => {
    if (!confirm(`セーブ「${name}」を読み込みますか？\n（現在の状態は自動保存に残ります）`)) return;
    try {
      await api.loadSave(id);
      refreshAllData();
      setShowSaveModal(false);
      setResumeQr({ title: `セーブ「${name}」を読み込みました` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`読み込みに失敗しました: ${msg}`);
    }
  };

  const handleOverwriteSave = async (id: string, name: string) => {
    if (!confirm(`セーブ「${name}」を現在の状態で上書きしますか？`)) return;
    try {
      await api.overwriteSave(id);
      const res = await api.getSaves();
      setSaveList(res.saves);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`上書きに失敗しました: ${msg}`);
    }
  };

  const handleDeleteSave = async (id: string, name: string) => {
    if (!confirm(`セーブ「${name}」を削除しますか？`)) return;
    try {
      await api.deleteSave(id);
      const res = await api.getSaves();
      setSaveList(res.saves);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`削除に失敗しました: ${msg}`);
    }
  };

  const handleImportSaveFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target?.result as string;
        await api.importSave(text);
        const res = await api.getSaves();
        setSaveList(res.saves);
        alert('セーブファイルをインポートしました。');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        alert(`インポートに失敗しました: ${msg}`);
      }
    };
    reader.readAsText(file);
  };

  // Loading state while GM token is being automatically acquired
  if (!token) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--color-bg)',
          color: 'var(--color-text-muted)',
          fontSize: '0.9rem',
        }}
      >
        GM コンソールを読み込み中…
      </div>
    );
  }

  // 2. GM Dashboard View
  const onlineDeviceSet = new Set(
    devices.filter((d) => d.online && d.character_id).map((d) => d.character_id!),
  );

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--color-bg)',
        paddingBottom: isMobile ? '56px' : '0',
      }}
    >
      {gmBgmOn && <BgmPlayer bgm={gmBgm} compact />}
      {/* Top Header */}
      <header
        style={{
          height: '60px',
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface)',
          padding: isMobile ? '0 12px' : '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '16px' }}>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: isMobile ? '1.1rem' : '1.25rem',
              fontWeight: 700,
              color: 'var(--color-accent)',
              letterSpacing: '1px',
            }}
          >
            CYBERPGM
          </span>
          <span
            style={{
              backgroundColor: 'rgba(255, 90, 95, 0.2)',
              color: 'var(--color-accent)',
              fontSize: '0.75rem',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '4px',
              fontFamily: 'var(--font-mono)',
            }}
          >
            GM
          </span>

          {/* Navigation Tabs (Desktop only) */}
          {!isMobile && (
            <nav style={{ display: 'flex', gap: '4px', marginLeft: '24px' }}>
              {[
                { id: 'pc', label: 'PC' },
                { id: 'chara', label: 'キャラ作成' },
                { id: 'combat', label: '戦闘' },
                { id: 'scenario', label: 'シナリオ' },
                { id: 'shop', label: '商店' },
                { id: 'skills', label: '技能' },
                { id: 'db', label: 'DB' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  style={{
                    background: activeTab === tab.id ? 'var(--color-surface-elevated)' : 'none',
                    border: 'none',
                    borderBottom: activeTab === tab.id ? '2px solid var(--color-ally)' : 'none',
                    color: activeTab === tab.id ? 'var(--color-text)' : 'var(--color-text-muted)',
                    fontWeight: activeTab === tab.id ? 700 : 500,
                    padding: '8px 16px',
                    cursor: 'pointer',
                    borderRadius: '4px 4px 0 0',
                  }}
                >
                  {tab.label}
                  {tab.id === 'shop' && pendingPurchaseCount > 0 && (
                    <span
                      data-testid="shop-request-badge"
                      style={{ marginLeft: '6px', backgroundColor: 'var(--color-warning)', color: '#000', fontSize: '0.7rem', fontWeight: 800, padding: '1px 6px', borderRadius: '10px' }}
                    >
                      {pendingPurchaseCount}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          )}
        </div>

        {/* Header Right Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '6px' : '12px' }}>
          <button
            onClick={handleOpenQr}
            style={{
              backgroundColor: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-border-light)',
              color: 'var(--color-text)',
              padding: isMobile ? '6px 8px' : '8px 14px',
              borderRadius: '6px',
              fontSize: isMobile ? '0.75rem' : '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
            }}
          >
            参加用 QR
          </button>
          <button
            onClick={handleOpenSaves}
            style={{
              backgroundColor: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-border-light)',
              color: 'var(--color-text)',
              padding: isMobile ? '6px 8px' : '8px 14px',
              borderRadius: '6px',
              fontSize: isMobile ? '0.75rem' : '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
            }}
          >
            {isMobile ? '保存・読込' : '保存・読み込み'}
          </button>
        </div>
      </header>

      {/* Claim Request Notification Banner if pending */}
      {pendingClaim && (
        <div
          style={{
            backgroundColor: 'rgba(242, 201, 76, 0.2)',
            borderBottom: '1px solid var(--color-warning)',
            color: 'var(--color-warning)',
            padding: '12px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <strong>参加リクエスト:</strong> 「{pendingClaim.character_name}」に別の端末（
            {pendingClaim.deviceLabel || '端末'}）が参加しようとしています。
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => handleResolveClaim(true)}
              style={{
                backgroundColor: 'var(--color-success)',
                color: '#000',
                border: 'none',
                borderRadius: '4px',
                padding: '6px 16px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              許可（古い端末を切断）
            </button>
            <button
              onClick={() => handleResolveClaim(false)}
              style={{
                backgroundColor: 'var(--color-accent)',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                padding: '6px 16px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              拒否
            </button>
          </div>
        </div>
      )}

      {/* Tab Contents */}
      <main style={{ flex: 1, padding: '24px', maxWidth: '1440px', margin: '0 auto', width: '100%' }}>
        {activeTab === 'pc' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Sub-tab Navigation */}
            <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--color-border)', paddingBottom: '8px' }}>
              <button
                onClick={() => setPcSubTab('list')}
                style={{
                  padding: '8px 16px',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: pcSubTab === 'list' ? 'var(--color-surface-elevated)' : 'transparent',
                  color: pcSubTab === 'list' ? 'var(--color-ally)' : 'var(--color-text-muted)',
                  fontWeight: pcSubTab === 'list' ? 700 : 500,
                  cursor: 'pointer',
                  fontSize: '0.95rem',
                }}
              >
                PC 一覧
              </button>
              <button
                onClick={() => setPcSubTab('reception')}
                style={{
                  padding: '8px 16px',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: pcSubTab === 'reception' ? 'var(--color-surface-elevated)' : 'transparent',
                  color: pcSubTab === 'reception' ? 'var(--color-ally)' : 'var(--color-text-muted)',
                  fontWeight: pcSubTab === 'reception' ? 700 : 500,
                  cursor: 'pointer',
                  fontSize: '0.95rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>キャラ受付</span>
                {pendingSubmissionsCount > 0 && (
                  <span
                    style={{
                      backgroundColor: 'var(--color-warning)',
                      color: '#000',
                      fontSize: '0.75rem',
                      fontWeight: 800,
                      padding: '1px 6px',
                      borderRadius: '10px',
                    }}
                  >
                    {pendingSubmissionsCount}
                  </span>
                )}
              </button>
            </div>

            {pcSubTab === 'reception' ? (
              <CharacterReceptionView
                onRefreshCharacters={refreshAllData}
                onOpenQr={handleOpenQr}
                startingFunds={startingFunds}
                onSaveStartingFunds={handleSaveStartingFunds}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {/* Top Controls: Funds settings and Quick Send Bar */}
            <div
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                padding: '16px 20px',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '24px',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              {/* Money Quick Control */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>
                  資金操作:
                </span>
                {[50, 100, 500, 1000, 5000].map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setSelectedAmount(amt)}
                    style={{
                      backgroundColor:
                        selectedAmount === amt ? 'var(--color-ally)' : 'var(--color-surface-elevated)',
                      color: selectedAmount === amt ? '#000' : 'var(--color-text)',
                      border: '1px solid var(--color-border-light)',
                      borderRadius: '4px',
                      padding: '6px 10px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {amt}
                  </button>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="number"
                    value={customAmount}
                    onChange={(e) => {
                      setCustomAmount(e.target.value);
                      setSelectedAmount('custom');
                    }}
                    placeholder="自由入力"
                    style={{
                      width: '90px',
                      padding: '6px 8px',
                      backgroundColor: 'var(--color-bg)',
                      border: '1px solid var(--color-border-light)',
                      borderRadius: '4px',
                      color: 'var(--color-text)',
                      fontSize: '0.85rem',
                    }}
                  />
                  <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>eb</span>
                </div>

                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="理由（例: 依頼の報酬）"
                  style={{
                    width: '160px',
                    padding: '6px 8px',
                    backgroundColor: 'var(--color-bg)',
                    border: '1px solid var(--color-border-light)',
                    borderRadius: '4px',
                    color: 'var(--color-text)',
                    fontSize: '0.85rem',
                  }}
                />

                <button
                  onClick={() => handleSendMoneyAll(1)}
                  style={{
                    backgroundColor: 'var(--color-surface-elevated)',
                    border: '1px solid var(--color-ally)',
                    color: 'var(--color-ally)',
                    borderRadius: '4px',
                    padding: '6px 12px',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  全員に送る
                </button>
                <button
                  onClick={handleSplitMoney}
                  style={{
                    backgroundColor: 'var(--color-surface-elevated)',
                    border: '1px solid var(--color-warning)',
                    color: 'var(--color-warning)',
                    borderRadius: '4px',
                    padding: '6px 12px',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  合計額を人数で分ける
                </button>
              </div>

              {/* Starting Funds Setting */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>開始資金（シナリオで未設定のとき）:</span>
                <input
                  type="number"
                  value={startingFunds}
                  onChange={(e) => setStartingFunds(e.target.value)}
                  placeholder="未設定"
                  style={{
                    width: '90px',
                    padding: '6px 8px',
                    backgroundColor: 'var(--color-bg)',
                    border: '1px solid var(--color-border-light)',
                    borderRadius: '4px',
                    color: 'var(--color-text)',
                    fontSize: '0.85rem',
                    textAlign: 'center',
                  }}
                />
                <button
                  onClick={handleSaveStartingFunds}
                  disabled={isUpdatingFunds}
                  style={{
                    backgroundColor: 'var(--color-surface-elevated)',
                    border: '1px solid var(--color-border-light)',
                    color: 'var(--color-text)',
                    padding: '6px 10px',
                    borderRadius: '4px',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  保存
                </button>
                <button
                  onClick={() => openEditor({ kind: 'pc' })}
                  style={{
                    backgroundColor: 'var(--color-ally)',
                    border: 'none',
                    color: '#000',
                    padding: '6px 12px',
                    borderRadius: '4px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    marginLeft: '8px',
                  }}
                >
                  ＋ PC追加
                </button>
                <button
                  onClick={() => openEditor({ kind: 'npc' })}
                  style={{
                    backgroundColor: 'var(--color-enemy)',
                    border: 'none',
                    color: '#000',
                    padding: '6px 12px',
                    borderRadius: '4px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    marginLeft: '8px',
                  }}
                >
                  ＋ NPC/モブ追加
                </button>
              </div>
            </div>

            {/* PC Cards Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '20px',
              }}
            >
              {characters.map((pc) => {
                const isOnline = onlineDeviceSet.has(pc.id);
                return (
                  <div
                    key={pc.id}
                    data-testid="pc-card"
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
                    {/* Header: Avatar, Name, Role, Status */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <div
                          style={{
                            width: '42px',
                            height: '42px',
                            borderRadius: '50%',
                            backgroundColor: 'var(--color-surface-elevated)',
                            border: '1px solid var(--color-border-light)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '1.1rem',
                            fontWeight: 700,
                            color: 'var(--color-ally)',
                          }}
                        >
                          {pc.name.charAt(0)}
                        </div>
                        <div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{pc.name}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                            {pc.role}
                          </div>
                        </div>
                      </div>

                      <span
                        style={{
                          fontSize: '0.75rem',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          backgroundColor: isOnline ? 'rgba(126, 226, 168, 0.2)' : 'rgba(154, 157, 166, 0.2)',
                          color: isOnline ? 'var(--color-success)' : 'var(--color-text-muted)',
                          fontWeight: 600,
                        }}
                      >
                        {isOnline ? '● 接続中' : '○ 未接続'}
                      </span>
                      <button
                        onClick={() => openEditor({ id: pc.id })}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--color-text-muted)',
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                          marginLeft: '8px',
                          textDecoration: 'underline',
                        }}
                      >
                        編集
                      </button>
                      {pc.kind === 'pc' && (
                        <button
                          onClick={() => setResumeQr({ title: `${pc.name} の再開用 QR`, pcId: pc.id })}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--color-text-muted)',
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                            marginLeft: '8px',
                            textDecoration: 'underline',
                          }}
                        >
                          このキャラの QR
                        </button>
                      )}
                    </div>

                    {/* 持ち主と、未クリアのシナリオ（Phase 5i） */}
                    {pc.kind === 'pc' && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', fontSize: '0.8rem' }}>
                        <label style={{ color: 'var(--color-text-muted)' }}>
                          持ち主:{' '}
                          <select
                            value={pc.player_id ?? ''}
                            onChange={async (e) => {
                              await api.updateCharacter(pc.id, { player_id: e.target.value || null });
                              refreshAllData();
                            }}
                            style={{
                              backgroundColor: 'var(--color-bg)',
                              color: 'var(--color-text)',
                              border: '1px solid var(--color-border)',
                              borderRadius: '4px',
                              padding: '2px 4px',
                            }}
                          >
                            <option value="">（なし）</option>
                            {playerList.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        {pc.scenario_id && (
                          <span style={{ color: 'var(--color-warning)' }}>
                            「{scenarioTitles[pc.scenario_id] ?? '不明なシナリオ'}」未クリア
                            <button
                              onClick={async () => {
                                if (!confirm(`${pc.name} をこのシナリオから外しますか？ほかのシナリオで選べるようになります。`)) return;
                                await api.updateCharacter(pc.id, { scenario_id: null });
                                refreshAllData();
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--color-text-muted)',
                                fontSize: '0.8rem',
                                cursor: 'pointer',
                                marginLeft: '6px',
                                textDecoration: 'underline',
                              }}
                            >
                              シナリオから外す
                            </button>
                          </span>
                        )}
                      </div>
                    )}

                    {/* Stats summary: Funds, HP, Humanity */}
                    <div
                      style={{
                        backgroundColor: 'var(--color-surface-elevated)',
                        borderRadius: '6px',
                        padding: '10px 12px',
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '8px',
                        fontSize: '0.85rem',
                      }}
                    >
                      <div>
                        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>資金:</span>
                        <div style={{ fontWeight: 700, color: 'var(--color-warning)' }}>
                          {pc.eb.toLocaleString()} eb
                        </div>
                      </div>
                      <div>
                        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>HP:</span>
                        <div style={{ fontWeight: 700 }}>
                          {pc.hp} / {pc.hp_max}
                        </div>
                      </div>
                      <div style={{ gridColumn: 'span 2' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                          <span style={{ color: 'var(--color-text-muted)' }}>人間性 / EMP:</span>
                          <span>
                            {pc.humanity} / {pc.maxHumanity} (EMP {pc.currentEmp})
                          </span>
                        </div>
                        {/* Humanity progress */}
                        <div
                          style={{
                            height: '6px',
                            borderRadius: '3px',
                            backgroundColor: 'var(--color-bg)',
                            marginTop: '4px',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${Math.min(100, Math.round((pc.humanity / pc.maxHumanity) * 100))}%`,
                              backgroundColor: 'var(--color-ally)',
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setDetailPcIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(pc.id)) next.delete(pc.id);
                          else next.add(pc.id);
                          return next;
                        })
                      }
                      style={{
                        background: 'none',
                        border: '1px solid var(--color-border-light)',
                        borderRadius: '4px',
                        color: 'var(--color-text-muted)',
                        fontSize: '0.8rem',
                        padding: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      {detailPcIds.has(pc.id) ? '詳細を閉じる' : '能力値・技能・装備を見る'}
                    </button>
                    {detailPcIds.has(pc.id) && <CharacterDetail character={pc} />}

                    {/* Quick send / deduct buttons */}
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => handleSendMoney(pc.id, 1)}
                        style={{
                          flex: 1,
                          backgroundColor: 'rgba(79, 182, 227, 0.15)',
                          border: '1px solid var(--color-ally)',
                          color: 'var(--color-ally)',
                          borderRadius: '4px',
                          padding: '6px',
                          fontSize: '0.85rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        ＋ {getActiveAmount()} eb
                      </button>
                      <button
                        onClick={() => handleSendMoney(pc.id, -1)}
                        style={{
                          flex: 1,
                          backgroundColor: 'rgba(255, 90, 95, 0.15)',
                          border: '1px solid var(--color-accent)',
                          color: 'var(--color-accent)',
                          borderRadius: '4px',
                          padding: '6px',
                          fontSize: '0.85rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        − {getActiveAmount()} eb
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Money Log Table */}
            <div
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                padding: '16px 20px',
              }}
            >
              <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '12px' }}>お金のログ（最新）</h2>
              {moneyLogs.length > 0 ? (
                <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                        <th style={{ textAlign: 'left', padding: '6px 8px' }}>時刻</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px' }}>キャラクター</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px' }}>金額</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px' }}>残高</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px' }}>理由</th>
                      </tr>
                    </thead>
                    <tbody>
                      {moneyLogs.map((log) => (
                        <tr key={log.id} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                          <td style={{ padding: '6px 8px', color: 'var(--color-text-muted)' }}>
                            {new Date(log.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td style={{ padding: '6px 8px', fontWeight: 600 }}>{log.character_name}</td>
                          <td
                            style={{
                              padding: '6px 8px',
                              textAlign: 'right',
                              fontWeight: 700,
                              color: log.amount >= 0 ? 'var(--color-success)' : 'var(--color-accent)',
                            }}
                          >
                            {log.amount >= 0 ? `+${log.amount}` : log.amount} eb
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                            {log.balance_after.toLocaleString()} eb
                          </td>
                          <td style={{ padding: '6px 8px', color: 'var(--color-text-muted)' }}>{log.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>ログはありません</p>
              )}
            </div>
            </div>
          )}
          </div>
        ) : activeTab === 'chara' ? (
          <CharacterEditorView
            characters={characters}
            onSaved={refreshAllData}
            request={editorRequest}
            onRequestHandled={() => setEditorRequest(null)}
          />
        ) : activeTab === 'combat' ? (
          <CombatView
            characters={characters}
            onRefreshCharacters={refreshAllData}
            token={token}
            wsMessage={latestWsMessage}
          />
        ) : activeTab === 'shop' ? (
          <ShopView characters={characters} onRefreshCharacters={refreshAllData} purchaseRefreshKey={purchaseRefreshKey} />
        ) : activeTab === 'skills' ? (
          <SkillsView characters={characters} />
        ) : activeTab === 'scenario' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>モード:</span>
              <div style={{ display: 'flex', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '2px' }}>
                <button
                  type="button"
                  onClick={() => setScenarioSubMode('maker')}
                  style={{
                    padding: '4px 14px',
                    borderRadius: '4px',
                    border: 'none',
                    backgroundColor: scenarioSubMode === 'maker' ? 'var(--color-ally)' : 'transparent',
                    color: scenarioSubMode === 'maker' ? '#000' : 'var(--color-text-muted)',
                    fontWeight: scenarioSubMode === 'maker' ? 700 : 500,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                  }}
                >
                  作る
                </button>
                <button
                  type="button"
                  onClick={() => setScenarioSubMode('play')}
                  style={{
                    padding: '4px 14px',
                    borderRadius: '4px',
                    border: 'none',
                    backgroundColor: scenarioSubMode === 'play' ? 'var(--color-ally)' : 'transparent',
                    color: scenarioSubMode === 'play' ? '#000' : 'var(--color-text-muted)',
                    fontWeight: scenarioSubMode === 'play' ? 700 : 500,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                  }}
                >
                  進める
                </button>
              </div>
            </div>

            {scenarioSubMode === 'maker' ? (
              <ScenarioMakerView characters={characters} />
            ) : (
              <ScenarioPlayView characters={characters} />
            )}
          </div>
        ) : (
          /* Placeholder for other tabs */
          <div
            style={{
              padding: '64px 24px',
              textAlign: 'center',
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              color: 'var(--color-text-muted)',
            }}
          >
            <h2 style={{ fontSize: '1.25rem', color: 'var(--color-text)', marginBottom: '8px' }}>
              {activeTab === 'db' && 'DBタブ（Phase 3 で実装）'}
            </h2>
            <p style={{ fontSize: '0.875rem' }}>この機能は後のフェーズで実装されます。</p>
          </div>
        )}
      </main>

      {/* QR Code Modal */}
      {showQrModal && sessionInfo && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '24px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '12px',
              padding: '32px',
              maxWidth: isQrFullscreen ? '90vw' : '520px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '20px',
              textAlign: 'center',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>セッション参加用 QR</h2>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setIsQrFullscreen((prev) => !prev)}
                  style={{
                    backgroundColor: 'var(--color-surface-elevated)',
                    border: '1px solid var(--color-border-light)',
                    color: 'var(--color-text)',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                >
                  {isQrFullscreen ? '縮小' : '全画面 (TV映し用)'}
                </button>
                <button
                  onClick={() => setShowQrModal(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-text-muted)',
                    fontSize: '1.25rem',
                    cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* QR SVG */}
            <div
              style={{
                backgroundColor: '#fff',
                padding: '16px',
                borderRadius: '8px',
                width: isQrFullscreen ? '360px' : '240px',
                height: isQrFullscreen ? '360px' : '240px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              dangerouslySetInnerHTML={{ __html: sessionInfo.qrSvg }}
            />

            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
                セッションコード
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '2rem',
                  fontWeight: 700,
                  letterSpacing: '4px',
                  color: 'var(--color-ally)',
                }}
              >
                {sessionInfo.code}
              </div>
            </div>

            <div style={{ fontSize: '0.85rem', wordBreak: 'break-all', color: 'var(--color-text-muted)' }}>
              参加URL: <strong style={{ color: 'var(--color-text)' }}>{sessionInfo.joinUrl}</strong>
            </div>

            {/* Connected devices list */}
            <div style={{ width: '100%', borderTop: '1px solid var(--color-border)', paddingTop: '16px' }}>
              <h3 style={{ fontSize: '0.9rem', marginBottom: '8px', textAlign: 'left' }}>
                接続端末一覧 ({sessionInfo.devices.filter((d) => d.online).length} 台オンライン)
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '150px', overflowY: 'auto' }}>
                {sessionInfo.devices.map((d) => (
                  <div
                    key={d.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '0.8rem',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      backgroundColor: 'var(--color-surface-elevated)',
                    }}
                  >
                    <span>
                      {d.role === 'gm' ? 'GM端末' : d.character_name || '未選択'} ({d.label || '端末'})
                    </span>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ color: d.online ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                        {d.online ? '● 接続' : '○ 切断'}
                      </span>
                      {d.role === 'player' && (
                        <button
                          onClick={async () => {
                            if (confirm('紐付けを解除しますか？')) {
                              await api.unlinkDevice(d.id);
                              const updated = await api.getSessionInfo();
                              setSessionInfo(updated);
                            }
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--color-accent)',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                          }}
                        >
                          解除
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Saves Modal */}
      {showSaveModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '24px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '840px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              maxHeight: '90vh',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>セッションの保存と読み込み</h2>
              <button
                onClick={() => setShowSaveModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-text-muted)',
                  fontSize: '1.25rem',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', flex: 1, overflowY: 'auto' }}>
              {/* Left: Create Save */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div
                  style={{
                    backgroundColor: 'var(--color-surface-elevated)',
                    borderRadius: '8px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700 }}>名前をつけて保存</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                    現在のPCデータ、資金ログ、設定をスナップショットとして保存します。
                  </p>
                  <input
                    type="text"
                    value={newSaveName}
                    onChange={(e) => setNewSaveName(e.target.value)}
                    placeholder="セーブ名（例: 倉庫街突入前）"
                    style={{
                      padding: '8px 12px',
                      backgroundColor: 'var(--color-bg)',
                      border: '1px solid var(--color-border-light)',
                      borderRadius: '4px',
                      color: 'var(--color-text)',
                      fontSize: '0.85rem',
                    }}
                  />
                  <button
                    onClick={handleCreateSave}
                    disabled={!newSaveName.trim()}
                    style={{
                      backgroundColor: 'var(--color-ally)',
                      color: '#000',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '10px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    保存する
                  </button>
                </div>

                <div
                  style={{
                    backgroundColor: 'var(--color-surface-elevated)',
                    borderRadius: '8px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700 }}>ファイルから読み込み</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                    .cpgm-save ファイルをインポートしてセーブ一覧に追加します。
                  </p>
                  <label
                    style={{
                      display: 'inline-block',
                      backgroundColor: 'var(--color-bg)',
                      border: '1px dashed var(--color-border-light)',
                      borderRadius: '6px',
                      padding: '12px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                    }}
                  >
                    ファイルを選択 (.cpgm-save)
                    <input
                      type="file"
                      accept=".cpgm-save,.json"
                      onChange={handleImportSaveFile}
                      style={{ display: 'none' }}
                    />
                  </label>
                </div>
              </div>

              {/* Right: Save List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700 }}>セーブ一覧</h3>
                {saveList.length > 0 ? (
                  saveList.map((sv) => (
                    <div
                      key={sv.id}
                      data-testid={`save-row-${sv.id}`}
                      style={{
                        backgroundColor: 'var(--color-surface-elevated)',
                        border: '1px solid var(--color-border-light)',
                        borderRadius: '6px',
                        padding: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <strong style={{ fontSize: '0.95rem' }}>{sv.name}</strong>
                          <span
                            style={{
                              marginLeft: '8px',
                              fontSize: '0.7rem',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: sv.kind === 'auto' ? 'rgba(242, 201, 76, 0.2)' : 'rgba(79, 182, 227, 0.2)',
                              color: sv.kind === 'auto' ? 'var(--color-warning)' : 'var(--color-ally)',
                            }}
                          >
                            {sv.kind === 'auto' ? '自動保存' : '手動'}
                          </span>
                        </div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                          {new Date(sv.updated_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                      </div>

                      {sv.summary && (
                        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{sv.summary}</p>
                      )}

                      <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => handleLoadSave(sv.id, sv.name)}
                          style={{
                            backgroundColor: 'var(--color-ally)',
                            color: '#000',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '4px 10px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          読み込む
                        </button>
                        <button
                          onClick={() => handleOverwriteSave(sv.id, sv.name)}
                          style={{
                            backgroundColor: 'var(--color-surface)',
                            border: '1px solid var(--color-border-light)',
                            color: 'var(--color-text)',
                            borderRadius: '4px',
                            padding: '4px 8px',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                          }}
                        >
                          上書き
                        </button>
                        <a
                          href={`/api/saves/${sv.id}/file`}
                          download
                          style={{
                            backgroundColor: 'var(--color-surface)',
                            border: '1px solid var(--color-border-light)',
                            color: 'var(--color-text)',
                            borderRadius: '4px',
                            padding: '4px 8px',
                            fontSize: '0.75rem',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                          }}
                        >
                          書き出し
                        </a>
                        <button
                          onClick={() => handleDeleteSave(sv.id, sv.name)}
                          style={{
                            backgroundColor: 'var(--color-surface)',
                            border: '1px solid var(--color-accent)',
                            color: 'var(--color-accent)',
                            borderRadius: '4px',
                            padding: '4px 8px',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                          }}
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                    セーブデータはありません
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation Tabs */}
      {isMobile && (
        <nav
          data-testid="gm-bottom-nav"
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            height: '56px',
            backgroundColor: 'var(--color-surface)',
            borderTop: '1px solid var(--color-border)',
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            zIndex: 100,
          }}
        >
          {[
            { id: 'pc', label: 'PC' },
            { id: 'chara', label: '作成' },
            { id: 'combat', label: '戦闘' },
            { id: 'scenario', label: 'シナリオ' },
            { id: 'shop', label: '商店' },
            { id: 'skills', label: '技能' },
            { id: 'db', label: 'DB' },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                data-testid={`gm-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                style={{
                  background: 'none',
                  border: 'none',
                  borderTop: isActive ? '2px solid var(--color-ally)' : '2px solid transparent',
                  color: isActive ? 'var(--color-ally)' : 'var(--color-text-muted)',
                  fontWeight: isActive ? 700 : 500,
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '4px 0',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      )}

      {resumeQr && <ResumeQrPanel title={resumeQr.title} onlyPcId={resumeQr.pcId} onClose={() => setResumeQr(null)} />}

      <Footer />
    </div>
  );
};
