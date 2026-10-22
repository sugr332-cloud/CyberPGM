import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

/**
 * 行動ごとの「今できるか・できない理由」を読む（Phase 6a）。
 * 理由はサーバーの解決の処理が断るときと同じ文。refreshKey が変わるたびに読み直す
 */
export function useActionAvailability(opts: {
  enabled: boolean;
  token?: string | null;
  participantId?: string | null;
  refreshKey: unknown;
}) {
  const { enabled, token, participantId, refreshKey } = opts;
  const [reasons, setReasons] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (!enabled) {
      setReasons({});
      return;
    }
    let alive = true;
    api
      .getCombatAvailability(token, participantId)
      .then((res) => {
        if (alive) setReasons(res.actions || {});
      })
      .catch(() => {
        if (alive) setReasons({});
      });
    return () => {
      alive = false;
    };
  }, [enabled, token, participantId, refreshKey]);

  /** できないなら「「射撃」はできません: 理由」、できるなら null */
  const blockedMessage = useCallback(
    (actionKey: string, label: string): string | null => {
      const r = reasons[actionKey];
      return r ? `「${label}」はできません: ${r}` : null;
    },
    [reasons],
  );

  return { reasons, blockedMessage };
}

/** できない行動のボタンの見た目（押せるまま、グレーにする） */
export const blockedButtonStyle = {
  opacity: 0.45,
  filter: 'grayscale(1)',
  cursor: 'not-allowed',
} as const;
