import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CharacterDraft,
  CharacterStats,
  CreationMethodConfig,
  ROLES,
  formatRole,
  SKILL_CATALOG,
  SKILL_CATEGORIES,
  SkillCatalogEntry,
  CpgmCharacterFile,
  formatWeaponType,
} from '@cyberpgm/shared';
import {
  validateCharacterDraft,
  neededRoll,
  formatNeeded,
  successProbability,
} from '@cyberpgm/rules';
import { api } from '../api.js';
import '../player-theme.css';

const STORAGE_KEY = 'cpgm_char_draft';
const SUBMISSION_ID_KEY = 'cpgm_submission_id';

const STAT_NAMES_JA: Record<string, string> = {
  int: '知力 (INT)',
  ref: '反応 (REF)',
  dex: '軽業 (DEX)',
  tech: '技術 (TECH)',
  cool: '冷却 (COOL)',
  will: '意志 (WILL)',
  luck: '幸運 (LUCK)',
  move: '移動 (MOVE)',
  body: '体格 (BODY)',
  emp: '共感 (EMP)',
};

const DEFAULT_STATS: CharacterStats = {
  int: 6,
  ref: 6,
  dex: 6,
  tech: 6,
  cool: 6,
  will: 6,
  luck: 6,
  move: 6,
  body: 6,
  emp: 6,
};

