// Crockford's Base32 character set
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generate a ULID (Universally Unique Lexicographically Sortable Identifier)
 * 26 characters: 10 chars timestamp + 16 chars randomness
 */
export function ulid(seedTime: number = Date.now()): string {
  let timeStr = '';
  let time = Math.floor(seedTime);
  for (let i = 9; i >= 0; i--) {
    const mod = time % 32;
    timeStr = ENCODING[mod] + timeStr;
    time = Math.floor(time / 32);
  }

  const randomBytes = new Uint8Array(10);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < 10; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }

  let randStr = '';
  for (let i = 0; i < 16; i++) {
    // 80 bits = 16 * 5 bits
    const bitOffset = i * 5;
    const byteIndex = Math.floor(bitOffset / 8);
    const bitInByte = bitOffset % 8;
    let val = 0;
    if (bitInByte <= 3) {
      val = (randomBytes[byteIndex] >> (3 - bitInByte)) & 31;
    } else {
      const firstPart = (randomBytes[byteIndex] << (bitInByte - 3)) & 31;
      const secondPart =
        byteIndex + 1 < 10 ? randomBytes[byteIndex + 1] >> (11 - bitInByte) : 0;
      val = (firstPart | secondPart) & 31;
    }
    randStr += ENCODING[val];
  }

  return timeStr + randStr;
}

export const generateUlid = ulid;
