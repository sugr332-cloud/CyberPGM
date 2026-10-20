import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Finds the project root directory where the main package.json resides.
 */
export function getProjectRoot(startDir: string = process.cwd()): string {
  let curr = path.resolve(startDir);
  while (true) {
    const pkgPath = path.join(curr, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === 'cyberpgm') {
          return curr;
        }
      } catch {
        // ignore JSON parse error and keep walking
      }
    }
    const parent = path.dirname(curr);
    if (parent === curr) {
      // Reached filesystem root, fallback to startDir
      return startDir;
    }
    curr = parent;
  }
}
