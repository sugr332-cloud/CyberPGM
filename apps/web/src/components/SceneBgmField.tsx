import React, { useEffect, useRef, useState } from 'react';
import { SceneBgm } from '@cyberpgm/shared';
import { gmFetch } from '../api.js';

interface Props {
  value: SceneBgm | null | undefined;
  onChange: (bgm: SceneBgm | null) => void;
}

const field: React.CSSProperties = {
  padding: '4px 6px',
  fontSize: '0.75rem',
  borderRadius: '4px',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-bg)',
  color: 'var(--color-text)',
};

/** シーンの BGM（Phase 5e）: 音声を選ぶ・ループ・音量。mp3 / ogg / m4a / wav をここから登録できる */
export function SceneBgmField({ value, onChange }: Props) {
  const [audioList, setAudioList] = useState<Array<{ id: string; title: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () =>
    gmFetch('/api/audio')
      .then((r) => r.json())
      .then((res) => setAudioList(res.audio ?? []))
      .catch(() => undefined);

  useEffect(() => {
    load();
  }, []);

  const upload = async (file: File) => {
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    const res = await gmFetch('/api/audio', { method: 'POST', body: fd }).then((r) => r.json());
    if (res.error) {
      setError(res.error);
      return;
    }
    await load();
    onChange({ audio_id: res.audio.id, loop: value?.loop ?? true, volume: value?.volume ?? 70 });
  };

  return (
    <div data-testid="scene-bgm-field" style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>BGM（表示ウィンドウで流れる）</label>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          aria-label="シーンの BGM"
          value={value?.audio_id ?? ''}
          onChange={(e) => onChange(e.target.value ? { audio_id: e.target.value, loop: value?.loop ?? true, volume: value?.volume ?? 70 } : null)}
          style={{ ...field, flex: 1 }}
        >
          <option value="">なし</option>
          {audioList.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => fileRef.current?.click()} style={{ ...field, cursor: 'pointer' }}>
          音声を登録
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".mp3,.ogg,.m4a,.wav,audio/*"
          data-testid="scene-bgm-upload"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = '';
          }}
        />
      </div>
      {value && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.75rem' }}>
          <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <input type="checkbox" checked={value.loop} onChange={(e) => onChange({ ...value, loop: e.target.checked })} />
            ループ
          </label>
          <span>音量</span>
          <input
            aria-label="シーンの BGM の音量"
            type="range"
            min={0}
            max={100}
            defaultValue={value.volume}
            onPointerUp={(e) => onChange({ ...value, volume: Number((e.target as HTMLInputElement).value) })}
          />
          <span>{value.volume}</span>
        </div>
      )}
      {error && <span style={{ color: 'var(--color-accent)', fontSize: '0.75rem' }}>{error}</span>}
    </div>
  );
}
