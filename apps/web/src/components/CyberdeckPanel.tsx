import React, { useState, useEffect } from 'react';
import {
  CharacterSheet,
  NET_PROGRAMS,
  BLACK_ICE_CATALOG,
  NET_HARDWARE,
  DECK_SLOTS,
  deckSlotsUsed,
  NetDeckConfig,
} from '@cyberpgm/shared';
import { api } from '../api.js';

interface CyberdeckPanelProps {
  character: CharacterSheet;
  onChanged: () => void;
}

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
  padding: '4px 10px',
  fontSize: '0.78rem',
  cursor: 'pointer',
};

export const CyberdeckPanel: React.FC<CyberdeckPanelProps> = ({ character, onChanged }) => {
  const extra = (character.extra ?? {}) as Record<string, any>;
  const curDeck: NetDeckConfig = extra.deck ?? {
    quality: 'Standard',
    slots: 7,
    programs: [],
    black_ice: [],
    hardware: [],
  };

  const [quality, setQuality] = useState<'Poor' | 'Standard' | 'Excellent'>(curDeck.quality ?? 'Standard');
  const [slots, setSlots] = useState<number>(curDeck.slots ?? 7);
  const [programs, setPrograms] = useState<string[]>(curDeck.programs ?? []);
  const [blackIce, setBlackIce] = useState<string[]>(curDeck.black_ice ?? []);
  const [hardware, setHardware] = useState<string[]>(curDeck.hardware ?? []);
  const [goggles, setGoggles] = useState<boolean>(extra.virtuality_goggles !== false);
  const [selectedProgram, setSelectedProgram] = useState<string>(NET_PROGRAMS[0].en);
  const [selectedIce, setSelectedIce] = useState<string>(BLACK_ICE_CATALOG[0].en);
  const [selectedHw, setSelectedHw] = useState<string>(NET_HARDWARE[0].en);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const d: NetDeckConfig = (character.extra as any)?.deck ?? {
      quality: 'Standard',
      slots: 7,
      programs: [],
      black_ice: [],
      hardware: [],
    };
    setQuality(d.quality ?? 'Standard');
    setSlots(d.slots ?? 7);
    setPrograms(d.programs ?? []);
    setBlackIce(d.black_ice ?? []);
    setHardware(d.hardware ?? []);
    setGoggles((character.extra as any)?.virtuality_goggles !== false);
  }, [character.id, character.extra]);

  const usedSlots = deckSlotsUsed({ quality, slots, programs, black_ice: blackIce, hardware });
  const backupSaved: string[] = curDeck.backup_saved ?? [];
  const netDrain = extra.net_drain as { hours: number; stats: Record<string, number> } | undefined;

  const saveDeck = async (next: {
    quality?: 'Poor' | 'Standard' | 'Excellent';
    slots?: number;
    programs?: string[];
    black_ice?: string[];
    hardware?: string[];
    virtuality_goggles?: boolean;
  }) => {
    setErr(null);
    setMsg(null);
    try {
      const payload = {
        quality: next.quality ?? quality,
        slots: next.slots ?? slots,
        programs: next.programs ?? programs,
        black_ice: next.black_ice ?? blackIce,
        hardware: next.hardware ?? hardware,
      };
      await api.updateCyberdeck(character.id, payload);
      if (next.virtuality_goggles !== undefined && next.virtuality_goggles !== extra.virtuality_goggles) {
        await api.updateCharacter(character.id, {
          extra: { ...extra, deck: payload, virtuality_goggles: next.virtuality_goggles },
        });
      }
      setMsg('サイバーデッキを保存しました');
      onChanged();
    } catch (e: any) {
      setErr(e.message || 'サイバーデッキの更新に失敗しました');
    }
  };

  const handleRestoreBackup = async () => {
    setErr(null);
    setMsg(null);
    try {
      await api.updateCyberdeck(character.id, { restore_backup: true });
      setMsg('バックアップ・ドライブからプログラムを復元しました');
      onChanged();
    } catch (e: any) {
      setErr(e.message || '復元に失敗しました');
    }
  };

  const handleRestoreDrain = async () => {
    setErr(null);
    setMsg(null);
    try {
      await api.restoreNetDrain(character.id);
      setMsg('NET による能力値低下を回復しました');
      onChanged();
    } catch (e: any) {
      setErr(e.message || '能力値の回復に失敗しました');
    }
  };

  return (
    <div data-testid="cyberdeck-panel" style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.82rem' }}>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ color: 'var(--color-text-muted)' }}>デッキ品質・スロット数:</span>
          <select
            aria-label="サイバーデッキの品質"
            value={quality}
            onChange={(e) => {
              const q = e.target.value as 'Poor' | 'Standard' | 'Excellent';
              const s = DECK_SLOTS[q];
              setQuality(q);
              setSlots(s);
              saveDeck({ quality: q, slots: s });
            }}
            style={fieldStyle}
          >
            <option value="Poor">低品質（5 スロット / 100eb）</option>
            <option value="Standard">標準（7 スロット / 500eb）</option>
            <option value="Excellent">高品質（9 スロット / 1,000eb）</option>
          </select>
        </label>

        <span
          data-testid="cyberdeck-slot-usage"
          style={{
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            color: usedSlots > slots ? 'var(--color-danger)' : 'var(--color-ally)',
          }}
        >
          使用スロット: {usedSlots} / {slots}
        </span>

        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={goggles}
            onChange={(e) => {
              setGoggles(e.target.checked);
              saveDeck({ virtuality_goggles: e.target.checked });
            }}
          />
          <span>ヴァーチャリティ・ゴーグル着用（肉体と NET の併用可）</span>
        </label>
      </div>

      {/* プログラム（1 スロット） */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--color-text-muted)', minWidth: '150px' }}>プログラム（各 1 スロット）:</span>
          <select
            aria-label="インストールするプログラム"
            value={selectedProgram}
            onChange={(e) => setSelectedProgram(e.target.value)}
            style={fieldStyle}
          >
            {NET_PROGRAMS.map((p) => (
              <option key={p.en} value={p.en}>
                {p.name} ({p.en}) — {p.effect} [{p.price}eb]
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              const next = [...programs, selectedProgram];
              setPrograms(next);
              saveDeck({ programs: next });
            }}
            style={btnStyle}
          >
            + プログラム追加
          </button>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {programs.length === 0 && <span style={{ color: 'var(--color-text-muted)' }}>未インストール</span>}
          {programs.map((pk, i) => {
            const def = NET_PROGRAMS.find((p) => p.en === pk || p.name === pk);
            return (
              <span
                key={`${pk}-${i}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  backgroundColor: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <span>{def ? `${def.name} (${def.en})` : pk}</span>
                <button
                  type="button"
                  onClick={() => {
                    const next = programs.filter((_, idx) => idx !== i);
                    setPrograms(next);
                    saveDeck({ programs: next });
                  }}
                  style={{ border: 'none', background: 'none', color: 'var(--color-accent)', cursor: 'pointer', padding: 0 }}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      </div>

      {/* ブラック ICE（2 スロット） */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--color-text-muted)', minWidth: '150px' }}>ブラック ICE（各 2 スロット）:</span>
          <select
            aria-label="インストールするブラックICE"
            value={selectedIce}
            onChange={(e) => setSelectedIce(e.target.value)}
            style={fieldStyle}
          >
            {BLACK_ICE_CATALOG.map((b) => (
              <option key={b.en} value={b.en}>
                {b.name} ({b.en}) — PER {b.per} / SPD {b.spd} / ATK {b.atk} / DEF {b.def} / REZ {b.rez} [{b.price}eb]
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              const next = [...blackIce, selectedIce];
              setBlackIce(next);
              saveDeck({ black_ice: next });
            }}
            style={btnStyle}
          >
            + ブラックICE追加
          </button>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {blackIce.length === 0 && <span style={{ color: 'var(--color-text-muted)' }}>未インストール</span>}
          {blackIce.map((ik, i) => {
            const def = BLACK_ICE_CATALOG.find((b) => b.en === ik || b.name === ik);
            return (
              <span
                key={`${ik}-${i}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  backgroundColor: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <span>{def ? `${def.name} [2枠]` : ik}</span>
                <button
                  type="button"
                  onClick={() => {
                    const next = blackIce.filter((_, idx) => idx !== i);
                    setBlackIce(next);
                    saveDeck({ black_ice: next });
                  }}
                  style={{ border: 'none', background: 'none', color: 'var(--color-accent)', cursor: 'pointer', padding: 0 }}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      </div>

      {/* ハードウェア（1〜2 スロット） */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--color-text-muted)', minWidth: '150px' }}>ハードウェア:</span>
          <select
            aria-label="インストールするハードウェア"
            value={selectedHw}
            onChange={(e) => setSelectedHw(e.target.value)}
            style={fieldStyle}
          >
            {NET_HARDWARE.map((h) => (
              <option key={h.en} value={h.en}>
                {h.name} ({h.slots}枠 / {h.price}eb) — {h.effect}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              const next = [...hardware, selectedHw];
              setHardware(next);
              saveDeck({ hardware: next });
            }}
            style={btnStyle}
          >
            + ハードウェア追加
          </button>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {hardware.length === 0 && <span style={{ color: 'var(--color-text-muted)' }}>未装着</span>}
          {hardware.map((hk, i) => {
            const def = NET_HARDWARE.find((h) => h.en === hk || h.name === hk);
            return (
              <span
                key={`${hk}-${i}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  backgroundColor: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <span>{def ? `${def.name} [${def.slots}枠]` : hk}</span>
                <button
                  type="button"
                  onClick={() => {
                    const next = hardware.filter((_, idx) => idx !== i);
                    setHardware(next);
                    saveDeck({ hardware: next });
                  }}
                  style={{ border: 'none', background: 'none', color: 'var(--color-accent)', cursor: 'pointer', padding: 0 }}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      </div>

      {/* バックアップ・ドライブに保存されているプログラムがあれば復元ボタン */}
      {backupSaved.length > 0 && (
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', color: 'var(--color-warning)' }}>
          <span>バックアップ保存中: {backupSaved.join('、')}</span>
          <button type="button" onClick={handleRestoreBackup} style={btnStyle}>
            バックアップから復元
          </button>
        </div>
      )}

      {/* 1 時間の能力値低下があれば解除ボタン */}
      {netDrain && netDrain.stats && Object.keys(netDrain.stats).length > 0 && (
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', color: 'var(--color-warning)' }}>
          <span>
            NET 能力値低下中:{' '}
            {Object.entries(netDrain.stats)
              .map(([k, v]) => `${k.toUpperCase()} −${v}`)
              .join(' / ')}
          </span>
          <button type="button" onClick={handleRestoreDrain} style={btnStyle}>
            能力値低下を解除
          </button>
        </div>
      )}

      {err && <div style={{ color: 'var(--color-danger)' }}>{err}</div>}
      {msg && <div style={{ color: 'var(--color-ally)' }}>{msg}</div>}
    </div>
  );
};
