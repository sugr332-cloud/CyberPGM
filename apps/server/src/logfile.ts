import fs from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';
import { getProjectRoot } from '@cyberpgm/shared';

/**
 * サーバーのログとエラーをファイルにも残す（仕様 §9。Phase 5n）。data/logs/cyberpgm-YYYY-MM-DD.log に追記する。
 * 画面（ターミナル）への出力はそのまま。サーバーの起動時だけ呼ぶ（テストでは使わない）
 */
export function startLogFile(): string {
  const dir = process.env.LOG_DIR ? path.resolve(process.env.LOG_DIR) : path.join(getProjectRoot(), 'data', 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const fileFor = () => path.join(dir, `cyberpgm-${new Date().toISOString().slice(0, 10)}.log`);
  const write = (level: string, args: unknown[]) => {
    try {
      fs.appendFileSync(fileFor(), `${new Date().toISOString()} [${level}] ${format(...args)}\n`);
    } catch {
      // ログが書けなくてもサーバーは止めない
    }
  };
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      write(level.toUpperCase(), args);
    };
  }
  process.on('uncaughtException', (err) => {
    write('FATAL', [err]);
    throw err;
  });
  process.on('unhandledRejection', (reason) => write('ERROR', ['unhandledRejection', reason]));
  return fileFor();
}
