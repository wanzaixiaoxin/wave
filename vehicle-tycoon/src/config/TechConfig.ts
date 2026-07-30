// ============================================================
// 科技树配置表
// ============================================================

import { TechConfigEntry, SideTechConfigEntry } from '../core/types';
import { GAME_CONSTANTS } from './GameConstants';

export const TECH_CONFIGS: TechConfigEntry[] = [
  {
    level: 1,
    name: '基础机械',
    description: '解锁属性升级和规格系统',
    unlockCondition: '初始可用',
    goldCost: 100,
    partsCost: 0,
    effect: '解锁属性升级、规格系统',
  },
  {
    level: 2,
    name: '内燃机',
    description: '解锁 T4-T5 车型，规格上限 +1',
    unlockCondition: '生产 5 辆 T3 马车',
    goldCost: 1050,
    partsCost: 30,
    effect: '解锁 T4-T5，规格上限从经济型→标准型',
  },
  {
    level: 3,
    name: '自动化产线',
    description: '解锁 T6-T7 车型，生产速度 +25%',
    unlockCondition: '生产 5 辆 T5 卡车',
    goldCost: 6000,
    partsCost: 100,
    effect: '解锁 T6-T7，所有生产耗时 ×0.75',
  },
  {
    level: 4,
    name: '全球供应链',
    description: '解锁 T8-T9 车型，产线 +1',
    unlockCondition: '生产 3 辆 T7 轮船',
    goldCost: 18000,
    partsCost: 400,
    effect: '解锁 T8-T9，产线数量 +1',
  },
  {
    level: 5,
    name: '星际物流',
    description: '解锁 T10 星际飞船，全厂收入 +50%',
    unlockCondition: '生产 2 辆 T9 火箭',
    goldCost: 80000,
    partsCost: 1500,
    effect: '解锁 T10，所有车辆收入 ×1.5',
  },
];

export function getTechConfig(level: number): TechConfigEntry | undefined {
  return TECH_CONFIGS.find(t => t.level === level);
}

// ============================================================
// 辅助科技（支线）— 主线等级达标后可逐阶研究（3 阶制），永久被动加成
// 效果逐阶线性叠加，3 阶总效果 ≥ 原一次性效果；费用逐阶递增
// ============================================================

export const SIDE_TECH_CONFIGS: SideTechConfigEntry[] = [
  {
    id: 'logistics',
    name: '物流优化',
    description: '订单生成间隔每阶 -7%',
    requiredLevel: 2,
    maxRank: 3,
    effectKey: 'order_interval',
    valuePerRank: -GAME_CONSTANTS.SIDE_LOGISTICS_INTERVAL_PER_RANK,
    goldCosts: [3000, 6000, 12000],
    partsCosts: [50, 100, 200],
    effect: '订单生成间隔 ×(1 - 7%×阶数)',
  },
  {
    id: 'lean_mfg',
    name: '精益制造',
    description: '造车零件消耗每阶 -9%',
    requiredLevel: 2,
    maxRank: 3,
    effectKey: 'parts_cost',
    valuePerRank: -GAME_CONSTANTS.SIDE_LEAN_PARTS_PER_RANK,
    goldCosts: [4000, 8000, 16000],
    partsCosts: [80, 160, 320],
    effect: '造车零件消耗 ×(1 - 9%×阶数)',
  },
  {
    id: 'archive',
    name: '技术档案',
    description: '出售残值金币每阶 +7%',
    requiredLevel: 3,
    maxRank: 3,
    effectKey: 'residual_value',
    valuePerRank: GAME_CONSTANTS.SIDE_ARCHIVE_RESIDUAL_PER_RANK,
    goldCosts: [12000, 24000, 48000],
    partsCosts: [200, 400, 800],
    effect: '出售残值 +7%×阶数（S2a 残值体系）',
  },
  {
    id: 'recycling',
    name: '回收工艺',
    description: '拆解金币返还每阶 +7%',
    requiredLevel: 3,
    maxRank: 3,
    effectKey: 'scrap_gold',
    valuePerRank: GAME_CONSTANTS.SIDE_RECYCLING_SCRAP_PER_RANK,
    goldCosts: [15000, 30000, 60000],
    partsCosts: [250, 500, 1000],
    effect: '拆解金币返还 = 残值 × (30% + 7%×阶数)',
  },
];

export function getSideTechConfig(id: string): SideTechConfigEntry | undefined {
  return SIDE_TECH_CONFIGS.find(t => t.id === id);
}
