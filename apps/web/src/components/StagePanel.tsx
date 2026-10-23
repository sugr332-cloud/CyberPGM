import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CharacterSheet, StagePortrait } from '@cyberpgm/shared';
import { getGmToken, gmFetch } from '../api.js';
import { getGmBgmOn, setGmBgmOn } from '../gmBgm.js';

interface ImageRow {
  id: string;
  title: string | null;
  path: string;
  origin: string;
  visibility: 'gm' | 'players';
}

interface AudioRow {
  id: string;
  title: string;
}

interface DisplayState {
  scene_id?: string | null;
  background_image_id?: string | null;
  portraits: StagePortrait[];
  bgm: { audio_id: string; loop: boolean; volume: number; playing: boolean } | null;
  keep_bgm_on_silent_scene: boolean;
}

interface Props {
  characters: CharacterSheet[];
  section?: 'all' | 'visual' | 'audio';
}

const panel: React.CSSProperties = {
  backgroundColor: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  padding: '12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  fontSize: '0.8rem',
};
const btn: React.CSSProperties = {
  padding: '3px 8px',
  borderRadius: '4px',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface-elevated)',
  color: 'var(--color-text)',
  fontSize: '0.75rem',
  cursor: 'pointer',
};
const input: React.CSSProperties = {
  padding: '4px 6px',
  backgroundColor: 'var(--color-bg)',
  border: '1px solid var(--color-border-light)',
  borderRadius: '3px',
  color: 'var(--color-text)',
  fontSize: '0.8rem',
};

/**
 * 舞台パネル（Phase 5e）: 表示ウィンドウの背景・立ち絵・BGM を決める。GM のメインウィンドウだけに置く
 * （表示ウィンドウ /screen・戦闘の別ウィンドウ・スマホには出さない）。
 */
