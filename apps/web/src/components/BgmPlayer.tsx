import { useEffect, useRef, useState } from 'react';

export interface BgmState {
  audio_id: string;
  loop: boolean;
  volume: number;
  playing: boolean;
}

const FADE_MS = 1500;

/**
 * 表示ウィンドウの BGM（Phase 5e）。曲の切り替え・停止は FADE_MS かけてフェードする。
 * ブラウザは操作なしで音を出せないので、最初の 1 回だけ「クリックして音声を有効にする」を出す。
 */
export function BgmPlayer({ bgm, compact = false }: { bgm: BgmState | null; compact?: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentId = useRef<string | null>(null);
  const fadeTimer = useRef<number | null>(null);
  // compact（GM の画面）: GM はもう画面を操作しているので、最初から鳴らしてみる。止められたら小さいボタンを出す
  const [unlocked, setUnlocked] = useState(compact);

  const target = bgm && bgm.playing ? bgm.volume / 100 : 0;

  const fadeTo = (to: number, done?: () => void) => {
    const el = audioRef.current;
    if (!el) return done?.();
    if (fadeTimer.current) window.clearInterval(fadeTimer.current);
    const from = el.volume;
    const start = performance.now();
    fadeTimer.current = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / FADE_MS);
      el.volume = from + (to - from) * t;
      if (t >= 1) {
        if (fadeTimer.current) window.clearInterval(fadeTimer.current);
        fadeTimer.current = null;
        done?.();
      }
    }, 50);
  };

  useEffect(() => {
    if (!audioRef.current) audioRef.current = new Audio();
    const el = audioRef.current;
    el.loop = bgm?.loop ?? true;
    const nextId = bgm && bgm.playing ? bgm.audio_id : null;

    if (nextId === currentId.current) {
      // 同じ曲: 音量だけ合わせる
      if (nextId && unlocked) fadeTo(target);
      return;
    }
    // 曲が変わる・止まる: いまの曲をフェードアウトしてから切り替える
    fadeTo(0, () => {
      el.pause();
      currentId.current = nextId;
      if (!nextId) return;
      el.src = `/api/audio/${nextId}/file`;
      el.volume = 0;
      if (unlocked) {
        el.play().then(() => fadeTo(target)).catch(() => setUnlocked(false));
      }
    });
  }, [bgm?.audio_id, bgm?.playing, bgm?.volume, bgm?.loop, unlocked]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (fadeTimer.current) window.clearInterval(fadeTimer.current);
    },
    [],
  );

  if (!bgm || unlocked) return <span data-testid="bgm-state" data-audio-id={bgm?.audio_id ?? ''} data-playing={String(!!bgm?.playing)} data-volume={bgm?.volume ?? ''} style={{ display: 'none' }} />;

  return (
    <button
      type="button"
      data-testid="bgm-unlock"
      onClick={() => {
        setUnlocked(true);
        const el = audioRef.current;
        if (el && currentId.current) {
          el.play().then(() => fadeTo(target)).catch(() => undefined);
        }
      }}
      style={
        compact
          ? {
              position: 'fixed',
              right: '16px',
              bottom: '16px',
              zIndex: 50,
              padding: '10px 14px',
              background: 'var(--color-ally)',
              color: '#000',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 700,
              cursor: 'pointer',
            }
          : {
              position: 'fixed',
              inset: 0,
              zIndex: 50,
              background: 'rgba(0, 0, 0, 0.6)',
              color: 'var(--color-text)',
              border: 'none',
              fontSize: '1.4rem',
              cursor: 'pointer',
            }
      }
    >
      {compact ? '♪ クリックして BGM を鳴らす' : 'クリックして音声を有効にする'}
    </button>
  );
}
