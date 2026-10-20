import React, { useState, useEffect, useMemo } from 'react';
import {
  CharacterSheet,
  SKILL_CATALOG,
  SKILL_CATEGORIES,
  SkillCatalogEntry,
  formatSkillCategory,
} from '@cyberpgm/shared';
import {
  neededRoll,
  formatNeeded,
  successProbability,
  woundState,
  woundPenalty,
  skillBase,
} from '@cyberpgm/rules';
import { api } from '../api.js';

interface SkillsViewProps {
  characters: CharacterSheet[];
}

const DV_PRESETS = [
  { label: '日常的', dv: 13 },
  { label: '困難', dv: 15 },
  { label: '専門的', dv: 17 },
  { label: '英雄的', dv: 21 },
  { label: '非現実的', dv: 24 },
];

export const SkillsView: React.FC<SkillsViewProps> = ({ characters }) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedSkillKey, setSelectedSkillKey] = useState<string>('perception');
  const [targetDv, setTargetDv] = useState<number>(15);
  const [customDvInput, setCustomDvInput] = useState<string>('15');

  // Skill Notes from DB
  const [skillNotes, setSkillNotes] = useState<Record<string, string>>({});
  const [editingNoteKey, setEditingNoteKey] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState<string>('');
  const [isSavingNote, setIsSavingNote] = useState<boolean>(false);

  useEffect(() => {
    loadNotes();
  }, []);

  const loadNotes = async () => {
    try {
      const res = await api.getSkillNotes();
      setSkillNotes(res.notes || {});
    } catch (err) {
      console.error('Failed to load skill notes:', err);
    }
  };

  const handleStartEditNote = (key: string, currentText: string) => {
    setEditingNoteKey(key);
    setEditingNoteText(currentText);
  };

  const handleSaveNote = async () => {
    if (!editingNoteKey) return;
    setIsSavingNote(true);
    try {
      await api.updateSkillNote(editingNoteKey, editingNoteText);
      setSkillNotes((prev) => ({ ...prev, [editingNoteKey]: editingNoteText }));
      setEditingNoteKey(null);
    } catch (err) {
      console.error('Failed to update skill note:', err);
    } finally {
      setIsSavingNote(false);
    }
  };

  const allSkills = useMemo(() => {
    return Object.values(SKILL_CATALOG).sort((a, b) => a.key.localeCompare(b.key));
  }, []);

  const filteredSkills = useMemo(() => {
    return allSkills.filter((s) => {
      if (selectedCategory !== 'all' && s.category !== selectedCategory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const note = skillNotes[s.key]?.toLowerCase() || '';
        return s.name.toLowerCase().includes(q) || s.key.toLowerCase().includes(q) || note.includes(q);
      }
      return true;
    });
  }, [allSkills, selectedCategory, searchQuery, skillNotes]);

  const selectedSkill: SkillCatalogEntry =
    SKILL_CATALOG[selectedSkillKey] || SKILL_CATALOG['perception'] || allSkills[0];

  const handleDvChange = (dv: number) => {
    setTargetDv(dv);
    setCustomDvInput(String(dv));
  };

  const handleCustomDvChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomDvInput(e.target.value);
    const parsed = parseInt(e.target.value, 10);
    if (!isNaN(parsed) && parsed > 0) {
      setTargetDv(parsed);
    }
  };

  // PC calculations for the selected skill
  const pcResults = useMemo(() => {
    return characters.map((pc) => {
      const statVal = (pc.stats as any)?.[selectedSkill.stat] ?? 5;
      const skillLvl = pc.skills?.[selectedSkill.key] ?? 0;
      const currentHp = pc.hp;
      const maxHp = pc.hp_max;
      const wState = woundState(currentHp, maxHp);
      const wPenalty = woundPenalty(wState);

      const base = skillBase({
        stat: statVal,
        level: skillLvl,
        woundPenalty: wPenalty,
      });

      const needed = neededRoll(base, targetDv, 'dv');
      const neededText = formatNeeded(needed);
      const prob = Math.round(successProbability(base, targetDv, 'dv') * 100);

      return {
        pc,
        statVal,
        skillLvl,
        wState,
        wPenalty,
        base,
        neededText,
        prob,
      };
    });
  }, [characters, selectedSkill, targetDv]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '24px', alignItems: 'start' }}>
      {/* Left Pane: Skills Table */}
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>
            技能一覧
          </h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="技能名・用途で検索…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                padding: '6px 10px',
                fontSize: '0.85rem',
                backgroundColor: 'var(--color-bg)',
                border: '1px solid var(--color-border-light)',
                borderRadius: '4px',
                color: 'var(--color-text)',
                width: '180px',
              }}
            />
          </div>
        </div>

        {/* Category Filters */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setSelectedCategory('all')}
            style={{
              padding: '4px 10px',
              borderRadius: '16px',
              border: selectedCategory === 'all' ? '1px solid var(--color-ally)' : '1px solid var(--color-border-light)',
              backgroundColor: selectedCategory === 'all' ? 'var(--color-surface-elevated)' : 'transparent',
              color: selectedCategory === 'all' ? 'var(--color-ally)' : 'var(--color-text-muted)',
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
              onClick={() => setSelectedCategory(catKey)}
              style={{
                padding: '4px 10px',
                borderRadius: '16px',
                border: selectedCategory === catKey ? '1px solid var(--color-ally)' : '1px solid var(--color-border-light)',
                backgroundColor: selectedCategory === catKey ? 'var(--color-surface-elevated)' : 'transparent',
                color: selectedCategory === catKey ? 'var(--color-ally)' : 'var(--color-text-muted)',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {catLabel}
            </button>
          ))}
        </div>

        {/* Table of Skills */}
        <div style={{ overflowX: 'auto', maxHeight: '560px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)', textAlign: 'left' }}>
                <th style={{ padding: '8px' }}>技能</th>
                <th style={{ padding: '8px' }}>能力値</th>
                <th style={{ padding: '8px' }}>区分</th>
                <th style={{ padding: '8px' }}>何に使うか (GMメモ)</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>出典</th>
              </tr>
            </thead>
            <tbody>
              {filteredSkills.map((s) => {
                const isSelected = s.key === selectedSkill.key;
                const note = skillNotes[s.key] || '—';
                const sourceText = s.sources && s.sources[0] ? `p.${s.sources[0].page}` : '—';

                return (
                  <tr
                    key={s.key}
                    onClick={() => setSelectedSkillKey(s.key)}
                    style={{
                      borderBottom: '1px solid var(--color-border-light)',
                      backgroundColor: isSelected ? 'var(--color-surface-elevated)' : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <td style={{ padding: '8px', fontWeight: 600, color: isSelected ? 'var(--color-ally)' : 'var(--color-text)' }}>
                      {s.name}
                      <span style={{ display: 'inline-flex', gap: '4px', marginLeft: '6px' }}>
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
                      </span>
                    </td>
                    <td style={{ padding: '8px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                      {s.stat}
                    </td>
                    <td style={{ padding: '8px', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                      {formatSkillCategory(s.category)}
                    </td>
                    <td style={{ padding: '8px', color: 'var(--color-text)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                        <span style={{ fontSize: '0.8rem', flex: 1 }}>{note}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartEditNote(s.key, skillNotes[s.key] || '');
                          }}
                          style={{
                            border: 'none',
                            background: 'none',
                            color: 'var(--color-text-muted)',
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                            padding: '2px 4px',
                          }}
                          title="メモを編集"
                        >
                          ✎
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                      {sourceText}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footnote note */}
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: '4px 0 0 0', lineHeight: 1.4 }}>
          注: 基本 = 全キャラが最低レベルから持つ技能（要確認）。×2 = 上げるコストが 2 倍。技能名・能力値・区分・出典は FVTT のデータ。何に使うかは GM のメモ（ルールブックの文章は写さない）
        </p>
      </div>

      {/* Right Pane: Selected Skill & Success Probability */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Selected Skill Header & Formula */}
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>
              {selectedSkill.name}（{selectedSkill.stat.toUpperCase()}）
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              {formatSkillCategory(selectedSkill.category)}
            </span>
          </div>

          <p style={{ fontSize: '0.85rem', color: 'var(--color-text)', margin: 0 }}>
            {skillNotes[selectedSkill.key] || 'メモは未登録です'}
          </p>

          <div
            style={{
              backgroundColor: 'var(--color-bg)',
              border: '1px solid var(--color-border-light)',
              borderRadius: '6px',
              padding: '10px 12px',
              fontSize: '0.8rem',
              color: 'var(--color-text-muted)',
              lineHeight: 1.5,
            }}
          >
            <div>
              <strong style={{ color: 'var(--color-text)' }}>判定計算式:</strong> {selectedSkill.stat.toUpperCase()} + {selectedSkill.name} + 1d10 − 負傷修正 vs 難易度(DV)
            </div>
            <div style={{ fontSize: '0.75rem', marginTop: '4px' }}>
              ※ 難易度を超えれば成功（同値は失敗）。出目10はクリティカル追加ロール、出目1はファンブル追加ロールを反映。
            </div>
          </div>
        </div>

        {/* DV Selection */}
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text)' }}>
              難易度目安（DV値）
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>直接入力:</span>
              <input
                type="number"
                value={customDvInput}
                onChange={handleCustomDvChange}
                style={{
                  width: '56px',
                  padding: '4px 6px',
                  fontSize: '0.9rem',
                  fontFamily: 'var(--font-mono)',
                  textAlign: 'center',
                  backgroundColor: 'var(--color-bg)',
                  border: '1px solid var(--color-border-light)',
                  borderRadius: '4px',
                  color: 'var(--color-text)',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
            {DV_PRESETS.map((preset) => (
              <button
                key={preset.dv}
                onClick={() => handleDvChange(preset.dv)}
                style={{
                  padding: '8px 4px',
                  borderRadius: '6px',
                  border: targetDv === preset.dv ? '2px solid var(--color-ally)' : '1px solid var(--color-border-light)',
                  backgroundColor: targetDv === preset.dv ? 'var(--color-surface-elevated)' : 'transparent',
                  color: targetDv === preset.dv ? 'var(--color-ally)' : 'var(--color-text)',
                  fontSize: '0.75rem',
                  fontWeight: targetDv === preset.dv ? 700 : 500,
                  cursor: 'pointer',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}
              >
                <span>{preset.label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', fontWeight: 700 }}>
                  {preset.dv}
                </span>
              </button>
            ))}
          </div>

          <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', margin: 0 }}>
            ※ イージー・モード p.15 の目安値（日常的 13 / 困難 15 / 専門的 17 / 英雄的 21 / 非現実的 24）
          </p>
        </div>

        {/* PC Success Rates List */}
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>
              各PCの成功率（難易度 {targetDv}）
            </h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              {characters.length} 名
            </span>
          </div>

          {characters.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '8px 0' }}>
              PCが登録されていません。PC管理タブまたはキャラ受付で追加してください。
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {pcResults.map((res) => {
                const pc = res.pc;
                // Bar color: >=70% green, >=40% yellow, <40% red
                const barColor =
                  res.prob >= 70
                    ? 'var(--color-ally)'
                    : res.prob >= 40
                    ? 'var(--color-warning)'
                    : 'var(--color-accent)';

                const isWounded = res.wState === 'seriously' || res.wState === 'mortally';

                return (
                  <div
                    key={pc.id}
                    style={{
                      backgroundColor: 'var(--color-bg)',
                      border: '1px solid var(--color-border-light)',
                      borderRadius: '6px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-text)' }}>
                          {pc.name}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                          ({pc.role})
                        </span>
                        {isWounded && (
                          <span
                            style={{
                              fontSize: '0.7rem',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(255, 90, 95, 0.2)',
                              color: 'var(--color-accent)',
                              fontWeight: 700,
                            }}
                          >
                            {res.wState === 'seriously' ? '重傷 −2' : '瀕死 −4'}
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 800,
                            fontSize: '1.05rem',
                            color: barColor,
                          }}
                        >
                          {res.prob}%
                        </span>
                      </div>
                    </div>

                    {/* Formula Breakdown & Needed Roll */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>
                        {selectedSkill.stat.toUpperCase()} {res.statVal} + {selectedSkill.name} {res.skillLvl}
                        {res.wPenalty !== 0 && ` ${res.wPenalty}`} = <strong>{res.base}</strong> vs DV {targetDv}
                      </span>
                      <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>
                        {res.neededText}
                      </span>
                    </div>

                    {/* Progress Bar */}
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
                        style={{
                          width: `${res.prob}%`,
                          height: '100%',
                          backgroundColor: barColor,
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Note Edit Modal */}
      {editingNoteKey && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '24px',
              width: '90%',
              maxWidth: '480px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-text)' }}>
              技能「{SKILL_CATALOG[editingNoteKey]?.name || editingNoteKey}」のメモを編集
            </h3>
            <textarea
              value={editingNoteText}
              onChange={(e) => setEditingNoteText(e.target.value)}
              rows={4}
              placeholder="何に使うか（GMのメモ）を入力…"
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid var(--color-border-light)',
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
                fontSize: '0.85rem',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={() => setEditingNoteKey(null)}
                style={{
                  padding: '8px 14px',
                  borderRadius: '4px',
                  border: '1px solid var(--color-border-light)',
                  backgroundColor: 'transparent',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                キャンセル
              </button>
              <button
                onClick={handleSaveNote}
                disabled={isSavingNote}
                style={{
                  padding: '8px 16px',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: 'var(--color-ally)',
                  color: '#000',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                {isSavingNote ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
