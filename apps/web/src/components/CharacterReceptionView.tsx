import React, { useState, useEffect, useRef } from 'react';
import {
  CharacterSubmission,
  CreationMethodConfig,
  formatRole,
  getSkillDef,
} from '@cyberpgm/shared';
import { api } from '../api.js';

interface CharacterReceptionViewProps {
  onRefreshCharacters?: () => void;
  onOpenQr?: () => void;
  startingFunds: string;
  onSaveStartingFunds: (funds: string) => Promise<void>;
}

export const CharacterReceptionView: React.FC<CharacterReceptionViewProps> = ({
  onRefreshCharacters,
  onOpenQr,
  startingFunds,
  onSaveStartingFunds,
}) => {
  const [submissions, setSubmissions] = useState<CharacterSubmission[]>([]);
  const [creationMethods, setCreationMethods] = useState<CreationMethodConfig[]>([]);
  const [activeMethodKey, setActiveMethodKey] = useState<string>('complete_package');
  const [localStartingFunds, setLocalStartingFunds] = useState<string>(startingFunds);
  const [isSavingFunds, setIsSavingFunds] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'accepted' | 'rejected'>('all');

  // Modal states
  const [viewingSub, setViewingSub] = useState<CharacterSubmission | null>(null);
  const [rejectingSub, setRejectingSub] = useState<CharacterSubmission | null>(null);
  const [rejectComment, setRejectComment] = useState<string>('');
  const [actionInProgress, setActionInProgress] = useState<boolean>(false);

  // File import ref
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    setLocalStartingFunds(startingFunds);
  }, [startingFunds]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [methodsRes, subsRes] = await Promise.all([
        api.getCreationMethods(),
        api.getCharacterSubmissions(),
      ]);
      setCreationMethods(methodsRes.methods || []);
      setActiveMethodKey(methodsRes.active_method || 'complete_package');
      setSubmissions(subsRes.submissions || []);
    } catch (err) {
      console.error('Failed to load reception data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleActiveMethodChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newKey = e.target.value;
    setActiveMethodKey(newKey);
    try {
      await api.setActiveCreationMethod(newKey);
    } catch (err) {
      console.error('Failed to set active creation method:', err);
    }
  };

  const handleSaveFunds = async () => {
    setIsSavingFunds(true);
    try {
      await onSaveStartingFunds(localStartingFunds);
    } catch (err) {
      console.error('Failed to save starting funds:', err);
    } finally {
      setIsSavingFunds(false);
    }
  };

  const handleAccept = async (sub: CharacterSubmission) => {
    if (actionInProgress) return;
    setActionInProgress(true);
    try {
      await api.acceptCharacterSubmission(sub.id);
      await loadData();
      onRefreshCharacters?.();
      if (viewingSub?.id === sub.id) {
        setViewingSub(null);
      }
    } catch (err: any) {
      alert(err.message || 'キャラクターの取り込みに失敗しました');
    } finally {
      setActionInProgress(false);
    }
  };

  const handleOpenReject = (sub: CharacterSubmission) => {
    setRejectingSub(sub);
    setRejectComment('');
  };

  const handleConfirmReject = async () => {
    if (!rejectingSub || actionInProgress) return;
    setActionInProgress(true);
    try {
      await api.rejectCharacterSubmission(rejectingSub.id, rejectComment);
      await loadData();
      setRejectingSub(null);
      if (viewingSub?.id === rejectingSub.id) {
        setViewingSub(null);
      }
    } catch (err: any) {
      alert(err.message || '差し戻しに失敗しました');
    } finally {
      setActionInProgress(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);

    try {
      const text = await file.text();
      const json = JSON.parse(text);
      await api.importCharacterSubmission(json);
      await loadData();
      alert(`「${json.character?.name || 'キャラクター'}」の .cpgm ファイルを取り込みました`);
    } catch (err: any) {
      console.error('Failed to import .cpgm file:', err);
      setImportError(err.message || '無効な .cpgm ファイルです');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const filteredSubs = submissions.filter((s) => {
    if (statusFilter === 'all') return true;
    return s.status === statusFilter;
  });

  const pendingCount = submissions.filter((s) => s.status === 'pending').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* 1. 招待 (Invitation & Rules settings) */}
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
          <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>
            プレイヤー招待 & 作成受付設定
          </h2>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {onOpenQr && (
              <button
                onClick={onOpenQr}
                style={{
                  backgroundColor: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-ally)',
                  color: 'var(--color-ally)',
                  padding: '8px 14px',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>自宅 Wi-Fi 用の QR を表示</span>
              </button>
            )}

            <input
              type="file"
              ref={fileInputRef}
              accept=".cpgm,.json"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                backgroundColor: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border-light)',
                color: 'var(--color-text)',
                padding: '8px 14px',
                borderRadius: '6px',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ファイルから取り込む (.cpgm)
            </button>
          </div>
        </div>

        {importError && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              backgroundColor: 'rgba(255, 90, 95, 0.15)',
              border: '1px solid var(--color-accent)',
              color: 'var(--color-accent)',
              fontSize: '0.85rem',
            }}
          >
            {importError}
          </div>
        )}

        {/* Settings Bar: Creation Method & Starting Funds */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '16px',
            backgroundColor: 'var(--color-bg)',
            border: '1px solid var(--color-border-light)',
            borderRadius: '6px',
            padding: '14px',
          }}
        >
          {/* Creation Method select */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              作成方法（プレイヤー作成時に適用）
            </label>
            <select
              value={activeMethodKey}
              onChange={handleActiveMethodChange}
              style={{
                padding: '6px 10px',
                borderRadius: '4px',
                border: '1px solid var(--color-border-light)',
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-text)',
                fontSize: '0.85rem',
              }}
            >
              {creationMethods.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
            <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
              ※ 未設定の項目（null）は制限チェックを行いません
            </span>
          </div>

          {/* Starting Funds */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              開始資金（空欄なら資金チェックなし）
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="number"
                value={localStartingFunds}
                onChange={(e) => setLocalStartingFunds(e.target.value)}
                placeholder="未設定"
                style={{
                  width: '120px',
                  padding: '6px 8px',
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border-light)',
                  borderRadius: '4px',
                  color: 'var(--color-text)',
                  fontSize: '0.85rem',
                  textAlign: 'center',
                }}
              />
              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>eb</span>
              <button
                onClick={handleSaveFunds}
                disabled={isSavingFunds}
                style={{
                  padding: '6px 12px',
                  backgroundColor: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-border-light)',
                  color: 'var(--color-text)',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                {isSavingFunds ? '保存中…' : '資金保存'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 2. 届いたキャラの一覧 (Submissions List) */}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>
              届いたキャラクター一覧
            </h2>
            {pendingCount > 0 && (
              <span
                style={{
                  backgroundColor: 'var(--color-warning)',
                  color: '#000',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: '12px',
                }}
              >
                未処理 {pendingCount} 件
              </span>
            )}
          </div>

          {/* Filter Pills */}
          <div style={{ display: 'flex', gap: '6px' }}>
            {[
              { id: 'all', label: 'すべて' },
              { id: 'pending', label: '未処理' },
              { id: 'accepted', label: '取り込み済み' },
              { id: 'rejected', label: '差し戻し' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id as any)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '16px',
                  border: statusFilter === f.id ? '1px solid var(--color-ally)' : '1px solid var(--color-border-light)',
                  backgroundColor: statusFilter === f.id ? 'var(--color-surface-elevated)' : 'transparent',
                  color: statusFilter === f.id ? 'var(--color-ally)' : 'var(--color-text-muted)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>読み込み中…</p>
        ) : filteredSubs.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
            該当するキャラクター申請はありません
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
            {filteredSubs.map((sub) => {
              const validation = sub.validation_results;
              const hasErrors = validation && !validation.valid;
              const errorCount = validation?.errors?.length ?? 0;
              const formattedDate = new Date(sub.created_at).toLocaleString('ja-JP', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div
                  key={sub.id}
                  style={{
                    backgroundColor: 'var(--color-bg)',
                    border: '1px solid var(--color-border-light)',
                    borderRadius: '8px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  {/* Top Bar: Avatar, Info, Badges */}
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    {sub.image_path ? (
                      <img
                        src={sub.image_path}
                        alt={sub.name}
                        style={{
                          width: '54px',
                          height: '54px',
                          borderRadius: '6px',
                          objectFit: 'cover',
                          border: '1px solid var(--color-border)',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '54px',
                          height: '54px',
                          borderRadius: '6px',
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

                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-text)' }}>
                          {sub.name}
                        </span>
                        {/* Status Badge */}
                        <span
                          style={{
                            fontSize: '0.7rem',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontWeight: 700,
                            backgroundColor:
                              sub.status === 'accepted'
                                ? 'rgba(46, 204, 113, 0.2)'
                                : sub.status === 'rejected'
                                ? 'rgba(255, 255, 255, 0.1)'
                                : 'rgba(242, 201, 76, 0.2)',
                            color:
                              sub.status === 'accepted'
                                ? 'var(--color-ally)'
                                : sub.status === 'rejected'
                                ? 'var(--color-text-muted)'
                                : 'var(--color-warning)',
                          }}
                        >
                          {sub.status === 'accepted'
                            ? '取り込み済み'
                            : sub.status === 'rejected'
                            ? '差し戻し'
                            : '受付中'}
                        </span>
                      </div>

                      <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                        {formatRole(sub.role)} · {formattedDate}
                      </span>

                      {/* Source & Check Pill */}
                      <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: '0.7rem',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--color-surface-elevated)',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          {sub.source === 'wifi' ? 'Wi-Fi' : 'ファイル'}
                        </span>

                        {hasErrors ? (
                          <span
                            style={{
                              fontSize: '0.7rem',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(255, 90, 95, 0.2)',
                              color: 'var(--color-accent)',
                              fontWeight: 600,
                            }}
                          >
                            超過・警告 ({errorCount})
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: '0.7rem',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(46, 204, 113, 0.15)',
                              color: 'var(--color-ally)',
                              fontWeight: 600,
                            }}
                          >
                            チェックOK
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* If rejected, show comment */}
                  {sub.status === 'rejected' && sub.rejection_comment && (
                    <div
                      style={{
                        padding: '6px 10px',
                        borderRadius: '4px',
                        backgroundColor: 'rgba(255, 90, 95, 0.1)',
                        border: '1px solid rgba(255, 90, 95, 0.3)',
                        fontSize: '0.75rem',
                        color: 'var(--color-accent)',
                      }}
                    >
                      <strong>差し戻し理由:</strong> {sub.rejection_comment}
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                    <button
                      onClick={() => setViewingSub(sub)}
                      style={{
                        flex: 1,
                        padding: '6px 10px',
                        borderRadius: '4px',
                        backgroundColor: 'var(--color-surface-elevated)',
                        border: '1px solid var(--color-border-light)',
                        color: 'var(--color-text)',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      中身を見る
                    </button>

                    {sub.status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleAccept(sub)}
                          disabled={actionInProgress}
                          style={{
                            flex: 1,
                            padding: '6px 10px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--color-ally)',
                            border: 'none',
                            color: '#000',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          取り込む
                        </button>

                        {sub.source === 'wifi' && (
                          <button
                            onClick={() => handleOpenReject(sub)}
                            disabled={actionInProgress}
                            style={{
                              padding: '6px 10px',
                              borderRadius: '4px',
                              backgroundColor: 'transparent',
                              border: '1px solid var(--color-accent)',
                              color: 'var(--color-accent)',
                              fontSize: '0.8rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            差し戻す
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Details Modal */}
      {viewingSub && (
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
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '24px',
              width: '100%',
              maxWidth: '640px',
              maxHeight: '85vh',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                {viewingSub.image_path ? (
                  <img
                    src={viewingSub.image_path}
                    alt={viewingSub.name}
                    style={{ width: '48px', height: '48px', borderRadius: '6px', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '6px',
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
                  <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--color-text)' }}>
                    {viewingSub.name}
                  </h3>
                  <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                    {formatRole(viewingSub.role)} · {viewingSub.source === 'wifi' ? 'Wi-Fi 経由' : 'ファイル取込'}
                  </span>
                </div>
              </div>

              <button
                onClick={() => setViewingSub(null)}
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

            {/* Validation Checklist */}
            <div
              style={{
                backgroundColor: 'var(--color-bg)',
                border: '1px solid var(--color-border-light)',
                borderRadius: '6px',
                padding: '12px',
                fontSize: '0.8rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--color-text)' }}>ルール検証結果:</div>
              {viewingSub.validation_results?.errors?.length ? (
                viewingSub.validation_results.errors.map((err, idx) => (
                  <div key={idx} style={{ color: 'var(--color-accent)' }}>
                    ・ {err}
                  </div>
                ))
              ) : (
                <div style={{ color: 'var(--color-ally)' }}>すべてのルール条件を満たしています</div>
              )}
            </div>

            {/* Stats Grid */}
            <div>
              <h4 style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0 0 8px 0' }}>
                能力値（合計: {viewingSub.validation_results?.stats?.total}）
              </h4>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: '8px',
                  textAlign: 'center',
                }}
              >
                {Object.entries(viewingSub.character_data.stats || {}).map(([st, val]) => (
                  <div
                    key={st}
                    style={{
                      backgroundColor: 'var(--color-bg)',
                      border: '1px solid var(--color-border-light)',
                      borderRadius: '4px',
                      padding: '6px 4px',
                    }}
                  >
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                      {st}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1rem' }}>
                      {val}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Humanity & EMP */}
            <div
              style={{
                display: 'flex',
                gap: '16px',
                padding: '10px 12px',
                backgroundColor: 'var(--color-bg)',
                borderRadius: '6px',
                fontSize: '0.85rem',
              }}
            >
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>人間性: </span>
                <strong>{viewingSub.validation_results?.humanity?.currentHumanity}</strong>
                <span style={{ color: 'var(--color-text-muted)' }}>
                  {' '}/ 最大 {viewingSub.validation_results?.humanity?.maxHumanity}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>EMP: </span>
                <strong>{viewingSub.validation_results?.humanity?.currentEmp}</strong>
              </div>
            </div>

            {/* Skills */}
            <div>
              <h4 style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0 0 8px 0' }}>
                習得技能
              </h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {Object.entries(viewingSub.character_data.skills || {})
                  .filter(([_, lvl]) => lvl > 0)
                  .map(([k, lvl]) => {
                    const def = getSkillDef(k);
                    return (
                      <span
                        key={k}
                        style={{
                          backgroundColor: 'var(--color-bg)',
                          border: '1px solid var(--color-border-light)',
                          borderRadius: '4px',
                          padding: '3px 8px',
                          fontSize: '0.8rem',
                        }}
                      >
                        {def?.name || k}: <strong>{lvl}</strong>
                        {def?.multiplier && def.multiplier > 1 && (
                          <span style={{ color: 'var(--color-accent)', marginLeft: '4px', fontSize: '0.7rem' }}>
                            (×2)
                          </span>
                        )}
                      </span>
                    );
                  })}
              </div>
            </div>

            {/* Equipment & Cyberware */}
            <div>
              <h4 style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0 0 8px 0' }}>
                装備・所持品 ({viewingSub.character_data.inventory?.length || 0})
              </h4>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-text)' }}>
                {viewingSub.character_data.inventory?.map((item, idx) => (
                  <div key={idx} style={{ padding: '2px 0' }}>
                    · {item.name} {item.qty > 1 && `× ${item.qty}`} ({item.price_eb ?? 0} eb)
                  </div>
                ))}
              </div>
            </div>

            {viewingSub.character_data.cyberware?.length > 0 && (
              <div>
                <h4 style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0 0 8px 0' }}>
                  サイバーウェア ({viewingSub.character_data.cyberware.length})
                </h4>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text)' }}>
                  {viewingSub.character_data.cyberware.map((cw, idx) => (
                    <div key={idx} style={{ padding: '2px 0' }}>
                      · {cw.name} (人間性 −{cw.static_loss ?? 0})
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
              <button
                onClick={() => setViewingSub(null)}
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
                閉じる
              </button>

              {viewingSub.status === 'pending' && (
                <>
                  {viewingSub.source === 'wifi' && (
                    <button
                      onClick={() => handleOpenReject(viewingSub)}
                      style={{
                        padding: '8px 14px',
                        borderRadius: '4px',
                        border: '1px solid var(--color-accent)',
                        backgroundColor: 'transparent',
                        color: 'var(--color-accent)',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                      }}
                    >
                      差し戻す
                    </button>
                  )}

                  <button
                    onClick={() => handleAccept(viewingSub)}
                    disabled={actionInProgress}
                    style={{
                      padding: '8px 18px',
                      borderRadius: '4px',
                      border: 'none',
                      backgroundColor: 'var(--color-ally)',
                      color: '#000',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                    }}
                  >
                    PCとして取り込む
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectingSub && (
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
            zIndex: 1100,
            padding: '20px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '24px',
              width: '100%',
              maxWidth: '460px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-text)' }}>
              「{rejectingSub.name}」を差し戻す
            </h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              プレイヤーのスマホの作成画面にコメントが表示され、修正して再送できるようになります。
            </p>
            <textarea
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              rows={4}
              placeholder="差し戻しの理由や修正してほしい箇所を入力（例: 能力値が上限を超えています）…"
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
                onClick={() => setRejectingSub(null)}
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
                onClick={handleConfirmReject}
                disabled={actionInProgress}
                style={{
                  padding: '8px 16px',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: 'var(--color-accent)',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                差し戻しを送信
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
