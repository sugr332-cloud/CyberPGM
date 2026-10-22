import React, { useEffect, useState } from 'react';
import {
  BLACK_ICE_CATALOG,
  DEMON_CATALOG,
  NET_DIFFICULTIES,
  NET_SECURITIES,
  NetArchitecture,
  NetDifficultyKey,
  NetFloor,
} from '@cyberpgm/shared';
import { api } from '../api.js';

const panelStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: '6px',
  padding: '12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
};

const fieldStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-bg)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: '4px',
  padding: '4px 8px',
  fontSize: '0.82rem',
};

const btnStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-surface-elevated)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: '4px',
  padding: '5px 10px',
  fontSize: '0.8rem',
  cursor: 'pointer',
};

export const NetrunGmPanel: React.FC = () => {
  const [architectures, setArchitectures] = useState<Array<NetArchitecture & { price_info?: any }>>([]);
  const [selectedArchId, setSelectedArchId] = useState<string | null>(null);
  const [newName, setNewName] = useState('企業サブネット');
  const [newDiff, setNewDiff] = useState<NetDifficultyKey>('standard');
  const [editName, setEditName] = useState('');
  const [editDiff, setEditDiff] = useState<NetDifficultyKey>('standard');
  const [editFloors, setEditFloors] = useState<NetFloor[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [activeCombatId, setActiveCombatId] = useState<string | null>(null);

  const loadList = async (selectId?: string) => {
    try {
      const res = await api.listNetArchitectures();
      setArchitectures(res.architectures || []);
      const targetId = selectId ?? selectedArchId ?? res.architectures?.[0]?.id ?? null;
      if (targetId) {
        const found = (res.architectures || []).find((a: any) => a.id === targetId);
        if (found) {
          setSelectedArchId(found.id);
          setEditName(found.name);
          setEditDiff(found.difficulty);
          setEditFloors(found.floors || []);
        }
      }
    } catch (e: any) {
      setErr(e.message || 'NET構造体の取得に失敗しました');
    }
  };

  useEffect(() => {
    loadList();
    api
      .getCurrentCombat()
      .then((res) => setActiveCombatId(res.combat?.id ?? null))
      .catch(() => undefined);
  }, []);

  const selectArch = (arch: NetArchitecture) => {
    setSelectedArchId(arch.id);
    setEditName(arch.name);
    setEditDiff(arch.difficulty);
    setEditFloors(arch.floors || []);
    setMsg(null);
    setErr(null);
  };

  const handleAutoCreate = async () => {
    setErr(null);
    setMsg(null);
    try {
      const res = await api.createNetArchitecture({
        name: newName.trim() || '自動生成NET構造体',
        difficulty: newDiff,
        auto_generate: true,
      });
      setMsg(`「${res.architecture.name}」（${res.architecture.floors.length} 階層）を自動作成しました`);
      await loadList(res.architecture.id);
    } catch (e: any) {
      setErr(e.message || '自動作成に失敗しました');
    }
  };

  const handleManualCreate = async () => {
    setErr(null);
    setMsg(null);
    try {
      const dv = NET_DIFFICULTIES[newDiff].dv;
      const res = await api.createNetArchitecture({
        name: newName.trim() || '新規NET構造体',
        difficulty: newDiff,
        floors: [
          { floor: 1, depth: 1, branch: 'main', parent_floor: null, kind: 'file', dv, raw: `file:${dv}`, note: '業務ログ' },
          { floor: 2, depth: 2, branch: 'main', parent_floor: 1, kind: 'password', dv, raw: `password:${dv}` },
          { floor: 3, depth: 3, branch: 'main', parent_floor: 2, kind: 'ice', raw: 'ice:Wisp', ice: ['Wisp'] },
        ],
      });
      setMsg(`「${res.architecture.name}」を作成しました`);
      await loadList(res.architecture.id);
    } catch (e: any) {
      setErr(e.message || '作成に失敗しました');
    }
  };

  const handleSaveArch = async () => {
    if (!selectedArchId) return;
    setErr(null);
    setMsg(null);
    try {
      const normalized = editFloors.map((f, idx) => {
        const floorNum = idx + 1;
        const dv = f.dv ?? NET_DIFFICULTIES[editDiff].dv;
        const raw =
          f.kind === 'password'
            ? `password:${dv}`
            : f.kind === 'file'
              ? `file:${dv}`
              : f.kind === 'control'
                ? `control:${dv}`
                : f.kind === 'demon'
                  ? `demon:${f.demon || 'Imp'}`
                  : f.kind === 'ice'
                    ? `ice:${(f.ice && f.ice.length ? f.ice : ['Wisp']).join(',')}`
                    : 'empty';
        return {
          ...f,
          floor: floorNum,
          depth: f.depth || floorNum,
          branch: f.branch || 'main',
          raw,
        };
      });
      const res = await api.updateNetArchitecture(selectedArchId, {
        name: editName,
        difficulty: editDiff,
        floors: normalized,
      });
      setEditFloors(res.architecture.floors);
      setMsg('NET構造体を保存しました');
      await loadList(selectedArchId);
    } catch (e: any) {
      setErr(e.message || '保存に失敗しました');
    }
  };

  const handleDeleteArch = async (id: string) => {
    setErr(null);
    setMsg(null);
    try {
      await api.deleteNetArchitecture(id);
      if (selectedArchId === id) {
        setSelectedArchId(null);
        setEditFloors([]);
      }
      await loadList();
      setMsg('NET構造体を削除しました');
    } catch (e: any) {
      setErr(e.message || '削除に失敗しました');
    }
  };

  const updateFloor = (idx: number, patch: Partial<NetFloor>) => {
    setEditFloors((prev) =>
      prev.map((f, i) => {
        if (i !== idx) return f;
        return { ...f, ...patch };
      }),
    );
  };

  const moveFloor = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= editFloors.length) return;
    const copy = [...editFloors];
    const [item] = copy.splice(idx, 1);
    copy.splice(target, 0, item);
    setEditFloors(copy.map((f, i) => ({ ...f, floor: i + 1 })));
  };

  const handleJoinCombat = async (kind: 'ice' | 'demon' | 'security', key: string, label: string) => {
    if (!activeCombatId) {
      setErr('現在進行中の戦闘がありません');
      return;
    }
    setErr(null);
    setMsg(null);
    try {
      await api.joinCombatNetEntity(activeCombatId, {
        kind,
        key,
        side: 'enemy',
        arch_id: selectedArchId ?? undefined,
      });
      setMsg(`「${label}」を現在の戦闘（行動順の先頭）に追加しました`);
    } catch (e: any) {
      setErr(e.message || '戦闘への追加に失敗しました');
    }
  };

  const currentArch = architectures.find((a) => a.id === selectedArchId);

  return (
    <div data-testid="netrun-gm-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '12px' }}>
      {/* 新規作成・自動作成バー */}
      <div style={panelStyle}>
        <div style={{ fontWeight: 700, color: 'var(--color-primary)', fontSize: '0.95rem' }}>
          NET構造体（NET アーキテクチャ）の作成・管理
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            aria-label="NET構造体の名前"
            placeholder="NET構造体の名前"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ ...fieldStyle, minWidth: '180px' }}
          />
          <select
            aria-label="NET構造体の難易度"
            value={newDiff}
            onChange={(e) => setNewDiff(e.target.value as NetDifficultyKey)}
            style={fieldStyle}
          >
            {Object.entries(NET_DIFFICULTIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.name}（基本DV {v.dv} / 1階層 {v.floorCostEb.toLocaleString()}eb）
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="netrun-auto-create-btn"
            onClick={handleAutoCreate}
            style={{ ...btnStyle, backgroundColor: 'var(--color-primary)', color: '#000', fontWeight: 700 }}
          >
            自動で作る（3d6階層）
          </button>
          <button
            type="button"
            data-testid="netrun-manual-create-btn"
            onClick={handleManualCreate}
            style={btnStyle}
          >
            + 空の構造体を作る
          </button>
        </div>
        {err && <div style={{ color: 'var(--color-danger)', fontSize: '0.82rem' }}>{err}</div>}
        {msg && <div style={{ color: 'var(--color-ally)', fontSize: '0.82rem' }}>{msg}</div>}
      </div>

      {/* 一覧と詳細エディタ */}
      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* 左: NET構造体一覧 */}
        <div style={{ ...panelStyle, width: '260px', flexShrink: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>保存済みの NET構造体 ({architectures.length})</div>
          {architectures.length === 0 && (
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>まだ作成されていません</div>
          )}
          {architectures.map((a) => (
            <div
              key={a.id}
              data-testid={`net-arch-item-${a.id}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 8px',
                borderRadius: '4px',
                border: `1px solid ${selectedArchId === a.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                backgroundColor: selectedArchId === a.id ? 'var(--color-surface-elevated)' : 'var(--color-bg)',
                cursor: 'pointer',
              }}
              onClick={() => selectArch(a)}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                <span style={{ fontWeight: 700, fontSize: '0.82rem' }}>{a.name}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                  {NET_DIFFICULTIES[a.difficulty]?.name ?? a.difficulty} (DV{a.dv}) · {a.floors?.length ?? 0}階層
                </span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteArch(a.id);
                }}
                style={{ border: 'none', background: 'none', color: 'var(--color-danger)', cursor: 'pointer' }}
              >
                削除
              </button>
            </div>
          ))}
        </div>

        {/* 右: 選択中の NET構造体エディタ */}
        <div style={{ ...panelStyle, flex: 1, minWidth: '320px' }}>
          {!selectedArchId ? (
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
              左の一覧から NET構造体を選ぶか、「自動で作る」を押してください
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    aria-label="編集中のNET構造体名"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    style={{ ...fieldStyle, fontWeight: 700 }}
                  />
                  <select
                    aria-label="編集中の難易度"
                    value={editDiff}
                    onChange={(e) => setEditDiff(e.target.value as NetDifficultyKey)}
                    style={fieldStyle}
                  >
                    {Object.entries(NET_DIFFICULTIES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.name} (DV{v.dv})
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() =>
                      setEditFloors((prev) => [
                        ...prev,
                        {
                          floor: prev.length + 1,
                          depth: prev.length + 1,
                          branch: 'main',
                          parent_floor: prev.length || null,
                          raw: `file:${NET_DIFFICULTIES[editDiff].dv}`,
                          kind: 'file',
                          dv: NET_DIFFICULTIES[editDiff].dv,
                          label: `ファイル (DV${NET_DIFFICULTIES[editDiff].dv})`,
                        },
                      ])
                    }
                    style={btnStyle}
                  >
                    + 階層を追加
                  </button>
                  <button
                    type="button"
                    data-testid="netrun-save-arch-btn"
                    onClick={handleSaveArch}
                    style={{ ...btnStyle, backgroundColor: 'var(--color-ally)', color: '#000', fontWeight: 700 }}
                  >
                    構造体を保存
                  </button>
                </div>
              </div>

              {currentArch?.price_info && (
                <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                  参考購入価格（自宅用）: 階層費 {currentArch.price_info.floorCost.toLocaleString()}eb + ICE/デーモン費{' '}
                  {currentArch.price_info.iceAndDemonCost.toLocaleString()}eb = 合計{' '}
                  <strong style={{ color: 'var(--color-text)' }}>{currentArch.price_info.totalCost.toLocaleString()}eb</strong>
                </div>
              )}

              {currentArch?.viruses && currentArch.viruses.length > 0 && (
                <div style={{ fontSize: '0.8rem', color: 'var(--color-warning)' }}>
                  稼働中のウイルス: {currentArch.viruses.map((v) => `${v.description} (DV${v.dv})`).join(' / ')}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {editFloors.map((fl, idx) => (
                  <div
                    key={`fl-${idx}`}
                    data-testid={`net-floor-row-${idx + 1}`}
                    style={{
                      display: 'flex',
                      gap: '6px',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      padding: '6px 8px',
                      borderRadius: '4px',
                      backgroundColor: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      fontSize: '0.8rem',
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, minWidth: '42px' }}>F{idx + 1}</span>
                    <input
                      aria-label={`F${idx + 1} 分岐`}
                      placeholder="分岐"
                      value={fl.branch || 'main'}
                      onChange={(e) => updateFloor(idx, { branch: e.target.value })}
                      style={{ ...fieldStyle, width: '58px' }}
                      title="幹は main、枝は B1, B2..."
                    />
                    <select
                      aria-label={`F${idx + 1} 種類`}
                      value={fl.kind}
                      onChange={(e) => {
                        const k = e.target.value as NetFloor['kind'];
                        updateFloor(idx, {
                          kind: k,
                          dv: ['file', 'password', 'control'].includes(k) ? (fl.dv ?? NET_DIFFICULTIES[editDiff].dv) : undefined,
                          ice: k === 'ice' ? (fl.ice?.length ? fl.ice : ['Wisp']) : undefined,
                          demon: k === 'demon' ? (fl.demon || 'Imp') : undefined,
                        });
                      }}
                      style={fieldStyle}
                    >
                      <option value="file">ファイル</option>
                      <option value="password">パスワード</option>
                      <option value="control">制御ノード</option>
                      <option value="ice">ブラックICE</option>
                      <option value="demon">デーモン</option>
                      <option value="empty">空</option>
                    </select>

                    {['file', 'password', 'control'].includes(fl.kind) && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span>DV</span>
                        <input
                          aria-label={`F${idx + 1} DV`}
                          type="number"
                          value={fl.dv ?? NET_DIFFICULTIES[editDiff].dv}
                          onChange={(e) => updateFloor(idx, { dv: Number(e.target.value) || 6 })}
                          style={{ ...fieldStyle, width: '54px' }}
                        />
                      </label>
                    )}

                    {fl.kind === 'ice' && (
                      <input
                        aria-label={`F${idx + 1} ブラックICE`}
                        placeholder="例: Hellhound,Wisp"
                        value={(fl.ice ?? []).join(',')}
                        onChange={(e) =>
                          updateFloor(idx, {
                            ice: e.target.value
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                        style={{ ...fieldStyle, width: '160px' }}
                        list="netrun-ice-datalist"
                      />
                    )}

                    {fl.kind === 'demon' && (
                      <select
                        aria-label={`F${idx + 1} デーモン`}
                        value={fl.demon || 'Imp'}
                        onChange={(e) => updateFloor(idx, { demon: e.target.value })}
                        style={fieldStyle}
                      >
                        {DEMON_CATALOG.map((d) => (
                          <option key={d.en} value={d.en}>
                            {d.name} ({d.en}) — REZ {d.rez} / IF {d.interface} / NET行動 {d.actions}
                          </option>
                        ))}
                      </select>
                    )}

                    {(fl.kind === 'control' || fl.kind === 'file') && (
                      <input
                        aria-label={`F${idx + 1} 内容・制御対象`}
                        placeholder={fl.kind === 'control' ? '制御対象（カメラ・砲塔など）' : 'ファイルの中身（メモ）'}
                        value={fl.note || fl.node || ''}
                        onChange={(e) => updateFloor(idx, { note: e.target.value, node: e.target.value })}
                        style={{ ...fieldStyle, flex: 1, minWidth: '140px' }}
                      />
                    )}

                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
                      <button type="button" onClick={() => moveFloor(idx, -1)} disabled={idx === 0} style={btnStyle}>
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveFloor(idx, 1)}
                        disabled={idx === editFloors.length - 1}
                        style={btnStyle}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditFloors((prev) => prev.filter((_, i) => i !== idx))}
                        style={{ ...btnStyle, color: 'var(--color-danger)' }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <datalist id="netrun-ice-datalist">
                {BLACK_ICE_CATALOG.map((b) => (
                  <option key={b.en} value={b.en}>
                    {b.name}
                  </option>
                ))}
              </datalist>
            </>
          )}
        </div>
      </div>

      {/* 自宅用 NET構造体の価格表（p.217〜218。表示のみ） */}
      <div style={panelStyle}>
        <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>自宅用 NET構造体の参考価格表（ルールブック p.217〜218）</div>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '0.8rem' }}>
          {Object.entries(NET_DIFFICULTIES).map(([k, v]) => (
            <div
              key={k}
              style={{
                padding: '6px 10px',
                borderRadius: '4px',
                backgroundColor: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
              }}
            >
              <strong>{v.name}</strong>（基本DV {v.dv}）: 1 階層あたり <strong>{v.floorCostEb.toLocaleString()}eb</strong>（最低 3 階層〜）
            </div>
          ))}
        </div>
      </div>

      {/* セキュリティ・罠・ドローン・デーモン一覧（p.212〜216） */}
      <div style={panelStyle}>
        <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>
          セキュリティ・防衛設備・デーモン一覧（戦闘中なら行動順の先頭に追加可能）
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left', color: 'var(--color-text-muted)' }}>
                <th style={{ padding: '4px 6px' }}>名称</th>
                <th style={{ padding: '4px 6px' }}>トリガー</th>
                <th style={{ padding: '4px 6px' }}>無力化DV / 時間</th>
                <th style={{ padding: '4px 6px' }}>HP / SP / 移動</th>
                <th style={{ padding: '4px 6px' }}>戦闘値</th>
                <th style={{ padding: '4px 6px' }}>効果・備考</th>
                <th style={{ padding: '4px 6px' }}>戦闘参戦</th>
              </tr>
            </thead>
            <tbody>
              {NET_SECURITIES.map((s) => (
                <tr key={s.key} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '4px 6px', fontWeight: 700 }}>{s.name}</td>
                  <td style={{ padding: '4px 6px' }}>{s.triggerLabel}</td>
                  <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)' }}>
                    DV {s.disarmDv} / {s.disarmTime}
                  </td>
                  <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)' }}>
                    HP {s.hp ?? '—'} / SP {s.sp} / MOVE {s.move}
                  </td>
                  <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)' }}>{s.combat || '—'}</td>
                  <td style={{ padding: '4px 6px' }}>{s.summary}</td>
                  <td style={{ padding: '4px 6px' }}>
                    {s.hp !== null && (
                      <button
                        type="button"
                        onClick={() => handleJoinCombat('security', s.key, s.name)}
                        style={btnStyle}
                      >
                        戦闘に追加
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {DEMON_CATALOG.map((d) => (
                <tr key={d.en} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '4px 6px', fontWeight: 700 }}>デーモン: {d.name}</td>
                  <td style={{ padding: '4px 6px' }}>NET常駐</td>
                  <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)' }}>IF {d.interface}</td>
                  <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)' }}>REZ {d.rez}</td>
                  <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)' }}>
                    {d.combat}（NET行動 {d.actions}）
                  </td>
                  <td style={{ padding: '4px 6px' }}>制御ノード操作とザップのみ使用（{d.price.toLocaleString()}eb）</td>
                  <td style={{ padding: '4px 6px' }}>
                    <button type="button" onClick={() => handleJoinCombat('demon', d.en, d.name)} style={btnStyle}>
                      戦闘に追加
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
