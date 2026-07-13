// ============================================================
// 性格特质配置表
// ============================================================

import { TraitType, TraitRarity, TraitConfigEntry } from '../core/types';

export const TRAIT_CONFIGS: TraitConfigEntry[] = [
  {
    type: TraitType.Quick,
    name: '勤快',
    rarity: TraitRarity.Normal,
    effectType: 'speed',
    effectValue: 0.85,     // 耗时 ×0.85
    probability: 0.17,
  },
  {
    type: TraitType.Strong,
    name: '强壮',
    rarity: TraitRarity.Normal,
    effectType: 'cargo',
    effectValue: 1.20,     // 载货 ×1.20
    probability: 0.17,
  },
  {
    type: TraitType.Precise,
    name: '精准',
    rarity: TraitRarity.Normal,
    effectType: 'crit_rate',
    effectValue: 0.05,     // 暴击率 +5%
    probability: 0.17,
  },
  {
    type: TraitType.Smart,
    name: '聪明',
    rarity: TraitRarity.Normal,
    effectType: 'exp',
    effectValue: 1.20,     // 经验 ×1.20
    probability: 0.17,
  },
  {
    type: TraitType.Wealth,
    name: '招财',
    rarity: TraitRarity.Normal,
    effectType: 'income',
    effectValue: 1.10,     // 收入 ×1.10
    probability: 0.17,
  },
  {
    type: TraitType.Lucky,
    name: '幸运',
    rarity: TraitRarity.Rare,
    effectType: 'crit_mult',
    effectValue: 3.0,      // 暴击时 ×3
    probability: 0.15,
  },
];

/**
 * 根据概率表随机抽取一个特质
 */
export function rollTrait(): TraitType {
  const rand = Math.random();
  let cumulative = 0;

  // 概率总和应为 1.0
  for (const config of TRAIT_CONFIGS) {
    cumulative += config.probability;
    if (rand < cumulative) {
      return config.type;
    }
  }

  // fallback（理论上不会执行到这里）
  return TraitType.Quick;
}

/**
 * 获取特质配置
 */
export function getTraitConfig(type: TraitType): TraitConfigEntry | undefined {
  return TRAIT_CONFIGS.find(t => t.type === type);
}
