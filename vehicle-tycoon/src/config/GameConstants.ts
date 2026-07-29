// ============================================================
// 游戏常量 — 所有全局数值常量集中管理
// ============================================================

export const GAME_CONSTANTS = {
  // ===== 等级 =====
  MAX_VEHICLE_LEVEL: 10,
  EXP_BASE: 35,
  EXP_GROWTH: 1.5,          // 每级所需经验 = 35 × 1.5^(level-1)

  // ===== 规格 =====
  QUALITY_WHITE_MAX_LEVEL: 5,
  QUALITY_BLUE_MAX_LEVEL: 8,
  QUALITY_GOLD_MAX_LEVEL: 10,
  QUALITY_BLUE_COST_GOLD: 500,
  QUALITY_BLUE_COST_PARTS: 20,
  QUALITY_BLUE_REQUIRED_ORDERS: 10,
  QUALITY_GOLD_COST_GOLD: 5000,
  QUALITY_GOLD_COST_PARTS: 100,
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
  ORDER_NORMAL_EXP_BASE: 20,
  ORDER_LONG_DIST_EXP_MULT: 2.0,
  ORDER_VALUABLE_EXP_MULT: 3.0,

  // ===== 检修 =====
  OVERHAUL_PARTS_COST: 2,       // 检修零件消耗
  OVERHAUL_COOLDOWN: 300,       // 检修冷却（秒）

  // ===== 经验 =====
  EXP_PER_ORDER_BASE: 10,

  // ===== 继承概率 =====
  TRAIT_INHERIT_CHANCE: 0.25,
  INHERIT_EXP_RATIO: 0.5,           // 拆解时累计经验存入传承池的比例（下一辆新车继承）

  // ===== 属性成长 =====
  CARGO_INCOME_PER_LEVEL: 0.04,    // 载货属性每级收入 +4%
  SPEED_DURATION_PER_LEVEL: 0.04,  // 速度属性每级订单耗时 -4%

  // ===== 磨损与疲劳（经营卡点 + 抗膨胀） =====
  WEAR_PER_ORDER: 5,               // 每完成 1 单磨损 +5
  WEAR_MAX: 100,
  WEAR_PENALTY_THRESHOLD: 80,      // 磨损 ≥80 触发惩罚
  WEAR_INCOME_MULT: 0.7,           // 高磨损收入 ×0.7
  WEAR_DURATION_MULT: 1.2,         // 高磨损耗时 ×1.2
  FATIGUE_DECAY: 0.08,             // 连续接单每单收入 -8%
  FATIGUE_MIN_MULT: 0.6,           // 疲劳收入下限 ×0.6
  FATIGUE_RESET_SECONDS: 30,       // 空闲 30 秒重置连续计数

  // ===== 运营配置 =====
  SPEC_EXPRESS_DURATION_MULT: 0.75, // 快运：耗时 ×0.75
  SPEC_EXPRESS_INCOME_MULT: 0.9,    // 快运：收入 ×0.9
  SPEC_HEAVY_INCOME_MULT: 1.25,     // 重载：收入 ×1.25
  SPEC_HEAVY_DURATION_MULT: 1.15,   // 重载：耗时 ×1.15
  SPEC_STEADY_EXP_MULT: 1.15,       // 耐用：经验 ×1.15
  SPEC_STEADY_WEAR_MULT: 0.5,       // 耐用：磨损减半

  // ===== 暴击 =====
  CRIT_MULT_DEFAULT: 2.0,

  // ===== 离线 =====
  OFFLINE_MAX_SECONDS: 7200,     // 2小时
  OFFLINE_EFFICIENCY: 0.4,

  // ===== 工厂 =====
  FACTORY_MAX_LEVEL: 10,
  FACTORY_BASE_RATE: 0.2,           // 基础零件/秒/每产线
  FACTORY_RATE_GROWTH: 0.75,        // 每级 +75% 产出速率
  FACTORY_UPGRADE_COSTS: [0, 500, 2000, 8000, 30000, 80000, 200000, 500000, 1200000, 3000000],
  FACTORY_LINES_AT_LEVEL: [1, 1, 2, 2, 3, 3, 4, 4, 5, 6], // 各级产线数
  FACTORY_OVERCLOCK_MULT: 2.0,      // 超负荷运转：产出 ×2
  FACTORY_OVERCLOCK_DURATION: 60,   // 持续 60 秒
  FACTORY_OVERCLOCK_COOLDOWN: 300,  // 冷却 5 分钟
  FACTORY_TIER_SCALING: 0.3,       // 进度系数（M7）：产出 ×(1 + 车库最高车型 tier × 0.3)，空车库按 T1 计
  TECH_SPEED_BOOST: 0.25,           // 科技 L3+ 加速 +25%
  TECH_GLOBAL_INCOME_MULT: 1.5,     // 科技 L5 全厂收入 ×1.5

  // ===== 时间化（M7） =====
  BUILD_QUEUE_MAX: 3,                       // 建造排队位（另有 1 个建造槽）
  RESEARCH_TIME_MAIN: [0, 30, 60, 120, 240, 480], // 主线 L1-L5 研究耗时（秒）
  RESEARCH_TIME_SIDE: 60,                   // 支线研究统一耗时（秒）
  QUALITY_UPGRADE_TIME_BLUE: 60,            // 规格升级耗时：白→蓝（秒）
  QUALITY_UPGRADE_TIME_GOLD: 180,           // 规格升级耗时：蓝→金（秒）

  // ===== 辅助科技（支线）效果（v1.3：3 阶制，效果 = 每阶量 × 阶数） =====
  SIDE_LOGISTICS_INTERVAL_PER_RANK: 0.07, // 物流优化：订单生成间隔每阶 -7%（3 阶 -21% ≈ 原 ×0.8）
  SIDE_LEAN_PARTS_PER_RANK: 0.09,         // 精益制造：造车零件消耗每阶 -9%（3 阶 -27% ≈ 原 ×0.75）
  SIDE_ARCHIVE_INHERIT_PER_RANK: 0.06,    // 技术档案：传承比例每阶 +6 个百分点（3 阶 +18% ≥ 原 15%）
  SIDE_RECYCLING_SCRAP_PER_RANK: 0.07,    // 回收工艺：拆解金币返还每阶 +7%（3 阶 51% ≥ 原 50%）

  // ===== 工厂里程碑（v1.3） =====
  FACTORY_QUEUE_BONUS_LEVEL: 5,  // 工厂达到该等级时建造排队位 +1（3→4）
  FACTORY_QUEUE_BONUS: 1,

  // ===== 路上事件（M1） =====
  EN_ROUTE_TRIGGER_CHANCE_NORMAL: 0.4,  // 普通/贵重单触发概率
  EN_ROUTE_TRIGGER_CHANCE_LONG: 0.7,    // 长途单触发概率（耗时长、窗口大）
  EN_ROUTE_TRIGGER_POINT_MIN: 0.3,      // 触发点：行程 30% 起
  EN_ROUTE_TRIGGER_POINT_RANGE: 0.4,    // 触发点区间宽度（行程 30%-70%）
  EN_ROUTE_DECISION_WINDOW: 10,         // 决策窗口（秒），超时走默认项
  EN_ROUTE_DECISION_TOLERANCE: 1,       // 超时判定容差（秒）
  EN_ROUTE_POSTPONE_SECONDS: 3,         // 同屏已有待决策事件时，新到点事件顺延秒数

  // ===== 能源（M8）：企业的动力源 =====
  POWER_MAX_LEVEL: 10,
  POWER_BASE_RATE: 4.0,           // 电站基础产出 ⚡/秒
  POWER_RATE_GROWTH: 0.75,        // 每级产出 +75%
  POWER_CAPACITY_PER_LEVEL: 100,  // 储存上限 = 100 × 等级（到顶停产）
  POWER_UPGRADE_COSTS: [0, 100, 1000, 4000, 15000, 50000, 120000, 300000, 700000, 1600000], // 升级只花金币
  INITIAL_ENERGY: 50,             // 新开局赠送能源（教程首车不被卡）

  ENERGY_BUILD_PER_TIER_SQ: 5,    // 造车耗电 = 5 × tier²（T1=5 → T10=500），入队时扣
  ENERGY_QUALITY_BLUE: 20,        // 升级规格耗电：白→蓝
  ENERGY_QUALITY_GOLD: 80,        // 升级规格耗电：蓝→金
  ENERGY_OVERCLOCK: 50,           // 超负荷运转耗电
  ENERGY_ORDER_SPEED_FACTOR: 0.1, // 每单耗电 = 订单tier × (1 + 速度属性 × 0.1)，派单时预扣
  ENERGY_SHORTAGE_DURATION_MULT: 1.5, // 动力不足惩罚：本次订单耗时 ×1.5（不锁单）

  // ===== 声望（M8）：企业品牌，一单一单跑出来的口碑 =====
  REP_ORDER_MULT_NORMAL: 1,       // 完成订单声望 = 订单tier × 类型系数
  REP_ORDER_MULT_LONG: 2,
  REP_ORDER_MULT_VALUABLE: 4,
  REP_FIRST_BUILD_PER_TIER: 20,   // 首台下线品牌效应：+20 × tier（每 tier 只发一次）
  REP_VALUABLE_COST: 10,          // 接贵重单动用客户关系：-10 声望
  MARKETING_GOLD_COST: 1000,      // 营销推广：1000🪙 买 2 分钟声望获取 ×2
  MARKETING_DURATION: 120,        // 营销 buff 持续（秒）
  MARKETING_COOLDOWN: 300,        // 营销冷却（秒）
  MARKETING_REP_MULT: 2.0,        // 营销期间声望获取倍率
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

// ==================== M8 能源 / 声望 helper ====================

/** 造车耗电：5 × tier²（入队时扣除） */
export function buildEnergyCost(tier: number): number {
  return GAME_CONSTANTS.ENERGY_BUILD_PER_TIER_SQ * tier * tier;
}

/** 每单耗电：订单 tier × (1 + 车辆速度属性 × 0.1)（派单时预扣） */
export function orderEnergyCost(orderTier: number, speedStat: number): number {
  return orderTier * (1 + speedStat * GAME_CONSTANTS.ENERGY_ORDER_SPEED_FACTOR);
}
