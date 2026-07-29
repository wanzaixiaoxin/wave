// ============================================================
// 出厂参数配置表（原性格特质，S0 语义换皮：机制不变，只改展示名）
// ============================================================

import { TraitType, TraitRarity, TraitConfigEntry } from '../core/types';

export const TRAIT_CONFIGS: TraitConfigEntry[] = [
  {
    type: TraitType.Quick,
    name: '高速',
    rarity: TraitRarity.Normal,
    effectType: 'speed',
    effectValue: 0.85,     // 耗时 ×0.85
    probability: 0.17,
  },
  {
    type: TraitType.Strong,
    name: '重载',
    rarity: TraitRarity.Normal,
    effectType: 'cargo',
    effectValue: 1.20,     // 收入 ×1.20
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
    name: '老练',
    rarity: TraitRarity.Normal,
    effectType: 'exp',
    effectValue: 1.20,     // 经验 ×1.20
    probability: 0.17,
  },
  {
    type: TraitType.Wealth,
    name: '节能',
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
 * 根据概率表随机抽取一个出厂参数
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
 * 获取出厂参数配置
 */
export function getTraitConfig(type: TraitType): TraitConfigEntry | undefined {
  return TRAIT_CONFIGS.find(t => t.type === type);
}
