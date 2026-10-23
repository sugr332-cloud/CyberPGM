import path from 'node:path';
import { getProjectRoot } from '@cyberpgm/shared';

/** テストでは一時フォルダを指定し、手元のルール資料には書き込まない。 */
export function getCoreSourceDir(): string {
  return process.env.CORE_SOURCE_DIR || path.join(getProjectRoot(), 'data', 'sources', 'core-ja');
}
