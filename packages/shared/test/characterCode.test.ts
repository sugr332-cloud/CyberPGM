import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateChecksum,
  utf8ToBase64,
  base64ToUtf8,
  encodeCharacterToCode,
  decodeCharacterFromCode,
  CPGM_CODE_PREFIX,
  MAILTO_SAFE_LIMIT,
} from '../src/characterCode.js';
import { CpgmCharacterFile } from '../src/creation.js';

describe('characterCode serialization and recovery', () => {
  const sampleCharacterFile: CpgmCharacterFile = {
    format: 'cpgm-character',
    version: 1,
    character: {
      name: 'Viper',
      role: 'Solo',
      stats: {
        int: 6,
        ref: 8,
        dex: 7,
        tech: 4,
        cool: 6,
        will: 6,
        luck: 6,
        move: 6,
        body: 7,
        emp: 6,
      },
      skills: {
        handgun: 6,
        evasion: 6,
        athletics: 4,
        perception: 5,
      },
      inventory: [
        { name: 'ヘビー・ピストル', qty: 1, price_eb: 100, category: 'weapon' },
        { name: 'ケブラー・ベスト', qty: 1, price_eb: 100, category: 'armor' },
      ],
      cyberware: [
        { name: 'ニューラル・リンク', type: 'neuralware', static_loss: 7 },
      ],
    },
    created_with: {
      method: 'complete_package',
      starting_funds: 2550,
    },
  };

  it('calculates reproducible Adler-32 checksums', () => {
    const cs1 = calculateChecksum('CyberPGM-2026');
    const cs2 = calculateChecksum('CyberPGM-2026');
    const cs3 = calculateChecksum('CyberPGM-2027');
    assert.strictEqual(cs1.length, 8);
    assert.strictEqual(cs1, cs2);
    assert.notStrictEqual(cs1, cs3);
  });

  it('correctly round-trips UTF-8 with Japanese strings via base64', () => {
    const text = 'サイバーパンクRED: 日本語テスト（能力値・技能・サイバーウェア）';
    const b64 = utf8ToBase64(text);
    const decoded = base64ToUtf8(b64);
    assert.strictEqual(decoded, text);
  });

  it('encodes a character file to CPGM code with checksum and prefix', () => {
    const res = encodeCharacterToCode(sampleCharacterFile);
    assert.ok(res.code.startsWith(CPGM_CODE_PREFIX));
    assert.strictEqual(res.checksum.length, 8);
    assert.strictEqual(res.fitsInMailto, true);
    assert.strictEqual(res.warning, undefined);
  });

  it('successfully decodes a valid character code', () => {
    const encoded = encodeCharacterToCode(sampleCharacterFile);
    const decoded = decodeCharacterFromCode(encoded.code);
    assert.strictEqual(decoded.success, true);
    assert.deepStrictEqual(decoded.file, sampleCharacterFile);
  });

  it('detects tampering or corruption in the payload', () => {
    const encoded = encodeCharacterToCode(sampleCharacterFile);
    const corruptedCode = encoded.code.slice(0, -2) + 'XX';
    const decoded = decodeCharacterFromCode(corruptedCode);
    assert.strictEqual(decoded.success, false);
    assert.match(decoded.error || '', /チェックサムが一致しません|Base64 の復元に失敗しました|JSON のパースに失敗しました/);
  });

  it('detects invalid prefix or format', () => {
    const invalidPrefix = decodeCharacterFromCode('INVALID:12345678:abc');
    assert.strictEqual(invalidPrefix.success, false);
    assert.ok(invalidPrefix.error?.includes('不正な接頭辞です'));

    const empty = decodeCharacterFromCode('');
    assert.strictEqual(empty.success, false);
  });

  it('warns when code exceeds mailto limit without truncating data', () => {
    const largeChar: CpgmCharacterFile = {
      ...sampleCharacterFile,
      character: {
        ...sampleCharacterFile.character,
        image_path: 'data:image/png;base64,' + 'A'.repeat(MAILTO_SAFE_LIMIT * 2),
      },
    };
    const res = encodeCharacterToCode(largeChar);
    assert.strictEqual(res.fitsInMailto, false);
    assert.ok(res.warning?.includes('mailto URL の推奨安全上限'));
    assert.ok(res.length > MAILTO_SAFE_LIMIT);

    const decoded = decodeCharacterFromCode(res.code);
    assert.strictEqual(decoded.success, true);
    assert.strictEqual(decoded.file?.character.image_path, largeChar.character.image_path);
  });
});