export const CharacterCreatePage: React.FC = () => {
  const navigate = useNavigate();

  // Active step: 1: 基本, 2: 能力値, 3: 技能, 4: 装備, 5: 送信
  const [step, setStep] = useState<number>(1);

  // Creation Settings & Notes
  const [methodConfig, setMethodConfig] = useState<CreationMethodConfig | null>(null);
  const [activeMethodKey, setActiveMethodKey] = useState<string>('complete_package');
  const [startingFunds, setStartingFunds] = useState<number | null>(null);
  const [fundsScenarioTitle, setFundsScenarioTitle] = useState<string | null>(null);
  const [skillNotes, setSkillNotes] = useState<Record<string, string>>({});

  // Draft State
  const [name, setName] = useState<string>('');
  const [role, setRole] = useState<string>('Solo');
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [stats, setStats] = useState<CharacterStats>(DEFAULT_STATS);
  const [skills, setSkills] = useState<Record<string, number>>({});
  const [inventory, setInventory] = useState<Array<{
    item_id?: string;
    name: string;
    qty: number;
    price_eb?: number;
    category?: string;
    humanity_loss_static?: number;
  }>>([]);
  const [cyberware, setCyberware] = useState<Array<{
    item_id?: string;
    name: string;
    type?: string;
    static_loss?: number;
  }>>([]);

  // Catalog items for equipment selection
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [equipCategory, setEquipCategory] = useState<string>('all');
  const [equipSearch, setEquipSearch] = useState<string>('');

  // Skill filter & Detail popup
  const [skillCategory, setSkillCategory] = useState<string>('all');
  const [skillSearch, setSkillSearch] = useState<string>('');
  const [selectedSkillDetail, setSelectedSkillDetail] = useState<SkillCatalogEntry | null>(null);
  const [showFormulaExplanation, setShowFormulaExplanation] = useState<boolean>(false);

  // Square Image Cropping
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  // Submission Status
  const [submissionId, setSubmissionId] = useState<string | null>(() => localStorage.getItem(SUBMISSION_ID_KEY));
  const [submissionStatus, setSubmissionStatus] = useState<any | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Load Creation Settings, Notes, and Catalog
  useEffect(() => {
    async function init() {
      try {
        const [methodsRes, notesRes, itemsRes] = await Promise.all([
          api.getCreationMethods(),
          api.getSkillNotes(),
          api.getItems({ limit: 200 }),
        ]);

        const activeMethod = methodsRes.methods.find((m) => m.key === methodsRes.active_method) || methodsRes.methods[0] || null;
        setMethodConfig(activeMethod);
        setActiveMethodKey(methodsRes.active_method || 'complete_package');
        setStartingFunds(methodsRes.starting_funds);
        setFundsScenarioTitle(methodsRes.scenario_title ?? null);
        setSkillNotes(notesRes.notes || {});
        setCatalogItems(itemsRes.items || []);
      } catch (err) {
        console.error('Failed to load initial creation data:', err);
      }
    }
    init();
  }, []);

  // Restore from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: CharacterDraft = JSON.parse(saved);
        if (parsed.name) setName(parsed.name);
        if (parsed.role) setRole(parsed.role);
        if (parsed.image_path) setImagePath(parsed.image_path);
        if (parsed.stats) setStats(parsed.stats);
        if (parsed.skills) setSkills(parsed.skills);
        if (parsed.inventory) setInventory(parsed.inventory as any);
        if (parsed.cyberware) setCyberware(parsed.cyberware as any);
      }
    } catch {
      // ignore
    }
  }, []);

  // Save to localStorage on change
  useEffect(() => {
    const draft: CharacterDraft = {
      name,
      role,
      image_path: imagePath,
      stats,
      skills,
      inventory,
      cyberware,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // ignore
    }
  }, [name, role, imagePath, stats, skills, inventory, cyberware]);

  // Poll submission status if pending
  useEffect(() => {
    if (!submissionId) return;

    let timer: any = null;
    const checkStatus = async () => {
      try {
        const res = await api.getCharacterSubmission(submissionId);
        setSubmissionStatus(res);
      } catch {
        // ignore
      }
    };

    checkStatus();
    timer = setInterval(checkStatus, 3000);
    return () => clearInterval(timer);
  }, [submissionId]);

  // Character Draft Object for validation
  const currentDraft: CharacterDraft = useMemo(() => {
    return {
      name,
      role,
      image_path: imagePath,
      stats,
      skills,
      inventory,
      cyberware,
    };
  }, [name, role, imagePath, stats, skills, inventory, cyberware]);

  const validationResults = useMemo(() => {
    return validateCharacterDraft(currentDraft, methodConfig, startingFunds);
  }, [currentDraft, methodConfig, startingFunds]);

  // Handlers for Stats
  const handleStatChange = (key: keyof CharacterStats, delta: number) => {
    const current = stats[key] ?? 6;
    const next = Math.max(1, Math.min(10, current + delta));
    setStats((prev) => ({ ...prev, [key]: next }));
  };

  // Handlers for Skills
  const handleSkillChange = (key: string, delta: number) => {
    const current = skills[key] ?? 0;
    const next = Math.max(0, Math.min(10, current + delta));
    setSkills((prev) => {
      const copy = { ...prev };
      if (next === 0) {
        delete copy[key];
      } else {
        copy[key] = next;
      }
      return copy;
    });
  };

  // Handlers for Equipment
  const handleAddEquipment = (item: any) => {
    // Add to inventory
    const existingIdx = inventory.findIndex((i) => i.name === (item.name_ja || item.name_en));
    if (existingIdx >= 0) {
      setInventory((prev) =>
        prev.map((i, idx) => (idx === existingIdx ? { ...i, qty: i.qty + 1 } : i)),
      );
    } else {
      setInventory((prev) => [
        ...prev,
        {
          item_id: item.id,
          name: item.name_ja || item.name_en,
          qty: 1,
          price_eb: item.price_eb ?? 0,
          category: item.kind,
        },
      ]);
    }

    // If cyberware, also add to cyberware list
    if (item.kind === 'cyberware') {
      const staticLoss =
        item.humanity_loss_static ?? (item.cyberware?.humanity_loss_static ?? 0);
      setCyberware((prev) => [
        ...prev,
        {
          item_id: item.id,
          name: item.name_ja || item.name_en,
          type: item.cyberware?.cw_type,
          static_loss: staticLoss,
        },
      ]);
    }
  };

  const handleRemoveEquipment = (nameToRemove: string) => {
    const existing = inventory.find((i) => i.name === nameToRemove);
    if (!existing) return;

    if (existing.qty > 1) {
      setInventory((prev) =>
        prev.map((i) => (i.name === nameToRemove ? { ...i, qty: i.qty - 1 } : i)),
      );
    } else {
      setInventory((prev) => prev.filter((i) => i.name !== nameToRemove));
    }

    // If cyberware, remove one instance from cyberware
    const cwIdx = cyberware.findIndex((cw) => cw.name === nameToRemove);
    if (cwIdx >= 0) {
      setCyberware((prev) => prev.filter((_, idx) => idx !== cwIdx));
    }
  };

  // Image Selection & Crop
  const handleImageFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setCropSrc(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const performSquareCrop = (srcUrl: string) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = Math.min(img.width, img.height);
      const outputSize = Math.min(size, 512);
      canvas.width = outputSize;
      canvas.height = outputSize;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, outputSize, outputSize);
        const dataUrl = canvas.toDataURL('image/png');
        setImagePath(dataUrl);
      }
      setCropSrc(null);
    };
    img.src = srcUrl;
  };

  // Save to file (.cpgm)
  const handleExportCpgm = () => {
    const fileData: CpgmCharacterFile = {
      format: 'cpgm-character',
      version: 1,
      character: currentDraft,
      created_with: {
        method: activeMethodKey,
        starting_funds: startingFunds,
      },
    };

    const blob = new Blob([JSON.stringify(fileData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.trim() || 'character'}.cpgm`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Submit to GM
  const handleSubmit = async () => {
    if (!name.trim()) {
      alert('ハンドル名を入力してください');
      setStep(1);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.submitCharacter(currentDraft, 'wifi', {
        method: activeMethodKey,
        starting_funds: startingFunds,
      });

      setSubmissionId(res.id);
      localStorage.setItem(SUBMISSION_ID_KEY, res.id);
    } catch (err: any) {
      alert(err.message || '送信に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered skills list
  const filteredSkills = useMemo(() => {
    return Object.values(SKILL_CATALOG).filter((s) => {
      if (skillCategory !== 'all' && s.category !== skillCategory) return false;
      if (skillSearch.trim()) {
        const q = skillSearch.toLowerCase();
        const note = skillNotes[s.key]?.toLowerCase() || '';
        return s.name.toLowerCase().includes(q) || s.key.toLowerCase().includes(q) || note.includes(q);
      }
      return true;
    });
  }, [skillCategory, skillSearch, skillNotes]);

  // Filtered equipment list
  const filteredItems = useMemo(() => {
    return catalogItems.filter((item) => {
      if (equipCategory !== 'all' && item.kind !== equipCategory) return false;
      if (equipSearch.trim()) {
        const q = equipSearch.toLowerCase();
        const nameJa = item.name_ja?.toLowerCase() || '';
        const nameEn = item.name_en?.toLowerCase() || '';
        return nameJa.includes(q) || nameEn.includes(q);
      }
      return true;
    });
  }, [catalogItems, equipCategory, equipSearch]);

  // If submitted and pending / accepted / rejected
  if (submissionId && submissionStatus) {
    return (
      <div
        className="cp-player"
        style={{
          minHeight: '100vh',
          backgroundColor: 'var(--color-bg)',
          color: 'var(--color-text)',
          padding: '24px 16px',
          maxWidth: '480px',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 6px 0', color: 'var(--color-text)' }}>
            キャラクター作成
          </h1>
          <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            Cyberpunk RED 参加受付
          </span>
        </div>

        {submissionStatus.status === 'pending' && (
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-warning)',
              borderRadius: '8px',
              padding: '24px 20px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <h2 style={{ fontSize: '1.2rem', margin: 0, color: 'var(--color-warning)' }}>
              GMの受付待ちです
            </h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
              「<strong>{submissionStatus.name}</strong>」のキャラデータをGMに送信しました。<br />
              GMが取り込むまでこの画面のままお待ちください（自動で更新されます）。
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
              <button
                onClick={handleExportCpgm}
                style={{
                  padding: '8px 14px',
                  backgroundColor: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-border-light)',
                  color: 'var(--color-text)',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                バックアップ保存 (.cpgm)
              </button>
            </div>
          </div>
        )}

        {submissionStatus.status === 'accepted' && (
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-ally)',
              borderRadius: '8px',
              padding: '24px 20px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <h2 style={{ fontSize: '1.2rem', margin: 0, color: 'var(--color-ally)' }}>
              GMがキャラクターを取り込みました！
            </h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', margin: 0 }}>
              「<strong>{submissionStatus.name}</strong>」がセッションに参加しました。
            </p>
            <button
              onClick={() => {
                localStorage.removeItem(SUBMISSION_ID_KEY);
                localStorage.removeItem(STORAGE_KEY);
                navigate('/player');
              }}
              style={{
                padding: '12px',
                backgroundColor: 'var(--color-ally)',
                border: 'none',
                color: '#000',
                borderRadius: '6px',
                fontWeight: 700,
                fontSize: '1rem',
                cursor: 'pointer',
              }}
            >
              キャラクターシートを開く
            </button>
          </div>
        )}

        {submissionStatus.status === 'rejected' && (
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-accent)',
              borderRadius: '8px',
              padding: '24px 20px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <h2 style={{ fontSize: '1.2rem', margin: 0, color: 'var(--color-accent)' }}>
              GMから差し戻されました
            </h2>
            {submissionStatus.rejection_comment && (
              <div
                style={{
                  padding: '12px',
                  backgroundColor: 'rgba(255, 90, 95, 0.15)',
                  border: '1px solid var(--color-accent)',
                  borderRadius: '6px',
                  textAlign: 'left',
                  fontSize: '0.85rem',
                  color: 'var(--color-text)',
                }}
              >
                <strong style={{ color: 'var(--color-accent)' }}>GMのコメント:</strong>
                <p style={{ margin: '4px 0 0 0' }}>{submissionStatus.rejection_comment}</p>
              </div>
            )}
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: 0 }}>
              内容を修正して再度GMに送信できます。
            </p>
            <button
              onClick={() => {
                localStorage.removeItem(SUBMISSION_ID_KEY);
                setSubmissionId(null);
                setSubmissionStatus(null);
                setStep(5);
              }}
              style={{
                padding: '10px 16px',
                backgroundColor: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border-light)',
                color: 'var(--color-text)',
                borderRadius: '6px',
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: 'pointer',
              }}
            >
              修正して再送する
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="cp-player"
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--color-bg)',
        color: 'var(--color-text)',
        padding: '16px 12px 80px 12px',
        maxWidth: '480px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          onClick={() => navigate('/player')}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-text-muted)',
            fontSize: '0.85rem',
            cursor: 'pointer',
            padding: '4px 0',
          }}
        >
          ← 参加画面に戻る
        </button>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          {methodConfig?.label || '完全版の作成方法'}
        </span>
      </div>

      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 800, margin: '0 0 4px 0', color: 'var(--color-text)' }}>
          キャラクター作成
        </h1>
        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: 0 }}>
          {step === 1 && '1. 基本情報を設定します'}
          {step === 2 && '2. 10個の能力値を決定します'}
          {step === 3 && '3. 技能ポイントを割り振ります'}
          {step === 4 && '4. 初期装備とサイバーウェアを選びます'}
          {step === 5 && '5. 内容を確認してGMに送信します'}
        </p>
      </div>

      {/* Stepper Navigation */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: '4px',
          backgroundColor: 'var(--color-surface)',
          padding: '4px',
          borderRadius: '8px',
          border: '1px solid var(--color-border)',
        }}
      >
        {[
          { num: 1, label: '基本' },
          { num: 2, label: '能力値' },
          { num: 3, label: '技能' },
          { num: 4, label: '装備' },
          { num: 5, label: '送信' },
        ].map((s) => (
          <button
            key={s.num}
            onClick={() => setStep(s.num)}
            style={{
              padding: '6px 2px',
              border: 'none',
              borderRadius: '4px',
              backgroundColor: step === s.num ? 'var(--color-ally)' : 'transparent',
              color: step === s.num ? '#000' : 'var(--color-text-muted)',
              fontSize: '0.75rem',
              fontWeight: step === s.num ? 700 : 500,
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* STEP 1: 基本 */}
      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Avatar Upload & Preview */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
              padding: '20px',
              backgroundColor: 'var(--color-surface)',
              borderRadius: '8px',
              border: '1px solid var(--color-border)',
            }}
          >
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              capture="environment"
              onChange={handleImageFileSelect}
              style={{ display: 'none' }}
            />

            {imagePath ? (
              <img
                src={imagePath}
                alt="Avatar"
                style={{
                  width: '96px',
                  height: '96px',
                  borderRadius: '12px',
                  objectFit: 'cover',
                  border: '2px solid var(--color-ally)',
                }}
              />
            ) : (
              <div
                style={{
                  width: '96px',
                  height: '96px',
                  borderRadius: '12px',
                  backgroundColor: 'var(--color-surface-elevated)',
                  border: '1px dashed var(--color-border-light)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.85rem',
                  color: 'var(--color-text-muted)',
                }}
              >
                No Image
              </div>
            )}

            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                backgroundColor: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border-light)',
                color: 'var(--color-text)',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              写真を撮る・画像を選択
            </button>
            <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
              ※ 正方形に中央切り抜きされます
            </span>
          </div>

          {/* Handle Name */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              backgroundColor: 'var(--color-surface)',
              padding: '16px',
              borderRadius: '8px',
              border: '1px solid var(--color-border)',
            }}
          >
            <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text)' }}>
              ハンドル名（必須）
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: V, ジョニー, ルーシー"
              style={{
                padding: '10px 12px',
                fontSize: '1rem',
                borderRadius: '6px',
                border: '1px solid var(--color-border-light)',
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
              }}
            />
          </div>

          {/* Role Selection */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              backgroundColor: 'var(--color-surface)',
              padding: '16px',
              borderRadius: '8px',
              border: '1px solid var(--color-border)',
            }}
          >
            <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text)' }}>
              ロール（役割）
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              {ROLES.map((r) => {
                const isSelected = role === r.key || role === r.nameJa;
                return (
                  <button
                    key={r.key}
                    onClick={() => setRole(r.key)}
                    style={{
                      padding: '10px 8px',
                      borderRadius: '6px',
                      border: isSelected ? '2px solid var(--color-ally)' : '1px solid var(--color-border-light)',
                      backgroundColor: isSelected ? 'var(--color-surface-elevated)' : 'transparent',
                      color: isSelected ? 'var(--color-ally)' : 'var(--color-text)',
                      fontWeight: isSelected ? 700 : 500,
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      textAlign: 'center',
                    }}
                  >
                    <div>{r.nameJa}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                      {r.nameEn}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={() => setStep(2)}
            style={{
              padding: '12px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: 'var(--color-ally)',
              color: '#000',
              fontWeight: 700,
              fontSize: '1rem',
              cursor: 'pointer',
              marginTop: '8px',
            }}
          >
            次へ: 能力値を決める →
          </button>
        </div>
      )}

      {/* STEP 2: 能力値 */}
      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Points Status Sticky Banner */}
          <div
            style={{
              position: 'sticky',
              top: '8px',
              zIndex: 20,
              backgroundColor: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
          >
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                能力値ポイント
              </div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                {validationResults.stats.unconfigured ? (
                  <span style={{ color: 'var(--color-text)' }}>
                    合計: {validationResults.stats.total} pt
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: '6px' }}>
                      (未設定のため制限なし)
                    </span>
                  </span>
                ) : (
                  <span
                    style={{
                      color:
                        validationResults.stats.remaining! < 0
                          ? 'var(--color-accent)'
                          : 'var(--color-ally)',
                    }}
                  >
                    残り: {validationResults.stats.remaining} pt / {methodConfig?.stat_points} pt
                  </span>
                )}
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                初期人間性
              </div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-ally)' }}>
                {stats.emp * 10} <span style={{ fontSize: '0.75rem' }}>(EMP {stats.emp})</span>
              </div>
            </div>
          </div>

          {/* Stats List */}
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
            {Object.entries(STAT_NAMES_JA).map(([stKey, stLabel]) => {
              const val = (stats as any)[stKey] ?? 6;
              return (
                <div
                  key={stKey}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 0',
                    borderBottom: '1px solid var(--color-border-light)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text)' }}>
                      {stLabel}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                      onClick={() => handleStatChange(stKey as keyof CharacterStats, -1)}
                      disabled={val <= 1}
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '6px',
                        border: '1px solid var(--color-border-light)',
                        backgroundColor: 'var(--color-surface-elevated)',
                        color: 'var(--color-text)',
                        fontSize: '1.2rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      −
                    </button>

                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '1.2rem',
                        fontWeight: 800,
                        width: '28px',
                        textAlign: 'center',
                      }}
                    >
                      {val}
                    </span>

                    <button
                      onClick={() => handleStatChange(stKey as keyof CharacterStats, 1)}
                      disabled={val >= 10}
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '6px',
                        border: '1px solid var(--color-border-light)',
                        backgroundColor: 'var(--color-surface-elevated)',
                        color: 'var(--color-text)',
                        fontSize: '1.2rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      ＋
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => setStep(1)}
              style={{
                flex: 1,
                padding: '12px',
                borderRadius: '6px',
                border: '1px solid var(--color-border-light)',
                backgroundColor: 'transparent',
                color: 'var(--color-text-muted)',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
              }}
            >
              ← 基本に戻る
            </button>
            <button
              onClick={() => setStep(3)}
              style={{
                flex: 2,
                padding: '12px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: 'var(--color-ally)',
                color: '#000',
                fontWeight: 700,
                fontSize: '1rem',
                cursor: 'pointer',
              }}
            >
              次へ: 技能を選ぶ →
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: 技能 */}
      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Skill Points Sticky Banner */}
          <div
            style={{
              position: 'sticky',
              top: '8px',
              zIndex: 20,
              backgroundColor: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
          >
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                技能ポイント
              </div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                {validationResults.skills.unconfigured ? (
                  <span style={{ color: 'var(--color-text)' }}>
                    消費: {validationResults.skills.totalSpent} pt
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: '6px' }}>
                      (未設定のため制限なし)
                    </span>
                  </span>
                ) : (
                  <span
                    style={{
                      color:
                        validationResults.skills.remaining! < 0
                          ? 'var(--color-accent)'
                          : 'var(--color-ally)',
                    }}
                  >
                    残り: {validationResults.skills.remaining} pt / {methodConfig?.skill_points} pt
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={() => setShowFormulaExplanation(!showFormulaExplanation)}
              style={{
                backgroundColor: 'transparent',
                border: '1px solid var(--color-border-light)',
                borderRadius: '4px',
                color: 'var(--color-ally)',
                fontSize: '0.75rem',
                padding: '4px 8px',
                cursor: 'pointer',
              }}
            >
              {showFormulaExplanation ? '▲ 計算方法を閉じる' : '▼ 判定の計算方法'}
            </button>
          </div>

          {/* Collapsible Formula Explanation */}
          {showFormulaExplanation && (
            <div
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                padding: '14px',
                fontSize: '0.8rem',
                lineHeight: 1.5,
                color: 'var(--color-text-muted)',
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--color-text)', marginBottom: '4px' }}>
                技能判定の基本ルール:
              </div>
              <div>· <strong>基本値</strong> = 能力値 + 技能レベル</div>
              <div>· <strong>判定式</strong> = 基本値 + 1d10（10面ダイス）</div>
              <div>· 判定値が難易度（DV）を<strong>超えれば成功</strong>（同値は失敗）</div>
              <div>· <strong>出目10 (クリティカル)</strong>: もう一度1d10を振って合計に加算</div>
              <div>· <strong>出目1 (ファンブル)</strong>: もう一度1d10を振って合計から減算</div>
              <div>· <strong>対抗判定</strong>: 相手がいる行動は、双方の合計値を比較して高い方が勝ち</div>
              <div>· <strong>負傷修正</strong>: 重傷時は全行動 −2、瀕死時は全行動 −4</div>
            </div>
          )}

          {/* Category Filters & Search */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              type="text"
              placeholder="技能名・用途で検索…"
              value={skillSearch}
              onChange={(e) => setSkillSearch(e.target.value)}
              style={{
                padding: '8px 12px',
                fontSize: '0.85rem',
                borderRadius: '6px',
                border: '1px solid var(--color-border-light)',
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-text)',
              }}
            />

            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
              <button
                onClick={() => setSkillCategory('all')}
                style={{
                  padding: '4px 10px',
                  borderRadius: '16px',
                  whiteSpace: 'nowrap',
                  border: skillCategory === 'all' ? '1px solid var(--color-ally)' : '1px solid var(--color-border-light)',
                  backgroundColor: skillCategory === 'all' ? 'var(--color-surface-elevated)' : 'transparent',
                  color: skillCategory === 'all' ? 'var(--color-ally)' : 'var(--color-text-muted)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                すべて
              </button>
              {Object.entries(SKILL_CATEGORIES).map(([catKey, catLabel]) => (
                <button
                  key={catKey}
                  onClick={() => setSkillCategory(catKey)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '16px',
                    whiteSpace: 'nowrap',
                    border: skillCategory === catKey ? '1px solid var(--color-ally)' : '1px solid var(--color-border-light)',
                    backgroundColor: skillCategory === catKey ? 'var(--color-surface-elevated)' : 'transparent',
                    color: skillCategory === catKey ? 'var(--color-ally)' : 'var(--color-text-muted)',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {catLabel}
                </button>
              ))}
            </div>
          </div>

          {/* Skills List */}
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
            {filteredSkills.map((s) => {
              const lvl = skills[s.key] ?? 0;
              const statVal = (stats as any)[s.stat] ?? 6;
              const baseVal = statVal + lvl;

              return (
                <div
                  key={s.key}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 4px',
                    borderBottom: '1px solid var(--color-border-light)',
                  }}
                >
                  <div
                    onClick={() => setSelectedSkillDetail(s)}
                    style={{ cursor: 'pointer', flex: 1 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text)' }}>
                        {s.name}
                      </span>
                      {s.basic && (
                        <span
                          style={{
                            fontSize: '0.65rem',
                            padding: '1px 4px',
                            borderRadius: '3px',
                            backgroundColor: 'rgba(46, 204, 113, 0.15)',
                            color: 'var(--color-ally)',
                          }}
                        >
                          基本
                        </span>
                      )}
                      {s.multiplier > 1 && (
                        <span
                          style={{
                            fontSize: '0.65rem',
                            padding: '1px 4px',
                            borderRadius: '3px',
                            backgroundColor: 'rgba(235, 87, 87, 0.15)',
                            color: 'var(--color-accent)',
                          }}
                        >
                          ×2
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                      {s.stat.toUpperCase()} {statVal} + Lv {lvl} = <strong>基本値 {baseVal}</strong>
                      <span style={{ color: 'var(--color-ally)', marginLeft: '6px' }}>解説</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      onClick={() => handleSkillChange(s.key, -1)}
                      disabled={lvl <= 0}
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '6px',
                        border: '1px solid var(--color-border-light)',
                        backgroundColor: 'var(--color-surface-elevated)',
                        color: 'var(--color-text)',
                        fontSize: '1.1rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      −
                    </button>

                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '1.1rem',
                        fontWeight: 700,
                        width: '24px',
                        textAlign: 'center',
                        color: lvl > 0 ? 'var(--color-ally)' : 'var(--color-text-muted)',
                      }}
                    >
                      {lvl}
                    </span>

                    <button
                      onClick={() => handleSkillChange(s.key, 1)}
                      disabled={lvl >= 10}
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '6px',
                        border: '1px solid var(--color-border-light)',
                        backgroundColor: 'var(--color-surface-elevated)',
                        color: 'var(--color-text)',
                        fontSize: '1.1rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      ＋
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => setStep(2)}
              style={{
                flex: 1,
                padding: '12px',
                borderRadius: '6px',
                border: '1px solid var(--color-border-light)',
                backgroundColor: 'transparent',
                color: 'var(--color-text-muted)',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
              }}
            >
              ← 能力値に戻る
            </button>
            <button
              onClick={() => setStep(4)}
              style={{
                flex: 2,
                padding: '12px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: 'var(--color-ally)',
                color: '#000',
                fontWeight: 700,
                fontSize: '1rem',
                cursor: 'pointer',
              }}
            >
              次へ: 装備を選ぶ →
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: 装備 */}
      {step === 4 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Funds & Humanity Sticky Banner */}
          <div
            style={{
              position: 'sticky',
              top: '8px',
              zIndex: 20,
              backgroundColor: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
          >
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                所持金 / 開始資金{fundsScenarioTitle ? `（「${fundsScenarioTitle}」）` : ''}
              </div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                {validationResults.funds.unconfigured ? (
                  <span style={{ color: 'var(--color-text)' }}>
                    使用額: {validationResults.funds.totalSpent.toLocaleString()} eb
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: '6px' }}>
                      (未設定)
                    </span>
                  </span>
                ) : (
                  <span
                    style={{
                      color:
                        validationResults.funds.remaining! < 0
                          ? 'var(--color-accent)'
                          : 'var(--color-ally)',
                    }}
                  >
                    残り: {validationResults.funds.remaining!.toLocaleString()} eb
                    {validationResults.funds.remaining! < 0 && ' (超過!)'}
                  </span>
                )}
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                人間性 · EMP
              </div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text)' }}>
                {validationResults.humanity.currentHumanity} / {validationResults.humanity.maxHumanity} · EMP {validationResults.humanity.currentEmp}
              </div>
            </div>
          </div>

          {/* Category Pills & Search */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              type="text"
              placeholder="アイテム名で検索…"
              value={equipSearch}
              onChange={(e) => setEquipSearch(e.target.value)}
              style={{
                padding: '8px 12px',
                fontSize: '0.85rem',
                borderRadius: '6px',
                border: '1px solid var(--color-border-light)',
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-text)',
              }}
            />

            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
              {[
                { id: 'all', label: 'すべて' },
                { id: 'weapon', label: '武器' },
                { id: 'armor', label: '防具' },
                { id: 'cyberware', label: 'サイバーウェア' },
                { id: 'gear', label: 'ギア' },
                { id: 'ammo', label: '弾薬' },
                { id: 'clothing', label: '衣服' },
              ].map((c) => (
                <button
                  key={c.id}
                  onClick={() => setEquipCategory(c.id)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '16px',
                    whiteSpace: 'nowrap',
                    border: equipCategory === c.id ? '1px solid var(--color-ally)' : '1px solid var(--color-border-light)',
                    backgroundColor: equipCategory === c.id ? 'var(--color-surface-elevated)' : 'transparent',
                    color: equipCategory === c.id ? 'var(--color-ally)' : 'var(--color-text-muted)',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Selected Cart Drawer */}
          {inventory.length > 0 && (
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
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text)' }}>
                選択したアイテム ({inventory.length} 種類)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {inventory.map((item) => (
                  <div
                    key={item.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      backgroundColor: 'var(--color-bg)',
                      border: '1px solid var(--color-border-light)',
                      borderRadius: '4px',
                      padding: '4px 8px',
                      fontSize: '0.8rem',
                    }}
                  >
                    <span>{item.name}</span>
                    <span style={{ color: 'var(--color-text-muted)' }}>×{item.qty}</span>
                    <button
                      onClick={() => handleRemoveEquipment(item.name)}
                      style={{
                        border: 'none',
                        background: 'none',
                        color: 'var(--color-accent)',
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: '0 2px',
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Items Catalog List */}
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              maxHeight: '480px',
              overflowY: 'auto',
            }}
          >
            {filteredItems.map((item) => {
              const displayName = item.name_ja || item.name_en;
              const inCart = inventory.find((i) => i.name === displayName);
              const qty = inCart ? inCart.qty : 0;

              return (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 4px',
                    borderBottom: '1px solid var(--color-border-light)',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text)' }}>
                        {displayName}
                      </span>
                      {item.price_eb !== null && item.price_eb !== undefined && (
                        <span style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--color-ally)' }}>
                          {item.price_eb.toLocaleString()} eb
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                      {item.kind === 'weapon' && (
                        <span>
                          {formatWeaponType(item.weapon_type)} · {item.damage || '—'} · ROF {item.rof ?? '—'}
                        </span>
                      )}
                      {item.kind === 'armor' && (
                        <span>
                          {item.is_shield ? `盾 HP ${item.shield_hp ?? '—'}` : `頭 SP ${item.sp_head ?? '—'} / 体 SP ${item.sp_body ?? '—'}`}
                        </span>
                      )}
                      {item.kind === 'cyberware' && (
                        <span style={{ color: 'var(--color-warning)' }}>
                          人間性 −{item.humanity_loss_static ?? (item.cyberware?.humanity_loss_static ?? 0)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {qty > 0 && (
                      <>
                        <button
                          onClick={() => handleRemoveEquipment(displayName)}
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '4px',
                            border: '1px solid var(--color-border-light)',
                            backgroundColor: 'var(--color-surface-elevated)',
                            color: 'var(--color-text)',
                            fontSize: '1rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          −
                        </button>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, width: '20px', textAlign: 'center' }}>
                          {qty}
                        </span>
                      </>
                    )}

                    <button
                      onClick={() => handleAddEquipment(item)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '4px',
                        border: '1px solid var(--color-border-light)',
                        backgroundColor: qty > 0 ? 'var(--color-ally)' : 'var(--color-surface-elevated)',
                        color: qty > 0 ? '#000' : 'var(--color-text)',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {qty > 0 ? '＋追加' : '選択'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => setStep(3)}
              style={{
                flex: 1,
                padding: '12px',
                borderRadius: '6px',
                border: '1px solid var(--color-border-light)',
                backgroundColor: 'transparent',
                color: 'var(--color-text-muted)',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
              }}
            >
              ← 技能に戻る
            </button>
            <button
              onClick={() => setStep(5)}
              style={{
                flex: 2,
                padding: '12px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: 'var(--color-ally)',
                color: '#000',
                fontWeight: 700,
                fontSize: '1rem',
                cursor: 'pointer',
              }}
            >
              次へ: 確認と送信 →
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: 送信 */}
      {step === 5 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Validation Checklist Card */}
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
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text)' }}>
              作成ルール検証チェック
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.85rem' }}>
              {/* Stats */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>能力値ポイント:</span>
                <span>
                  {validationResults.stats.unconfigured ? (
                    <span style={{ color: 'var(--color-text-muted)' }}>
                      合計 {validationResults.stats.total} pt (未設定のためチェックなし)
                    </span>
                  ) : validationResults.stats.remaining! >= 0 ? (
                    <span style={{ color: 'var(--color-ally)' }}>残り {validationResults.stats.remaining} pt</span>
                  ) : (
                    <span style={{ color: 'var(--color-accent)' }}>{Math.abs(validationResults.stats.remaining!)} pt 超過</span>
                  )}
                </span>
              </div>

              {/* Skills */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>技能ポイント:</span>
                <span>
                  {validationResults.skills.unconfigured ? (
                    <span style={{ color: 'var(--color-text-muted)' }}>
                      消費 {validationResults.skills.totalSpent} pt (未設定のためチェックなし)
                    </span>
                  ) : validationResults.skills.remaining! >= 0 ? (
                    <span style={{ color: 'var(--color-ally)' }}>残り {validationResults.skills.remaining} pt</span>
                  ) : (
                    <span style={{ color: 'var(--color-accent)' }}>{Math.abs(validationResults.skills.remaining!)} pt 超過</span>
                  )}
                </span>
              </div>

              {/* Funds */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>資金チェック:</span>
                <span>
                  {validationResults.funds.unconfigured ? (
                    <span style={{ color: 'var(--color-text-muted)' }}>
                      使用 {validationResults.funds.totalSpent.toLocaleString()} eb (未設定のためチェックなし)
                    </span>
                  ) : validationResults.funds.remaining! >= 0 ? (
                    <span style={{ color: 'var(--color-ally)' }}>残り {validationResults.funds.remaining!.toLocaleString()} eb</span>
                  ) : (
                    <span style={{ color: 'var(--color-accent)' }}>{Math.abs(validationResults.funds.remaining!).toLocaleString()} eb 超過</span>
                  )}
                </span>
              </div>

              {/* Humanity */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>人間性 / EMP:</span>
                <span>
                  {validationResults.humanity.currentHumanity} / {validationResults.humanity.maxHumanity} (現在 EMP {validationResults.humanity.currentEmp})
                </span>
              </div>
            </div>

            {validationResults.errors.length > 0 && (
              <div
                style={{
                  padding: '8px 10px',
                  backgroundColor: 'rgba(255, 90, 95, 0.15)',
                  border: '1px solid var(--color-accent)',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  color: 'var(--color-accent)',
                }}
              >
                {validationResults.errors.map((err, idx) => (
                  <div key={idx}>· {err}</div>
                ))}
              </div>
            )}
          </div>

          {/* Character Summary Preview */}
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
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              {imagePath ? (
                <img
                  src={imagePath}
                  alt={name}
                  style={{ width: '56px', height: '56px', borderRadius: '8px', objectFit: 'cover' }}
                />
              ) : (
                <div
                  style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--color-surface-elevated)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.75rem',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  No Image
                </div>
              )}

              <div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--color-text)' }}>
                  {name.trim() || '（名無しのエッジランナー）'}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                  {formatRole(role)}
                </div>
              </div>
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              所持品: {inventory.length} 種類 / サイバーウェア: {cyberware.length} 個
            </div>
          </div>

          {/* Submit & Export Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              style={{
                padding: '14px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: 'var(--color-ally)',
                color: '#000',
                fontWeight: 800,
                fontSize: '1.05rem',
                cursor: 'pointer',
              }}
            >
              {isSubmitting ? '送信中…' : 'GMに送る'}
            </button>

            <button
              onClick={handleExportCpgm}
              style={{
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid var(--color-border-light)',
                backgroundColor: 'var(--color-surface-elevated)',
                color: 'var(--color-text)',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              ファイルに保存 (.cpgm)
            </button>
          </div>
        </div>
      )}

      {/* Square Crop Modal */}
      {cropSrc && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '20px',
              maxWidth: '360px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--color-text)' }}>
              正方形に切り抜きます
            </h3>
            <div
              style={{
                width: '240px',
                height: '240px',
                borderRadius: '8px',
                overflow: 'hidden',
                border: '2px solid var(--color-ally)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img
                src={cropSrc}
                alt="Crop preview"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
              <button
                onClick={() => setCropSrc(null)}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid var(--color-border-light)',
                  backgroundColor: 'transparent',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                }}
              >
                キャンセル
              </button>
              <button
                onClick={() => performSquareCrop(cropSrc)}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: 'var(--color-ally)',
                  color: '#000',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                決定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Skill Detail Modal */}
      {selectedSkillDetail && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
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
              gap: '14px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-text)' }}>
                {selectedSkillDetail.name}（{selectedSkillDetail.stat.toUpperCase()}）
              </h3>
              <button
                onClick={() => setSelectedSkillDetail(null)}
                style={{
                  border: 'none',
                  background: 'none',
                  color: 'var(--color-text-muted)',
                  fontSize: '1.2rem',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            {/* When to use */}
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>使う場面:</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-text)', marginTop: '2px' }}>
                {skillNotes[selectedSkillDetail.key] || 'メモは未登録です'}
              </div>
            </div>

            {/* Formula & Needed roll */}
            {(() => {
              const statVal = (stats as any)[selectedSkillDetail.stat] ?? 6;
              const lvl = skills[selectedSkillDetail.key] ?? 0;
              const base = statVal + lvl;
              const needed = neededRoll(base, 13, 'dv');
              const neededStr = formatNeeded(needed);
              const prob = Math.round(successProbability(base, 13, 'dv') * 100);

              return (
                <div
                  style={{
                    backgroundColor: 'var(--color-bg)',
                    border: '1px solid var(--color-border-light)',
                    borderRadius: '6px',
                    padding: '10px',
                    fontSize: '0.8rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div>
                    <strong>判定式:</strong> {selectedSkillDetail.stat.toUpperCase()} {statVal} + {selectedSkillDetail.name} {lvl} = <strong>{base} + 1d10</strong>
                  </div>
                  <div>
                    <strong>成功の目安:</strong> 日常的（難易度 13）なら <strong>{neededStr}（{prob}%）</strong>
                  </div>
                </div>
              );
            })()}

            {/* Source */}
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              出典: 英語版 {selectedSkillDetail.sources?.[0]?.book || 'Cyberpunk RED'} p.{selectedSkillDetail.sources?.[0]?.page || '—'} / 日本語版 p.[ ]
            </div>

            <button
              onClick={() => setSelectedSkillDetail(null)}
              style={{
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid var(--color-border-light)',
                backgroundColor: 'var(--color-surface-elevated)',
                color: 'var(--color-text)',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
