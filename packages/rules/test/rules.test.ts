import { describe, it, expect } from 'vitest';
import { calculateInitiative } from '../src/index.js';

describe('Rules engine scaffold', () => {
  it('calculates initiative correctly (REF + 1d10)', () => {
    // Reference: Cyberpunk RED Core Rulebook p. 126
    const result = calculateInitiative({ ref: 7, roll1d10: 6 });
    expect(result.total).toBe(13);
    expect(result.ref).toBe(7);
    expect(result.roll).toBe(6);
  });
});
