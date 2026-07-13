// ============================================================
// 车辆配置表 — 所有 Tier 的静态数据
// ============================================================

import { VehicleConfigEntry, TalentType } from '../core/types';

export const VEHICLE_CONFIGS: VehicleConfigEntry[] = [
  {
    tier: 1,
    name: '独轮车',
    emoji: '🛴',
    basePrice: 10,
    buildCost: 5,
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
    basePrice: 45,
    buildCost: 20,
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
    basePrice: 180,
    buildCost: 80,
    buildTime: 7,
    parkingSpaces: 1,
    partsCost: 0,
    unlockCondition: { type: 'produce_count', targetTier: 2, targetCount: 3 },
    evolvedName: '豪华马车',
    talentType: TalentType.Noble,
    talentDesc: '高品质订单优先派给此车',
  },
  {
    tier: 4,
    name: '小汽车',
    emoji: '🚗',
    basePrice: 800,
    buildCost: 350,
    buildTime: 12,
    parkingSpaces: 2,
    partsCost: 5,
    unlockCondition: { type: 'tech_level', techLevel: 2 },
    evolvedName: '跑车',
    talentType: TalentType.Speedster,
    talentDesc: '短途订单收入 ×2',
  },
  {
    tier: 5,
    name: '卡车',
    emoji: '🚛',
    basePrice: 3200,
    buildCost: 1500,
    buildTime: 20,
    parkingSpaces: 2,
    partsCost: 20,
    unlockCondition: { type: 'produce_count', targetTier: 4, targetCount: 4 },
    evolvedName: '擎天柱',
    talentType: TalentType.Hauler,
    talentDesc: '单次收入 +50%',
  },
  {
    tier: 6,
    name: '火车',
    emoji: '🚂',
    basePrice: 15000,
    buildCost: 7000,
    buildTime: 35,
    parkingSpaces: 2,
    partsCost: 80,
    unlockCondition: { type: 'tech_level', techLevel: 3 },
    evolvedName: '磁悬浮列车',
    talentType: TalentType.Convoy,
    talentDesc: '同型车每多 1 辆 +5% 收入',
  },
  {
    tier: 7,
    name: '轮船',
    emoji: '🚢',
    basePrice: 60000,
    buildCost: 28000,
    buildTime: 50,
    parkingSpaces: 3,
    partsCost: 300,
    unlockCondition: { type: 'produce_count', targetTier: 6, targetCount: 3 },
    evolvedName: '豪华邮轮',
    talentType: TalentType.Explorer,
    talentDesc: '每次订单额外获得零件',
  },
  {
    tier: 8,
    name: '飞机',
    emoji: '✈️',
    basePrice: 280000,
    buildCost: 130000,
    buildTime: 75,
    parkingSpaces: 3,
    partsCost: 1200,
    unlockCondition: { type: 'tech_level', techLevel: 4 },
    evolvedName: '超音速客机',
    talentType: TalentType.Network,
    talentDesc: '所有订单刷新速度 +30%',
  },
  {
    tier: 9,
    name: '火箭',
    emoji: '🚀',
    basePrice: 1500000,
    buildCost: 700000,
    buildTime: 120,
    parkingSpaces: 4,
    partsCost: 5000,
    unlockCondition: { type: 'produce_count', targetTier: 8, targetCount: 2 },
    evolvedName: '可回收重型火箭',
    talentType: TalentType.Stellar,
    talentDesc: '零件产出 +50%',
  },
  {
    tier: 10,
    name: '星际飞船',
    emoji: '🛸',
    basePrice: 12000000,
    buildCost: 5500000,
    buildTime: 200,
    parkingSpaces: 4,
    partsCost: 30000,
    unlockCondition: { type: 'tech_level', techLevel: 5 },
    evolvedName: '超光速飞船',
    talentType: TalentType.Warp,
    talentDesc: '全车型收入 +15%（可叠加）',
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
