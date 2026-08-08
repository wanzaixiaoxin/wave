// ============================================================
// S4 城市基建项目配置 — 零件/能源/声望/金币的长期消耗点（社区中心式分批捐赠）
// 效果常量在 GameConstants.ts（CITY_PROJECT_*），本表只定义项目身份与总需求
// ============================================================

export interface CityProjectCost {
  gold?: number;
  parts?: number;
  energy?: number;
  rep?: number;
}

export interface CityProjectEntry {
  id: string;
  name: string;
  emoji: string;
  cost: CityProjectCost;   // 总需求（分批投入，投满即建成）
  effectDesc: string;      // 给玩家看的效果说明
}

export const CITY_PROJECTS: CityProjectEntry[] = [
  {
    id: 'logistics_hub',
    name: '物流集散点',
    emoji: '📦',
    cost: { parts: 20000, gold: 20000 },
    effectDesc: '每单交付 +10% 运输单位',
  },
  {
    id: 'ring_expressway',
    name: '环城快速路网',
    emoji: '🛣️',
    cost: { parts: 100000, energy: 15000 },
    effectDesc: '拥堵耗时惩罚 ×1.15→×1.1 · 城市容忍度 +25%',
  },
  {
    id: 'smart_dispatch',
    name: '智能调度中心',
    emoji: '🛰️',
    cost: { parts: 250000, energy: 25000, rep: 8000 },
    effectDesc: '订单槽 +1（对冲瘫痪边缘的 -1）',
  },
  {
    id: 'intercity_corridor',
    name: '城际运输走廊',
    emoji: '🚄',
    cost: { parts: 800000, energy: 40000, gold: 30000000 },
    effectDesc: '全局收入 +15%',
  },
];

export function getCityProject(id: string): CityProjectEntry | undefined {
  return CITY_PROJECTS.find(p => p.id === id);
}
