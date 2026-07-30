// ============================================================
// 车辆配置表 — 所有 Tier 的静态数据
//
// 数值节奏设计（经 scripts/sim.ts 模拟器校准）：
// - basePrice 约 ×2.7/tier 增长（收入端）
// - buildCost ≈ basePrice × 回本单数（1→20 递增，成本端 ×4.3/tier）
// - 收入增速 < 成本增速 → 每 tier 停留时间递增，避免滚雪球式膨胀
//
// 解锁矩阵（M9 时代差异化依赖，逐车型声明于 unlock 字段）：
// - 手工作坊时代（T2/T3）：靠产量（手艺积累）
// - 工业时代（T4-T7）：靠科技 + 工厂等级（产线设备），声望自 T4 起贯穿
// - 电气/航天时代（T8-T10）：靠科技 + 电站等级（能源与精密制造）+ 声望
// ============================================================

import { GameState, VehicleConfigEntry } from '../core/types';

export const VEHICLE_CONFIGS: VehicleConfigEntry[] = [
  {
    tier: 1,
    name: '独轮车',
    emoji: '🛴',
    basePrice: 10,
    buildCost: 10,
    buildTime: 2,
    parkingSpaces: 1,
    partsCost: 0,
    unlock: {},
  },
  {
    tier: 2,
    name: '自行车',
    emoji: '🚲',
    basePrice: 27,
    buildCost: 28,
    buildTime: 4,
    parkingSpaces: 1,
    partsCost: 0,
    unlock: { produceTier: 1, produceCount: 3 },
  },
  {
    tier: 3,
    name: '马车',
    emoji: '🐴',
    basePrice: 73,
    buildCost: 126,
    buildTime: 6,
    parkingSpaces: 1,
    partsCost: 0,
    unlock: { produceTier: 2, produceCount: 3 },
  },
  {
    tier: 4,
    name: '小汽车',
    emoji: '🚗',
    basePrice: 197,
    buildCost: 414,
    buildTime: 10,
    parkingSpaces: 2,
    partsCost: 20,
    unlock: { techLevel: 2, reputation: 100 },
  },
  {
    tier: 5,
    name: '卡车',
    emoji: '🚛',
    basePrice: 532,
    buildCost: 1100,
    buildTime: 17,
    parkingSpaces: 2,
    partsCost: 60,
    unlock: { techLevel: 2, factoryLevel: 3, reputation: 250 },
  },
  {
    tier: 6,
    name: '火车',
    emoji: '🚂',
    basePrice: 1436,
    buildCost: 3200,
    buildTime: 30,
    parkingSpaces: 2,
    partsCost: 200,
    unlock: { techLevel: 3, factoryLevel: 4, reputation: 500 },
  },
  {
    tier: 7,
    name: '轮船',
    emoji: '🚢',
    basePrice: 3877,
    buildCost: 10000,
    buildTime: 42,
    parkingSpaces: 3,
    partsCost: 600,
    unlock: { techLevel: 3, factoryLevel: 5, reputation: 1000 },
  },
  {
    tier: 8,
    name: '飞机',
    emoji: '✈️',
    basePrice: 10468,
    buildCost: 17000,
    buildTime: 75,
    parkingSpaces: 3,
    partsCost: 2000,
    unlock: { techLevel: 4, powerLevel: 4, reputation: 2000 },
  },
  {
    tier: 9,
    name: '火箭',
    emoji: '🚀',
    basePrice: 28264,
    buildCost: 45000,
    buildTime: 120,
    parkingSpaces: 4,
    partsCost: 4000,
    unlock: { techLevel: 4, factoryLevel: 7, powerLevel: 6, reputation: 5000 },
  },
  {
    tier: 10,
    name: '星际飞船',
    emoji: '🛸',
    basePrice: 76313,
    buildCost: 130000,
    buildTime: 200,
    parkingSpaces: 4,
    partsCost: 12000,
    unlock: { techLevel: 5, factoryLevel: 9, powerLevel: 8, reputation: 6000 },
  },
];

/**
 * 按 Tier 查找车辆配置
 */
export function getVehicleConfig(tier: number): VehicleConfigEntry | undefined {
  return VEHICLE_CONFIGS.find(c => c.tier === tier);
}

/**
 * 时代差异化解锁判定（M9）— 单一数据源：
 * createVehicle 入队校验、造车下拉置灰、提示条过滤全部走这里。
 * 返回所有未满足条件的可读描述（进行中的条件带「当前/目标」进度），空数组 = 可解锁。
 */
export function getUnmetRequirements(state: GameState, tier: number): string[] {
  const config = getVehicleConfig(tier);
  if (!config) return ['未知车型'];
  const u = config.unlock;
  const unmet: string[] = [];

  if (u.techLevel && state.techTree.currentLevel < u.techLevel) {
    unmet.push(`需 科技 L${u.techLevel}`);
  }
  if (u.factoryLevel && state.factory.level < u.factoryLevel) {
    unmet.push(`需 工厂 Lv.${state.factory.level}/${u.factoryLevel}`);
  }
  if (u.powerLevel && state.factory.powerLevel < u.powerLevel) {
    unmet.push(`需 电站 Lv.${state.factory.powerLevel}/${u.powerLevel}`);
  }
  if (u.reputation && state.resources.reputation < u.reputation) {
    const cur = Math.floor(state.resources.reputation);
    unmet.push(cur > 0 ? `需 声望 ${cur.toLocaleString()}/${u.reputation.toLocaleString()}` : `需 声望 ${u.reputation.toLocaleString()}`);
  }
  if (u.produceTier && u.produceCount) {
    const cur = state.techTree.producedCount[u.produceTier - 1] ?? 0;
    if (cur < u.produceCount) {
      const target = getVehicleConfig(u.produceTier);
      unmet.push(cur > 0
        ? `需 生产 ${target?.name ?? 'T' + u.produceTier} ${cur}/${u.produceCount} 辆`
        : `需 生产 ${target?.name ?? 'T' + u.produceTier} ×${u.produceCount}`);
    }
  }
  return unmet;
}

/**
 * 获取已解锁的车辆配置（时代差异化矩阵全维度判定）
 */
export function getUnlockedConfigs(state: GameState): VehicleConfigEntry[] {
  return VEHICLE_CONFIGS.filter(c => getUnmetRequirements(state, c.tier).length === 0);
}

/**
 * 车库当前占格数（S2a 占格数口径）：现有车辆 parkingSpaces 之和 + 建造队列预留。
 * 容量判定（建造入队 / 以旧换新 / 扩建提示）统一走这里，单一数据源。
 */
export function getOccupiedSpaces(state: GameState): number {
  let used = 0;
  for (const v of state.garage.vehicles) {
    used += getVehicleConfig(v.tier)?.parkingSpaces ?? 1;
  }
  for (const j of state.garage.buildQueue) {
    used += getVehicleConfig(j.tier)?.parkingSpaces ?? 1;
  }
  return used;
}

/** 单车型占格数（缺省 1 格） */
export function getParkingSpaces(tier: number): number {
  return getVehicleConfig(tier)?.parkingSpaces ?? 1;
}
