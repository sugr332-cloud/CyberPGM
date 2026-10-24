import { CpgmCharacterFile, CpgmCharacterFileSchema } from './creation.js';

/**
 * テキストコード用のチェックサム（Adler-32）を計算する。
 * 外部依存なしで高速かつ破損検出に十分な精度を提供する。
 */
export function calculateChecksum(str: string): string {
  let a = 1;
  let b = 0;
  const MOD_ADLER = 65521;
  const utf8Bytes: number[] = [];

  // UTF-8 バイト列への変換
  for (let i = 0; i < str.length; i++) {
    let charcode = str.charCodeAt(i);
    if (charcode < 0x80) {
      utf8Bytes.push(charcode);
    } else if (charcode < 0x800) {
      utf8Bytes.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      utf8Bytes.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
    } else {
      // サロゲートペア
      i++;
      charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      utf8Bytes.push(
        0xf0 | (charcode >> 18),
        0x80 | ((charcode >> 12) & 0x3f),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    }
  }

  for (let i = 0; i < utf8Bytes.length; i++) {
    a = (a + utf8Bytes[i]) % MOD_ADLER;
    b = (b + a) % MOD_ADLER;
  }

  const checksum = (b << 16) | a;
  // 8桁の16進数文字列 (符号なし32bit)
  return (checksum >>> 0).toString(16).padStart(8, '0');
}

/**
 * UTF-8 文字列を Base64 にエンコード（Node.js とブラウザ双方で安全に動作）
 */
export function utf8ToBase64(str: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf-8').toString('base64');
  }
  // ブラウザ環境 (window.btoa + encodeURIComponent)
  return btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => {
      return String.fromCharCode(parseInt(p1, 16));
    })
  );
}

/**
 * Base64 を UTF-8 文字列にデコード（Node.js とブラウザ双方で安全に動作）
 */
export function base64ToUtf8(base64: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(base64, 'base64').toString('utf-8');
  }
  // ブラウザ環境 (window.atob + decodeURIComponent)
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(bytes);
}

export const CPGM_CODE_PREFIX = 'CPGM1:';
// mailto: URL の安全上限（ブラウザ・OS・メーラーの一般的な安全マージン）
export const MAILTO_SAFE_LIMIT = 1800;

export interface EncodedCharacterCodeResult {
  code: string;
  checksum: string;
  length: number;
  fitsInMailto: boolean;
  warning?: string;
}

export interface DecodeCharacterCodeResult {
  success: boolean;
  file?: CpgmCharacterFile;
  error?: string;
}

/**
 * CpgmCharacterFile を破損検出チェックサム付きのテキストコードにエンコードする。
 * データを黙って切り詰めることはせず、mailto 長さを超える場合は明示的な warning を返す。
 */
export function encodeCharacterToCode(characterFile: CpgmCharacterFile): EncodedCharacterCodeResult {
  const jsonStr = JSON.stringify(characterFile);
  const checksum = calculateChecksum(jsonStr);
  const base64 = utf8ToBase64(jsonStr);
  const code = `${CPGM_CODE_PREFIX}${checksum}:${base64}`;

  const length = code.length;
  const fitsInMailto = length <= MAILTO_SAFE_LIMIT;

  let warning: string | undefined;
  if (!fitsInMailto) {
    warning = `テキストコードの文字数（${length}文字）が mailto URL の推奨安全上限（${MAILTO_SAFE_LIMIT}文字）を超えています。メーラー直接起動ではなく、ファイル保存またはメール本文へのテキスト貼り付けを行ってください。`;
  }

  return {
    code,
    checksum,
    length,
    fitsInMailto,
    warning,
  };
}

/**
 * テキストコードから CpgmCharacterFile を復元する。
 * チェックサムによる破損検出、フォーマット検証、スキーマ検証を行う。
 */
export function decodeCharacterFromCode(rawInput: string): DecodeCharacterCodeResult {
  if (!rawInput || typeof rawInput !== 'string') {
    return { success: false, error: '入力が空または文字列ではありません。' };
  }

  const trimmed = rawInput.trim();
  if (!trimmed.startsWith(CPGM_CODE_PREFIX)) {
    return {
      success: false,
      error: `不正な接頭辞です。「${CPGM_CODE_PREFIX}」で始まるテキストコードを指定してください。`,
    };
  }

  const payloadPart = trimmed.slice(CPGM_CODE_PREFIX.length);
  const colonIdx = payloadPart.indexOf(':');
  if (colonIdx === -1) {
    return { success: false, error: 'コードの構造が不正です（チェックサム区切りが見つかりません）。' };
  }

  const expectedChecksum = payloadPart.slice(0, colonIdx);
  const base64Data = payloadPart.slice(colonIdx + 1);

  if (!expectedChecksum || !base64Data) {
    return { success: false, error: 'チェックサムまたはデータ本体が欠落しています。' };
  }

  let jsonStr: string;
  try {
    jsonStr = base64ToUtf8(base64Data);
  } catch (err: any) {
    return { success: false, error: `Base64 の復元に失敗しました: ${err.message || 'データが破損しています'}` };
  }

  // チェックサム検証
  const actualChecksum = calculateChecksum(jsonStr);
  if (actualChecksum !== expectedChecksum) {
    return {
      success: false,
      error: `チェックサムが一致しません（データが破損または一部改ざんされています）。期待値: ${expectedChecksum}, 実際値: ${actualChecksum}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err: any) {
    return { success: false, error: `JSON のパースに失敗しました: ${err.message || 'データ形式が不正です'}` };
  }

  const validation = CpgmCharacterFileSchema.safeParse(parsed);
  if (!validation.success) {
    const errorDetails = validation.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    return {
      success: false,
      error: `キャラクターデータのスキーマ検証に失敗しました: ${errorDetails}`,
    };
  }

  return {
    success: true,
    file: validation.data,
  };
}
