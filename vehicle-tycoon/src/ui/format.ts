// ============================================================
// UI 展示辅助 — 特质名、品质名等格式化
// ============================================================

import { TraitType, Quality } from '../core/types';
import { getTraitConfig } from '../config/TraitConfig';

export function getTraitName(trait: TraitType | null): string {
  if (!trait) return '无';
  const tc = getTraitConfig(trait);
  return tc ? tc.name : trait;
}

export function getQualityLabel(quality: Quality): string {
  switch (quality) {
    case Quality.Gold: return '🟡传说';
    case Quality.Blue: return '🔵精良';
    default: return '⚪白板';
  }
}
