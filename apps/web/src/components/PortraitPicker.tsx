import { useEffect, useRef, useState } from 'react';
import { getGmToken, gmFetch } from '../api.js';

interface Props {
  value: string | null;
  onChange: (imageId: string | null) => void;
}

/** 立ち絵（Phase 5e）: 画像の一覧から選ぶか、新しく登録する（透過 PNG をそのまま使う） */
export function PortraitPicker({ value, onChange }: Props) {
  const [images, setImages] = useState<Array<{ id: string; title: string | null; path: string; visibility: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () =>
    gmFetch('/api/images')
      .then((r) => r.json())
      .then((res) => setImages(res.images ?? []))
      .catch(() => undefined);

  useEffect(() => {
    load();
  }, []);

  const upload = async (file: File) => {
    setError(null);
    const fd = new FormData();
    fd.append('image', file);
    fd.append('title', `立ち絵: ${file.name}`);
    // GM が用意した画像はプレイヤーにも見せる（Phase 3a の決まり。本のスキャンは別）
    fd.append('visibility', 'players');
    const res = await gmFetch('/api/images', { method: 'POST', body: fd }).then((r) => r.json());
    if (res.error) {
      setError(res.error);
      return;
    }
    await load();
    onChange((res.image ?? res).id);
  };

  return (
    <div data-testid="portrait-picker" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <select
          aria-label="立ち絵"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          style={{ flex: 1, padding: '6px', backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border-light)', borderRadius: '4px', color: 'var(--color-text)' }}
        >
          <option value="">なし</option>
          {images.map((img) => (
            <option key={img.id} value={img.id}>
              {(img.title || img.path) + (img.visibility === 'gm' ? '（GM のみ）' : '')}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-elevated)', color: 'var(--color-text)', cursor: 'pointer' }}
        >
          画像を登録
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = '';
          }}
        />
      </div>
      {value && (
        <img src={`/api/images/${value}?t=${encodeURIComponent(getGmToken() ?? '')}`} alt="" style={{ maxHeight: '120px', objectFit: 'contain', alignSelf: 'flex-start' }} />
      )}
      {error && <span style={{ color: 'var(--color-accent)', fontSize: '0.75rem' }}>{error}</span>}
    </div>
  );
}
