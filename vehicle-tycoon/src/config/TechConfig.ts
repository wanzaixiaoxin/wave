// ============================================================
// 科技树配置表
// ============================================================

import { TechConfigEntry } from '../core/types';

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
    goldCost: 800,
    partsCost: 10,
    effect: '解锁 T4-T5，品质上限从白板→精良',
  },
  {
    level: 3,
    name: '自动化产线',
    description: '解锁 T6-T7 车型，生产速度 +25%',
    unlockCondition: '生产 5 辆 T5 卡车',
    goldCost: 5000,
    partsCost: 50,
    effect: '解锁 T6-T7，所有生产耗时 ×0.75',
  },
  {
    level: 4,
    name: '全球供应链',
    description: '解锁 T8-T9 车型，产线 +1',
    unlockCondition: '生产 3 辆 T7 轮船',
    goldCost: 30000,
    partsCost: 200,
    effect: '解锁 T8-T9，产线数量 +1',
  },
  {
    level: 5,
    name: '星际物流',
    description: '解锁 T10 星际飞船，全厂收入 +50%',
    unlockCondition: '生产 2 辆 T9 火箭',
    goldCost: 200000,
    partsCost: 1000,
    effect: '解锁 T10，所有车辆收入 ×1.5',
  },
];

export function getTechConfig(level: number): TechConfigEntry | undefined {
  return TECH_CONFIGS.find(t => t.level === level);
}
