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

/**
 * 特质效果描述（与实际生效逻辑保持一致）
 */
export function getTraitDesc(trait: TraitType | null): string {
  if (!trait) return '';
  const tc = getTraitConfig(trait);
  if (!tc) return '';
  switch (tc.effectType) {
    case 'speed': return '订单耗时 -15%';
    case 'cargo': return '收入 +20%';
    case 'crit_rate': return '暴击率 +5%';
    case 'exp': return '经验 +20%';
    case 'income': return '收入 +10%';
    case 'crit_mult': return '暴击 ×3';
    default: return '';
  }
}

export function getQualityLabel(quality: Quality): string {
  switch (quality) {
    case Quality.Gold: return '🟡传说';
    case Quality.Blue: return '🔵精良';
    default: return '⚪白板';
  }
}

// ==================== 随机命名 ====================

const NAME_POOL = [
  '小旋风', '闪电号', '风之子', '铁蛋', '小钢炮',
  '追风者', '滚滚', '霹雳娃', '稳稳号', '大力士',
  '飞驰侠', '小灵通', '金刚', '流星', '土豆号',
];

/**
 * 从名字池随机取 N 个（可排除已占用的名字）
 */
export function pickRandomNames(count: number, exclude: string[] = []): string[] {
  const pool = NAME_POOL.filter(n => !exclude.includes(n));
  const picked: string[] = [];
  while (picked.length < count && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(i, 1)[0]);
  }
  return picked;
}
