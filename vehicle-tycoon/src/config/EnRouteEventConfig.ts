// ============================================================
// 路上事件配置表（M1）— 派单后途中触发的 2-3 选 1 微决策
// 每个事件都是「时间 vs 金钱 vs 磨损」的三角取舍，无绝对最优解
// ============================================================

import { EnRouteEventConfigEntry } from '../core/types';

export const EN_ROUTE_EVENT_CONFIGS: EnRouteEventConfigEntry[] = [
  {
    id: 'road_work',
    name: '前方修路',
    emoji: '🚧',
    description: '前方的道路正在施工，通行缓慢，需要决定怎么通过。',
    weight: 20,
    choices: [
      { label: '绕行', summary: '+15s', durationDeltaSec: 15 },
      { label: '硬闯', summary: '磨损 +10', wearDelta: 10 },
      { label: '等一等', summary: '+8s，无事发生', durationDeltaSec: 8, isDefault: true },
    ],
  },
  {
    id: 'hitchhiker',
    name: '顺风车客',
    emoji: '🙋',
    description: '路边有人招手想搭个顺风车，愿意付一笔不菲的小费。',
    weight: 20,
    choices: [
      { label: '带上', summary: '收入 +30%，+10s', rewardMult: 1.3, durationDeltaSec: 10 },
      { label: '拒载', summary: '无事发生', isDefault: true },
    ],
  },
  {
    id: 'flat_tire',
    name: '爆胎',
    emoji: '🛞',
    description: '轮胎压到钉子爆胎了，得赶紧处理。',
    weight: 15,
    choices: [
      { label: '换胎', summary: '零件 -2，继续', partsCost: 2 },
      { label: '硬开', summary: '磨损 +15', wearDelta: 15 },
      { label: '叫救援', summary: '+20s', durationDeltaSec: 20, isDefault: true },
    ],
  },
  {
    id: 'good_weather',
    name: '好天气',
    emoji: '🌤️',
    description: '风和日丽，路况极佳，是个赶路的好日子。',
    weight: 15,
    choices: [
      { label: '赶路', summary: '耗时 -15%', durationMult: 0.85 },
      { label: '慢行', summary: '亲密度 +5', intimacyGain: 5, isDefault: true },
    ],
  },
  {
    id: 'police_check',
    name: '交警抽查',
    emoji: '🚨',
    description: '交警设卡抽查过往车辆，需要配合检查。',
    weight: 15,
    choices: [
      { label: '配合', summary: '+10s', durationDeltaSec: 10 },
      { label: '塞红包', summary: '金币 -本单10%', goldCostPct: 0.1 },
      { label: '出示年检', summary: '无事发生', requiredDurability: 4, isDefault: true },
    ],
  },
  {
    id: 'oil_price',
    name: '油价上涨',
    emoji: '⛽',
    description: '油价突然上涨，加油还是不加油，这是个问题。',
    weight: 15,
    choices: [
      { label: '加好油', summary: '金币 -5%，耗时 -10%', goldCostPct: 0.05, durationMult: 0.9 },
      { label: '凑合开', summary: '磨损 +5', wearDelta: 5, isDefault: true },
    ],
  },
];

/**
 * 获取路上事件配置
 */
export function getEnRouteEventConfig(id: string): EnRouteEventConfigEntry | undefined {
  return EN_ROUTE_EVENT_CONFIGS.find(e => e.id === id);
}

/**
 * 按权重从事件池随机抽取一个事件
 */
export function rollEnRouteEvent(): EnRouteEventConfigEntry {
  const totalWeight = EN_ROUTE_EVENT_CONFIGS.reduce((sum, e) => sum + e.weight, 0);
  let rand = Math.random() * totalWeight;
  for (const config of EN_ROUTE_EVENT_CONFIGS) {
    rand -= config.weight;
    if (rand < 0) return config;
  }
  // fallback（理论上不会执行到这里）
  return EN_ROUTE_EVENT_CONFIGS[0];
}
