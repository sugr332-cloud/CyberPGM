// GM の画面（この PC）でも BGM を鳴らすか（Phase 5n）。表示ウィンドウを開かないときに使う。ブラウザごとに覚える
const KEY = 'cpgm_gm_bgm';
const EVENT = 'cpgm-gm-bgm';

export function getGmBgmOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setGmBgmOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // 保存できなくても、この画面のあいだは切り替える
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
}

export function onGmBgmChange(fn: (on: boolean) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<boolean>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}
