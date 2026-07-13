// ============================================================
// 游戏常量 — 所有全局数值常量集中管理
// ============================================================

export const GAME_CONSTANTS = {
  // ===== 等级 =====
  MAX_VEHICLE_LEVEL: 10,
  EXP_BASE: 50,
  EXP_GROWTH: 1.5,          // 每级所需经验 = 50 × 1.5^(level-1)

  // ===== 品质 =====
  QUALITY_WHITE_MAX_LEVEL: 5,
  QUALITY_BLUE_MAX_LEVEL: 8,
  QUALITY_GOLD_MAX_LEVEL: 10,
  QUALITY_BLUE_COST_GOLD: 200,
  QUALITY_BLUE_COST_PARTS: 5,
  QUALITY_BLUE_REQUIRED_ORDERS: 10,
  QUALITY_GOLD_COST_GOLD: 1000,
  QUALITY_GOLD_COST_PARTS: 30,
  QUALITY_GOLD_REQUIRED_LEVEL: 7,

  QUALITY_INCOME_MULT_WHITE: 1.0,
  QUALITY_INCOME_MULT_BLUE: 1.5,
  QUALITY_INCOME_MULT_GOLD: 2.0,

  QUALITY_EXP_MULT_WHITE: 0,
  QUALITY_EXP_MULT_BLUE: 0.5,
  QUALITY_EXP_MULT_GOLD: 1.5,

  // ===== 属性升级 =====
  STAT_MAX_LEVEL: 5,
  STAT_UPGRADE_COST_BASE: 50,
  STAT_UPGRADE_COST_GROWTH: 2.0,  // 每级 ×2

  // ===== 车库 =====
  GARAGE_INITIAL_CAPACITY: 6,
  GARAGE_MAX_CAPACITY: 12,
  GARAGE_EXPAND_COST_BASE: 500,
  GARAGE_EXPAND_COST_GROWTH: 3.0,

  // ===== 订单 =====
  ORDER_NORMAL_DURATION: 30,     // 秒
  ORDER_LONG_DIST_DURATION: 45,
  ORDER_VALUABLE_DURATION: 60,
  ORDER_EXPIRE_TIME: 120,        // 订单过期时间（秒）
  ORDER_NORMAL_EXP_BASE: 10,
  ORDER_LONG_DIST_EXP_MULT: 2.0,
  ORDER_VALUABLE_EXP_MULT: 3.0,

  // ===== 亲密度 =====
  MAX_INTIMACY: 100,
  INTIMACY_WASH_AMOUNT: 3,
  INTIMACY_WASH_COOLDOWN: 300,    // 5分钟
  INTIMACY_REPAIR_AMOUNT: 5,
  INTIMACY_REPAIR_COOLDOWN: 600,  // 10分钟
  INTIMACY_TAP_AMOUNT: 1,
  INTIMACY_TAP_COOLDOWN: 60,      // 1分钟
  INTIMACY_ORDER_AMOUNT: 8,
  INTIMACY_EVOLVE_REQUIREMENT: 80,

  // ===== 经验 =====
  EXP_PER_ORDER_BASE: 10,

  // ===== 继承概率 =====
  TRAIT_INHERIT_CHANCE: 0.25,

  // ===== 暴击 =====
  CRIT_MULT_DEFAULT: 2.0,

  // ===== 离线 =====
  OFFLINE_MAX_SECONDS: 7200,     // 2小时
  OFFLINE_EFFICIENCY: 0.4,

  // ===== 轮回 =====
  PRESTIGE_GOLD_THRESHOLD: 10000000,
  PRESTIGE_POINTS_PER_MILLION: 1,
  PRESTIGE_MAX_COUNT: 10,
};

/**
 * 计算第 N 级所需经验
 */
export function expForLevel(level: number): number {
  return Math.floor(GAME_CONSTANTS.EXP_BASE * Math.pow(GAME_CONSTANTS.EXP_GROWTH, level - 1));
}

/**
 * 计算从 1 级升到 targetLevel 的累计经验
 */
export function cumulativeExpForLevel(targetLevel: number): number {
  let total = 0;
  for (let i = 1; i < targetLevel; i++) {
    total += expForLevel(i);
  }
  return total;
}

/**
 * 计算属性升级消耗（第 N 级）
 */
export function statUpgradeCost(level: number): number {
  return Math.floor(
    GAME_CONSTANTS.STAT_UPGRADE_COST_BASE *
    Math.pow(GAME_CONSTANTS.STAT_UPGRADE_COST_GROWTH, level)
  );
}

/**
 * 计算车库扩建费用（第 N 次）
 */
export function garageExpandCost(expandCount: number): number {
  return Math.floor(
    GAME_CONSTANTS.GARAGE_EXPAND_COST_BASE *
    Math.pow(GAME_CONSTANTS.GARAGE_EXPAND_COST_GROWTH, expandCount)
  );
}
