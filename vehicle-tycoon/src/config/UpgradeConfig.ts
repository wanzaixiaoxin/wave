// ============================================================
// 升级深度配置（v1.3）— 子科技（主线每级挂 2 项 × 3 阶）+ 工厂/电站改造线
// 所有效果通过 UpgradeSystem.getUpgradeMult(state, effectKey) 统一查询
// ============================================================

import { SubTechConfigEntry, RetrofitConfigEntry } from '../core/types';

// ==================== 子科技（走研究槽，费用/耗时逐阶递增 30/60/120s） ====================

export const SUB_TECH_CONFIGS: SubTechConfigEntry[] = [
  // ---- L1 基础机械 ----
  {
    id: 'better_tools',
    mainLevel: 1,
    name: '改良工具',
    effectKey: 'build_time',
    valuePerRank: -0.06,
    goldCosts: [80, 160, 320],
    partsCosts: [0, 0, 0],
    researchTimes: [30, 60, 120],
    effectDesc: '建造耗时 -6%/阶',
  },
  {
    id: 'craft_legacy',
    mainLevel: 1,
    name: '手工艺传承',
    effectKey: 'first_produce_rep',
    valuePerRank: 0.20,
    goldCosts: [80, 160, 320],
    partsCosts: [0, 0, 0],
    researchTimes: [30, 60, 120],
    effectDesc: '首台下线声望 +20%/阶',
  },
  // ---- L2 内燃机 ----
  {
    id: 'efficient_combustion',
    mainLevel: 2,
    name: '高效燃烧',
    effectKey: 'order_energy',
    valuePerRank: -0.08,
    goldCosts: [500, 1000, 2000],
    partsCosts: [15, 30, 60],
    researchTimes: [30, 60, 120],
    effectDesc: '每单耗电 -8%/阶',
  },
  {
    id: 'brand_ops',
    mainLevel: 2,
    name: '品牌运营',
    effectKey: 'rep_gain',
    valuePerRank: 0.10,
    goldCosts: [500, 1000, 2000],
    partsCosts: [15, 30, 60],
    researchTimes: [30, 60, 120],
    effectDesc: '声望获取 +10%/阶',
  },
  // ---- L3 自动化产线 ----
  {
    id: 'pipeline_opt',
    mainLevel: 3,
    name: '流水线优化',
    effectKey: 'build_time',
    valuePerRank: -0.08,
    goldCosts: [3000, 6000, 12000],
    partsCosts: [50, 100, 200],
    researchTimes: [30, 60, 120],
    effectDesc: '建造耗时 -8%/阶',
  },
  {
    id: 'quality_control',
    mainLevel: 3,
    name: '质控体系',
    effectKey: 'wear',
    valuePerRank: -0.10,
    goldCosts: [3000, 6000, 12000],
    partsCosts: [50, 100, 200],
    researchTimes: [30, 60, 120],
    effectDesc: '磨损累积 -10%/阶',
  },
  // ---- L4 全球供应链 ----
  {
    id: 'logistics_network',
    mainLevel: 4,
    name: '物流网络',
    effectKey: 'order_duration',
    valuePerRank: -0.05,
    goldCosts: [9000, 18000, 36000],
    partsCosts: [150, 300, 600],
    researchTimes: [30, 60, 120],
    effectDesc: '订单耗时 -5%/阶',
  },
  {
    id: 'bulk_purchase',
    mainLevel: 4,
    name: '批量采购',
    effectKey: 'build_cost',
    valuePerRank: -0.08,
    goldCosts: [9000, 18000, 36000],
    partsCosts: [150, 300, 600],
    researchTimes: [30, 60, 120],
    effectDesc: '造车金币 -8%/阶',
  },
  // ---- L5 星际物流 ----
  {
    id: 'warp_engine',
    mainLevel: 5,
    name: '曲率引擎',
    effectKey: 'order_energy',
    valuePerRank: -0.10,
    goldCosts: [40000, 80000, 160000],
    partsCosts: [400, 800, 1600],
    researchTimes: [30, 60, 120],
    effectDesc: '每单耗电 -10%/阶',
  },
  {
    id: 'deep_space_net',
    mainLevel: 5,
    name: '深空网络',
    effectKey: 'rep_gain',
    valuePerRank: 0.15,
    goldCosts: [40000, 80000, 160000],
    partsCosts: [400, 800, 1600],
    researchTimes: [30, 60, 120],
    effectDesc: '声望获取 +15%/阶',
  },
];

export function getSubTechConfig(id: string): SubTechConfigEntry | undefined {
  return SUB_TECH_CONFIGS.find(t => t.id === id);
}

/** 某主线等级下挂的子科技 */
export function getSubTechsOfLevel(mainLevel: number): SubTechConfigEntry[] {
  return SUB_TECH_CONFIGS.filter(t => t.mainLevel === mainLevel);
}

// ==================== 工厂/电站改造线（即时购买，不占研究槽） ====================

export const RETROFIT_CONFIGS: RetrofitConfigEntry[] = [
  // ---- 工厂 3 线 × 5 级（金币 + 零件） ----
  {
    id: 'automation',
    kind: 'factory',
    name: '产线自动化',
    effectKey: 'parts_rate',
    valuePerLevel: 0.15,
    maxLevel: 5,
    goldBase: 1000, goldGrowth: 2.5,
    partsBase: 60, partsGrowth: 2.2,
    effectDesc: '零件速率 +15%/级',
  },
  {
    id: 'lean_production',
    kind: 'factory',
    name: '精益生产',
    effectKey: 'build_cost',
    valuePerLevel: -0.06,
    maxLevel: 5,
    goldBase: 1200, goldGrowth: 2.5,
    partsBase: 80, partsGrowth: 2.2,
    effectDesc: '造车金币 -6%/级',
  },
  {
    id: 'assembly',
    kind: 'factory',
    name: '装配工艺',
    effectKey: 'build_time',
    valuePerLevel: -0.06,
    maxLevel: 5,
    goldBase: 1200, goldGrowth: 2.5,
    partsBase: 80, partsGrowth: 2.2,
    effectDesc: '建造耗时 -6%/级',
  },
  // ---- 电站 2 线 × 5 级（只花金币） ----
  {
    id: 'power_efficiency',
    kind: 'power',
    name: '能效优化',
    effectKey: 'power_rate',
    valuePerLevel: 0.12,
    maxLevel: 5,
    goldBase: 800, goldGrowth: 2.5,
    effectDesc: '电站产出 +12%/级',
  },
  {
    id: 'power_storage',
    kind: 'power',
    name: '储能扩容',
    effectKey: 'power_cap',
    valuePerLevel: 0.25,
    maxLevel: 5,
    goldBase: 600, goldGrowth: 2.5,
    effectDesc: '能源上限 +25%/级',
  },
];

export function getRetrofitConfig(id: string): RetrofitConfigEntry | undefined {
  return RETROFIT_CONFIGS.find(r => r.id === id);
}

/** 改造线下一级费用（currentLevel 为当前等级，0 起；满级返回 null） */
export function getRetrofitCost(
  cfg: RetrofitConfigEntry,
  currentLevel: number
): { gold: number; parts: number } | null {
  if (currentLevel >= cfg.maxLevel) return null;
  return {
    gold: Math.round(cfg.goldBase * Math.pow(cfg.goldGrowth, currentLevel)),
    parts: cfg.partsBase !== undefined
      ? Math.round(cfg.partsBase * Math.pow(cfg.partsGrowth ?? cfg.goldGrowth, currentLevel))
      : 0,
  };
}
