// ============================================================
// 升级倍率统一入口（v1.3）
// 子科技 + 工厂/电站改造对同一 effectKey 的效果在此汇总成单一乘区，
// 所有消费方（Vehicle/Order/Factory/SaveManager）只准读这里，禁止各处自算。
// 叠加规则：同一来源内逐阶/逐级线性（1 + 每阶量 × 阶数），不同来源之间累乘。
// ============================================================

import { GameState, UpgradeEffectKey } from '../core/types';
import { SUB_TECH_CONFIGS, RETROFIT_CONFIGS } from '../config/UpgradeConfig';

/**
 * 统一倍率查询：返回某效果标识的总乘区（无任何升级时为 1）。
 * 例：build_time = (1-0.06×改良工具阶数) × (1-0.08×流水线优化阶数) × (1-0.06×装配工艺等级)
 */
export function getUpgradeMult(state: GameState, effectKey: UpgradeEffectKey): number {
  let mult = 1;
  for (const cfg of SUB_TECH_CONFIGS) {
    if (cfg.effectKey !== effectKey) continue;
    const rank = state.techTree.subTechs[cfg.id] ?? 0;
    if (rank > 0) mult *= 1 + cfg.valuePerRank * rank;
  }
  for (const cfg of RETROFIT_CONFIGS) {
    if (cfg.effectKey !== effectKey) continue;
    const level = state.factory.retrofits[cfg.id] ?? 0;
    if (level > 0) mult *= 1 + cfg.valuePerLevel * level;
  }
  return mult;
}

/** 子科技当前阶数（0-3） */
export function getSubTechRank(state: GameState, id: string): number {
  return state.techTree.subTechs[id] ?? 0;
}

/** 改造线当前等级（0-5） */
export function getRetrofitLevel(state: GameState, id: string): number {
  return state.factory.retrofits[id] ?? 0;
}
