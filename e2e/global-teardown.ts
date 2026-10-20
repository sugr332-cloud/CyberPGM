import * as fs from 'node:fs';
import { e2eImagesDir } from '../playwright.config.js';

export default async function globalTeardown() {
  if (fs.existsSync(e2eImagesDir)) {
    fs.rmSync(e2eImagesDir, { recursive: true, force: true });
  }
}
