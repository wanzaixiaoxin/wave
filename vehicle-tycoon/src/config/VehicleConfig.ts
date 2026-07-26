// ============================================================
// 车辆配置表 — 所有 Tier 的静态数据
//
// 数值节奏设计（经 scripts/sim.ts 模拟器校准）：
// - basePrice 约 ×2.7/tier 增长（收入端）
// - buildCost ≈ basePrice × 回本单数（1→20 递增，成本端 ×4.3/tier）
// - 收入增速 < 成本增速 → 每 tier 停留时间递增，避免滚雪球式膨胀
// ============================================================

import { VehicleConfigEntry, TalentType } from '../core/types';

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
    unlockCondition: { type: 'initial' },
    evolvedName: '涡轮独轮车',
    talentType: TalentType.Agile,
    talentDesc: '订单完成速度 +20%',
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
    unlockCondition: { type: 'produce_count', targetTier: 1, targetCount: 3 },
    evolvedName: '电动自行车',
    talentType: TalentType.Endurance,
    talentDesc: '可连续接 2 单',
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
    unlockCondition: { type: 'produce_count', targetTier: 2, targetCount: 3 },
    evolvedName: '豪华马车',
    talentType: TalentType.Noble,
    talentDesc: '长途/贵重订单收入 +30%',
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
    unlockCondition: { type: 'tech_level', techLevel: 2 },
    evolvedName: '跑车',
    talentType: TalentType.Speedster,
    talentDesc: '短途订单收入 ×2',
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
    unlockCondition: { type: 'produce_count', targetTier: 4, targetCount: 4 },
    evolvedName: '擎天柱',
    talentType: TalentType.Hauler,
    talentDesc: '单次收入 +50%',
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
    unlockCondition: { type: 'tech_level', techLevel: 3 },
    evolvedName: '磁悬浮列车',
    talentType: TalentType.Convoy,
    talentDesc: '同型车每多 1 辆 +5% 收入',
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
    unlockCondition: { type: 'produce_count', targetTier: 6, targetCount: 3 },
    evolvedName: '豪华邮轮',
    talentType: TalentType.Explorer,
    talentDesc: '每次订单额外获得零件',
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
    unlockCondition: { type: 'tech_level', techLevel: 4 },
    evolvedName: '超音速客机',
    talentType: TalentType.Network,
    talentDesc: '所有订单刷新速度 +30%',
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
    unlockCondition: { type: 'produce_count', targetTier: 8, targetCount: 2 },
    evolvedName: '可回收重型火箭',
    talentType: TalentType.Stellar,
    talentDesc: '零件产出 +50%',
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
    unlockCondition: { type: 'tech_level', techLevel: 5 },
    evolvedName: '超光速飞船',
    talentType: TalentType.Warp,
    talentDesc: '全车型收入 +15%（最多叠 2 层）',
  },
];

/**
 * 按 Tier 查找车辆配置
 */
export function getVehicleConfig(tier: number): VehicleConfigEntry | undefined {
  return VEHICLE_CONFIGS.find(c => c.tier === tier);
}

/**
 * 获取已解锁的车辆配置（根据科技等级和产量计数）
 */
export function getUnlockedConfigs(
  techLevel: number,
  producedCounts: number[]
): VehicleConfigEntry[] {
  return VEHICLE_CONFIGS.filter(config => {
    const cond = config.unlockCondition;
    switch (cond.type) {
      case 'initial':
        return true;
      case 'tech_level':
        return techLevel >= (cond.techLevel ?? 99);
      case 'produce_count': {
        const count = cond.targetTier ? producedCounts[cond.targetTier - 1] ?? 0 : 0;
        return count >= (cond.targetCount ?? 0);
      }
      default:
        return false;
    }
  });
}
