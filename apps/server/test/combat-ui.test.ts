import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COMBAT_ACTION_INPUTS, COMBAT_ACTION_KEYS, combatActionHasDice, combatActionInputs } from '@cyberpgm/shared';

describe('shared action input table', () => {
  it('enumerates every action key from the combat action catalogue exactly once', () => {
    const catalog = JSON.parse(readFileSync(resolve(process.cwd(), 'docs/data/combat-actions.ja.json'), 'utf8')) as { actions: Array<{ key: string }> };
    expect([...COMBAT_ACTION_KEYS].sort()).toEqual(catalog.actions.map((a) => a.key).sort());
    expect(new Set(COMBAT_ACTION_KEYS).size).toBe(COMBAT_ACTION_KEYS.length);
  });

  it('only exposes the dice inputs described by each representative action', () => {
    expect(combatActionHasDice('first_aid', 'attack_roll')).toBe(true);
    expect(combatActionHasDice('first_aid', 'defense_roll')).toBe(false);
    expect(combatActionHasDice('first_aid', 'damage_rolls')).toBe(false);
    expect(combatActionHasDice('death_save', 'death_save_roll')).toBe(true);
    expect(combatActionHasDice('death_save', 'attack_roll')).toBe(false);
    expect(combatActionHasDice('ranged', 'attack_roll')).toBe(true);
    expect(combatActionHasDice('ranged', 'damage_rolls')).toBe(true);
    expect(combatActionHasDice('hazard', 'damage_rolls')).toBe(true);
    expect(combatActionHasDice('vehicle_board', 'attack_roll')).toBe(false);
    expect(Object.keys(COMBAT_ACTION_INPUTS).length).toBe(43);
    expect(combatActionInputs('net_action', 'program').dice.map((d) => d.field)).toContain('attack_roll');
    expect(combatActionInputs('hazard', 'electric').dice.map((d) => d.field)).toEqual(['damage_rolls']);
    expect(combatActionInputs('dodge').dice.find((d) => d.field === 'defense_extra')?.who).toBe('actor');
  });
});
