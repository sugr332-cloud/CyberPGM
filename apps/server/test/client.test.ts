import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { resolveDbPath, getImagesDir } from '../src/db/client.js';

describe('client.ts DB and Images path resolution', () => {
  it('throws an error if VITEST is set but DB_PATH is missing', () => {
    const originalVitest = process.env.VITEST;
    const originalDbPath = process.env.DB_PATH;
    const originalDbUrl = process.env.DATABASE_URL;

    try {
      process.env.VITEST = 'true';
      delete process.env.DB_PATH;
      delete process.env.DATABASE_URL;

      expect(() => resolveDbPath()).toThrowError(
        /Running under VITEST but DB_PATH is not set/,
      );
    } finally {
      process.env.VITEST = originalVitest;
      if (originalDbPath) process.env.DB_PATH = originalDbPath;
      if (originalDbUrl) process.env.DATABASE_URL = originalDbUrl;
    }
  });

  it('uses DB_PATH when provided under VITEST', () => {
    const originalDbPath = process.env.DB_PATH;
    try {
      process.env.DB_PATH = '/tmp/custom-test.db';
      expect(resolveDbPath()).toBe('/tmp/custom-test.db');
    } finally {
      if (originalDbPath) process.env.DB_PATH = originalDbPath;
    }
  });

  it('uses IMAGES_DIR when provided', () => {
    const originalImagesDir = process.env.IMAGES_DIR;
    try {
      process.env.IMAGES_DIR = '/tmp/custom-images';
      expect(getImagesDir()).toBe(path.resolve('/tmp/custom-images'));
    } finally {
      if (originalImagesDir) process.env.IMAGES_DIR = originalImagesDir;
    }
  });

  it('playwright config IMAGES_DIR points outside data/ and inside os.tmpdir()', async () => {
    const configModule = await import('../../../playwright.config.js');
    const imagesDir = configModule.e2eImagesDir;
    const command = configModule.default?.webServer?.command || '';

    expect(imagesDir).toBeDefined();
    expect(path.resolve(imagesDir)).not.toContain(path.resolve('data'));
    expect(path.resolve(imagesDir).startsWith(path.resolve(os.tmpdir()))).toBe(true);

    const match = command.match(/IMAGES_DIR=([^\s]+)/);
    expect(match).toBeTruthy();
    expect(path.resolve(match![1])).not.toContain(path.resolve('data'));
  });
});
