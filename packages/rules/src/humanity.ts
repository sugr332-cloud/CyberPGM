import { DEFAULT_RULES, RuleConstants } from './constants.js';

export interface InstalledCyberwareItem {
  type?: string;
  staticLoss?: number;
}

/**
 * Calculates maximum humanity according to Cyberpunk RED rules (RULES_CHECK §6).
 * Max Humanity = EMP_max * 10 - sum(losses) + bonus
 * where loss is:
 *   - humanityPerBorgware (default 4) if type is 'borgware'
 *   - humanityPerCyberware (default 2) if staticLoss > 0
 *   - 0 otherwise (e.g. 0 static loss cyberware like Biomonitor)
 */
export function maxHumanity(
  empMax: number,
  installed: InstalledCyberwareItem[],
  bonus: number = 0,
  rules: RuleConstants = DEFAULT_RULES,
): number {
  let lossTotal = 0;
  for (const item of installed) {
    if (item.type?.toLowerCase() === 'borgware') {
      lossTotal += rules.humanityPerBorgware;
    } else if (typeof item.staticLoss === 'number' && item.staticLoss > 0) {
      lossTotal += rules.humanityPerCyberware;
    }
  }

  return empMax * 10 - lossTotal + bonus;
}

/**
 * Calculates current EMP stat based on current humanity and max humanity.
 * Current EMP = floor(min(humanity, maxHumanity) / 10).
 * Never drops below 0.
 */
export function currentEmp(humanity: number, maxHumanityVal: number): number {
  const capped = Math.min(humanity, maxHumanityVal);
  return Math.max(0, Math.floor(capped / 10));
}

/**
 * Calculates humanity value after cyberware installation.
 * loss can be static loss or rolled loss.
 */
export function humanityAfterInstall(humanity: number, loss: number): number {
  return humanity - loss;
}
