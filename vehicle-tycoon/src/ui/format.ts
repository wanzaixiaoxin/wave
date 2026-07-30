// ============================================================
// UI 展示辅助 — 出厂参数名、规格名等格式化
// ============================================================

import { TraitType, Quality } from '../core/types';
import { getTraitConfig } from '../config/TraitConfig';

export function getTraitName(trait: TraitType | null): string {
  if (!trait) return '无';
  const tc = getTraitConfig(trait);
  return tc ? tc.name : trait;
}

/**
 * 出厂参数效果描述（与实际生效逻辑保持一致）
 */
export function getTraitDesc(trait: TraitType | null): string {
  if (!trait) return '';
  const tc = getTraitConfig(trait);
  if (!tc) return '';
  switch (tc.effectType) {
    case 'speed': return '订单耗时 -15%';
    case 'cargo': return '收入 +20%';
    case 'crit_rate': return '暴击率 +5%';
    case 'breakin': return '磨合增速 +20%';
    case 'income': return '收入 +10%';
    case 'crit_mult': return '暴击 ×3';
    default: return '';
  }
}

export function getQualityLabel(quality: Quality): string {
  switch (quality) {
    case Quality.Gold: return '🟡工业型';
    case Quality.Blue: return '🔵标准型';
    default: return '⚪经济型';
  }
}