export function StagePanel({ characters, section = 'all' }: Props) {
  const [display, setDisplay] = useState<DisplayState | null>(null);
  const [imageList, setImageList] = useState<ImageRow[]>([]);
  const [audioList, setAudioList] = useState<AudioRow[]>([]);
  const [audioFolder, setAudioFolder] = useState('');
  const [gmBgmOn, setGmBgmOnState] = useState(getGmBgmOn());
  const [sessionCode, setSessionCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const latestUpdate = useRef(0);
  const previewRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ index: number } | null>(null);

  const load = useCallback(async () => {
    const [d, imgs, aud, sess] = await Promise.all([
      gmFetch('/api/display').then((r) => r.json()),
      gmFetch('/api/images').then((r) => r.json()),
      gmFetch('/api/audio').then((r) => r.json()),
      gmFetch('/api/session').then((r) => r.json()),
    ]);
    setDisplay(d.display ?? null);
    setImageList(imgs.images ?? []);
    setAudioList(aud.audio ?? []);
    setAudioFolder(aud.folder ?? '');
    setSessionCode(sess.code ?? '');
  }, []);

  useEffect(() => {
    load().catch(() => setError('舞台の情報を読めませんでした'));
  }, [load]);

  const put = async (path: string, body: unknown) => {
    const version = ++latestUpdate.current;
    setError(null);
    const res = await gmFetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    if (version !== latestUpdate.current) return;
    if (res.error) {
      setError(res.error);
      await load();
    } else setDisplay(res.display);
  };

  const imageById = (id?: string | null) => imageList.find((i) => i.id === id);
  const withPortrait = characters.filter((c) => c.portrait_image_id);
  const portraits = display?.portraits ?? [];

  const savePortraits = (next: StagePortrait[]) => put('/api/display/stage', { portraits: next });
  const updatePortrait = (index: number, patch: Partial<StagePortrait>) =>
    savePortraits(portraits.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  // 本のスキャン（GM のみの画像）は、GM が「プレイヤーにも見せる」に切り替えるまで表示ウィンドウに出ない（SPEC §3）
  const confirmedOnce = useRef(false);
  const allowForPlayers = async (img: ImageRow) => {
    if (!confirmedOnce.current && !confirm('本のスキャンは私的利用の範囲で使ってください。この画像をプレイヤーにも見せますか？')) return;
    confirmedOnce.current = true;
    await gmFetch(`/api/images/${img.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: 'players' }),
    });
    await load();
    await put('/api/display/stage', {}); // 表示ウィンドウに送り直す
  };

  const onPreviewPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || !previewRef.current) return;
    const r = previewRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const i = dragging.current.index;
    setDisplay((d) => (d ? { ...d, portraits: d.portraits.map((p, idx) => (idx === i ? { ...p, x, y } : p)) } : d));
  };
  const onPreviewPointerUp = () => {
    if (!dragging.current || !display) return;
    dragging.current = null;
    savePortraits(display.portraits);
  };

  if (!display) {
    return (
      <div style={panel}>
        <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{section === 'audio' ? 'BGM・音量' : '舞台（表示ウィンドウ）'}</span>
        <span style={{ color: 'var(--color-text-muted)' }}>{error ?? '進行を始めると使えます'}</span>
      </div>
    );
  }

  const bg = imageById(display.background_image_id);
  const token = encodeURIComponent(getGmToken() ?? '');

  return (
    <div data-testid={section === 'audio' ? 'scenario-bgm-panel' : 'stage-panel'} style={{ ...panel, minWidth: 0 }}>
      {error && <span role="alert" style={{ color: 'var(--color-accent)' }}>{error}</span>}
      {section !== 'audio' && <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>舞台（表示ウィンドウ）</span>
        <button type="button" style={btn} onClick={() => window.open(`/screen?code=${sessionCode}`, 'cyberpgm-display')}>
          表示ウィンドウを開く
        </button>
      </div>

      {/* プレビュー（16:9）。立ち絵はドラッグで動かす */}
      <div
        ref={previewRef}
        data-testid="stage-preview"
        onPointerMove={onPreviewPointerMove}
        onPointerUp={onPreviewPointerUp}
        onPointerLeave={onPreviewPointerUp}
        style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', backgroundColor: '#000', borderRadius: '4px', overflow: 'hidden', touchAction: 'none' }}
      >
        {bg && <img src={`/api/images/${bg.id}?t=${token}`} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
        {portraits.map((p, i) => {
          const ch = characters.find((c) => c.id === p.character_id);
          if (!ch?.portrait_image_id) return null;
          return (
            <img
              key={`${p.character_id}-${i}`}
              src={`/api/images/${ch.portrait_image_id}?t=${token}`}
              alt={ch.name}
              draggable={false}
              onPointerDown={(e) => {
                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                dragging.current = { index: i };
              }}
              style={{
                position: 'absolute',
                left: `${p.x * 100}%`,
                top: `${p.y * 100}%`,
                height: `${70 * p.scale}%`,
                transform: `translate(-50%, -100%) scaleX(${p.flip ? -1 : 1})`,
                zIndex: p.z,
                cursor: 'grab',
              }}
            />
          );
        })}
      </div>

      <label style={{ display: 'flex', gap: '6px', alignItems: 'center', whiteSpace: 'nowrap' }}>
        背景
        <select
          aria-label="背景"
          value={display.background_image_id ?? ''}
          onChange={(e) => put('/api/display/stage', { background_image_id: e.target.value || null })}
          style={{ ...input, flex: 1, minWidth: 0 }}
        >
          <option value="">なし</option>
          {imageList.map((img) => (
            <option key={img.id} value={img.id}>
              {(img.title || img.path) + (img.visibility === 'gm' ? '（GM のみ）' : '')}
            </option>
          ))}
        </select>
      </label>
      {bg?.visibility === 'gm' && (
        <div style={{ color: 'var(--color-warning)' }}>
          この背景は GM のみの画像なので表示ウィンドウに出ません。
          <button type="button" style={{ ...btn, marginLeft: '6px' }} onClick={() => allowForPlayers(bg)}>
            プレイヤーにも見せる
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <span style={{ whiteSpace: 'nowrap' }}>立ち絵</span>
        <select
          aria-label="登場させるキャラ"
          value=""
          onChange={(e) => {
            if (!e.target.value) return;
            savePortraits([...portraits, { character_id: e.target.value, x: 0.5, y: 1, scale: 1, flip: false, z: portraits.length, show_name: true }]);
          }}
          style={{ ...input, flex: 1, minWidth: 0 }}
        >
          <option value="">登場させるキャラを選ぶ</option>
          {withPortrait.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {portraits.length > 0 && (
          <button type="button" style={btn} onClick={() => savePortraits([])}>
            全員退場
          </button>
        )}
      </div>
      {withPortrait.length === 0 && <span style={{ color: 'var(--color-text-muted)' }}>立ち絵のあるキャラがいません（PC タブの編集で立ち絵を選ぶ）</span>}

      {portraits.map((p, i) => {
        const ch = characters.find((c) => c.id === p.character_id);
        const img = imageById(ch?.portrait_image_id);
        return (
          <div key={`${p.character_id}-${i}`} data-testid="stage-portrait-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, minWidth: '6em' }}>{ch?.name ?? '—'}</span>
            <button type="button" style={btn} onClick={() => updatePortrait(i, { x: 0.2, y: 1 })}>左</button>
            <button type="button" style={btn} onClick={() => updatePortrait(i, { x: 0.5, y: 1 })}>中央</button>
            <button type="button" style={btn} onClick={() => updatePortrait(i, { x: 0.8, y: 1 })}>右</button>
            <button type="button" style={btn} onClick={() => updatePortrait(i, { scale: Math.max(0.3, +(p.scale - 0.1).toFixed(2)) })}>縮小</button>
            <button type="button" style={btn} onClick={() => updatePortrait(i, { scale: Math.min(4, +(p.scale + 0.1).toFixed(2)) })}>拡大</button>
            <button type="button" style={btn} onClick={() => updatePortrait(i, { flip: !p.flip })}>反転</button>
            <button type="button" style={btn} onClick={() => updatePortrait(i, { z: Math.max(...portraits.map((q) => q.z)) + 1 })}>前へ</button>
            <button type="button" style={btn} onClick={() => updatePortrait(i, { z: Math.min(...portraits.map((q) => q.z)) - 1 })}>後ろへ</button>
            <label style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
              <input type="checkbox" checked={p.show_name} onChange={(e) => updatePortrait(i, { show_name: e.target.checked })} />
              名前
            </label>
            <button type="button" style={btn} onClick={() => savePortraits(portraits.filter((_, idx) => idx !== i))}>退場</button>
            {img?.visibility === 'gm' && (
              <button type="button" style={btn} onClick={() => allowForPlayers(img)}>
                GM のみの画像。プレイヤーにも見せる
              </button>
            )}
          </div>
        );
      })}

      </>}
      {section !== 'visual' && <>
      {section === 'audio' && <strong style={{ fontSize: '0.9rem' }}>BGM・音量</strong>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
        <span style={{ whiteSpace: 'nowrap' }}>BGM</span>
        <select
          aria-label="BGM"
          value={display.bgm?.audio_id ?? ''}
          onChange={(e) =>
            put('/api/display/bgm', e.target.value ? { audio_id: e.target.value, loop: display.bgm?.loop ?? true, volume: display.bgm?.volume ?? 70, playing: true } : { audio_id: null })
          }
          style={{ ...input, flex: 1, minWidth: 0 }}
        >
          <option value="">なし</option>
          {audioList.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
        {display.bgm && (
          <>
            <button type="button" style={btn} onClick={() => { const playing = !display.bgm!.playing; setDisplay({ ...display, bgm: { ...display.bgm!, playing } }); void put('/api/display/bgm', { playing }); }}>
              {display.bgm.playing ? '停止' : '再生'}
            </button>
            <input
              aria-label="音量"
              type="range"
              min={0}
              max={100}
              value={display.bgm.volume}
              onChange={(e) => setDisplay({ ...display, bgm: { ...display.bgm!, volume: Number(e.target.value) } })}
              onPointerUp={(e) => put('/api/display/bgm', { volume: Number((e.target as HTMLInputElement).value) })}
              onKeyUp={(e) => put('/api/display/bgm', { volume: Number((e.target as HTMLInputElement).value) })}
            />
            <label style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
              <input type="checkbox" checked={display.bgm.loop} onChange={(e) => { const loop = e.target.checked; setDisplay({ ...display, bgm: { ...display.bgm!, loop } }); void put('/api/display/bgm', { loop }); }} />
              ループ
            </label>
          </>
        )}
      </div>
      {/* 表示ウィンドウを開かないときは、この PC の GM 画面で鳴らす（Phase 5n） */}
      <label style={{ display: 'flex', gap: '4px', alignItems: 'center', color: 'var(--color-text-muted)' }}>
        <input
          type="checkbox"
          data-testid="gm-bgm-toggle"
          checked={gmBgmOn}
          onChange={(e) => {
            setGmBgmOnState(e.target.checked);
            setGmBgmOn(e.target.checked);
          }}
        />
        この PC（GM 画面）で鳴らす（表示ウィンドウを開かないとき）
      </label>
      <details>
        <summary style={{ cursor: 'pointer', color: 'var(--color-text-muted)' }}>曲の追加・再読込</summary>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', color: 'var(--color-text-muted)', fontSize: '0.75rem', flexWrap: 'wrap' }}>
        <span>曲は BGM フォルダ{audioFolder ? `（${audioFolder}）` : ''}に入れると一覧に出ます（mp3 / ogg / m4a / wav。サブフォルダも可）</span>
        <button type="button" style={btn} onClick={() => load().catch(() => setError('BGM フォルダを読めませんでした'))}>
          読み直す
        </button>
      </div>
      </details>
      <label style={{ display: 'flex', gap: '4px', alignItems: 'center', color: 'var(--color-text-muted)' }}>
        <input
          type="checkbox"
          checked={display.keep_bgm_on_silent_scene}
          onChange={(e) => { const keep = e.target.checked; setDisplay({ ...display, keep_bgm_on_silent_scene: keep }); void put('/api/display/settings', { keep_bgm_on_silent_scene: keep }); }}
        />
        BGM のないシーンでは前の曲を流し続ける
      </label>
      </>}
    </div>
  );
}
