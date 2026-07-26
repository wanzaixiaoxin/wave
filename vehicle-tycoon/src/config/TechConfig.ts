// ============================================================
// 科技树配置表
// ============================================================

import { TechConfigEntry, SideTechConfigEntry } from '../core/types';

export const TECH_CONFIGS: TechConfigEntry[] = [
  {
    level: 1,
    name: '基础机械',
    description: '解锁属性升级和品质系统',
    unlockCondition: '初始可用',
    goldCost: 100,
    partsCost: 0,
    effect: '解锁属性升级、品质系统',
  },
  {
    level: 2,
    name: '内燃机',
    description: '解锁 T4-T5 车型，品质上限 +1',
    unlockCondition: '生产 5 辆 T3 马车',
    goldCost: 1050,
    partsCost: 30,
    effect: '解锁 T4-T5，品质上限从白板→精良',
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
// 辅助科技（支线）— 主线等级达标后可独立研究，永久被动加成
// ============================================================

export const SIDE_TECH_CONFIGS: SideTechConfigEntry[] = [
  {
    id: 'logistics',
    name: '物流优化',
    description: '订单生成间隔 -20%',
    requiredLevel: 2,
    goldCost: 3000,
    partsCost: 50,
    effect: '订单生成间隔 ×0.8',
  },
  {
    id: 'lean_mfg',
    name: '精益制造',
    description: '造车零件消耗 -25%',
    requiredLevel: 2,
    goldCost: 4000,
    partsCost: 80,
    effect: '造车零件消耗 ×0.75',
  },
  {
    id: 'archive',
    name: '技术档案',
    description: '拆解传承比例 +15%',
    requiredLevel: 3,
    goldCost: 12000,
    partsCost: 200,
    effect: '传承比例 50% → 65%',
  },
  {
    id: 'recycling',
    name: '回收工艺',
    description: '拆解金币返还 30%→50%',
    requiredLevel: 3,
    goldCost: 15000,
    partsCost: 250,
    effect: '拆解金币返还 ×50%',
  },
];

export function getSideTechConfig(id: string): SideTechConfigEntry | undefined {
  return SIDE_TECH_CONFIGS.find(t => t.id === id);
}
