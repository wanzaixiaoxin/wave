// ============================================================
// 游戏常量 — 所有全局数值常量集中管理
// ============================================================

export const GAME_CONSTANTS = {
  // ===== S4 城市需求压力（根本动力：城市发展 → 运输紧张 → 经营解决 → 繁荣释放） =====
  // 名义需求速率（单位/分钟）= BASE + GROWTH×分钟数 + PER_PROSPERITY×繁荣等级
  CITY_DEMAND_BASE: 2,            // 基准需求
  CITY_DEMAND_GROWTH: 0.8,        // 城市经济发展：每分钟游戏时长需求 +N（sim 校准旋钮）
  CITY_DEMAND_PER_PROSPERITY: 2,  // 每繁荣级需求 +N（释放后压力同步上升，自平衡）
  // 自稳定：有效需求 = 名义 × 1/(1+backlog/K)——积压大时客户转投竞争对手，积压存在均衡点、永不死锁
  CITY_BACKLOG_SOFT_K: 120,
  // 压力分级阈值（积压 / K 的倍数；对应需求/运力比 ≈1.5/2/3 时的均衡积压）
  CITY_PRESSURE_L1_K: 0.5,   // L1 紧张：订单单价 ×0.9（客户压价）
  CITY_PRESSURE_L2_K: 1.0,   // L2 拥堵：+全单耗时 ×1.2（堵车）+ 信誉流失
  CITY_PRESSURE_L3_K: 2.0,   // L3 瘫痪边缘：+订单槽 -1 + 单价再 ×0.9
  CITY_PRESSURE_INCOME_L1: 0.9,
  CITY_PRESSURE_INCOME_L3: 0.9,  // 与 L1 叠乘（L3 累计 ×0.81）
  CITY_PRESSURE_DURATION_L2: 1.15,  // 堵车耗时惩罚（>1 会形成正反馈漩涡，克制取值）
  CITY_REP_DRAIN_PER_MIN: 5,     // L2+ 信誉流失（扣到 0 止）
  // 繁荣度（释放阀）：L0/L1 持续畅通累积进度，满槽升 1 级；L3 进度倒退（等级不降）
  CITY_PROSPERITY_PROGRESS_PER_SEC: 1,
  CITY_PROSPERITY_PROGRESS_NEED: 450,   // 7.5 分钟畅通升 1 级（释放阀要压得住压力惩罚的节奏）
  CITY_PROSPERITY_REGRESS_PER_SEC: 2,
  CITY_PROSPERITY_INCOME_PER_LEVEL: 0.05, // 每级全局收入 +5%
  CITY_PROSPERITY_MAX_LEVEL: 10,
  // 基建项目效果（需求量在 CityConfig.ts）
  CITY_PROJECT_DELIVERY_BONUS: 0.10,   // 物流集散点：每单交付 +10%
  CITY_PROJECT_DURATION_EASE: 1.1,     // 环城快速路网：L2 耗时惩罚 1.2 → 1.1
  CITY_PROJECT_SOFT_K_MULT: 1.25,      // 环城快速路网：城市容忍度 K +25%
  CITY_PROJECT_INCOME: 1.15,           // 城际运输走廊：全局收入 +15%

  // ===== 规格 =====
  QUALITY_BLUE_COST_GOLD: 500,
  QUALITY_BLUE_COST_PARTS: 20,
  QUALITY_BLUE_REQUIRED_ORDERS: 10,
  QUALITY_BLUE_REQUIRED_MILEAGE: 300,   // S2a：标准型里程门槛（原等级门槛改里程）
  QUALITY_GOLD_COST_GOLD: 5000,
  QUALITY_GOLD_COST_PARTS: 100,
  QUALITY_GOLD_REQUIRED_MILEAGE: 1500,  // S2a：工业型里程门槛（原 Lv.7 门槛改里程）

  QUALITY_INCOME_MULT_WHITE: 1.0,
  QUALITY_INCOME_MULT_BLUE: 1.5,
  QUALITY_INCOME_MULT_GOLD: 2.0,

  // ===== 里程与磨合（S2a：替代等级/经验） =====
  MILEAGE_SPEED_BASE: 5,         // 完成订单里程 = 实际耗时(秒) × (5 + tier)
  BREAKIN_PER_1000KM: 0.04,      // 磨合：每 1000km 收入 +4%
  BREAKIN_MAX: 0.40,             // 磨合收入加成上限 +40%

  // ===== 残值（S2a） =====
  MILEAGE_LIFESPAN_PER_TIER: 3000,  // 里程寿命 = 3000 × tier（T1 3000km，T10 30000km）
  RESIDUAL_MIN_RATIO: 0.15,         // 残值下限：实付价 × 15%
  RESIDUAL_WEAR_FACTOR: 200,        // 磨损折旧：残值 × (1 - wear/200)
  SCRAP_GOLD_RESIDUAL_BASE: 0.3,    // 拆解金币 = 残值 × (0.3 + 回收工艺加成)

  // ===== 翻新（S2a） =====
  REFURBISH_GOLD_RATIO: 0.35,    // 翻新金币 = floor(buildCost × 0.35)
  REFURBISH_PARTS_RATIO: 0.5,    // 翻新零件 = floor(partsCost × 0.5)
  REFURBISH_MILEAGE_MULT: 0.4,   // 翻新后里程 ×0.4（折旧回春）
  REFURBISH_MAX_COUNT: 2,        // 每车限翻新 2 次

  // ===== 属性升级 =====
  STAT_MAX_LEVEL: 5,
  STAT_UPGRADE_COST_BASE: 50,
  STAT_UPGRADE_COST_GROWTH: 2.0,  // 每级 ×2

  // ===== 车库（S2a：占格数口径，容量 = 各车 parkingSpaces 之和的上限） =====
  // 布局约束：车位网格每行 GARAGE_LOT_COLS 列，容量必须 = 行数 × 列数（否则大车顶出的零碎格子画不出来）
  GARAGE_LOT_COLS: 5,        // 每行 5 列 × 4 行 = 20 格布局；最大占格数 4（T9/T10）仍可与 1 格小车同行拼满，无浪费死角
  GARAGE_INITIAL_CAPACITY: 10, // 10 格起步（列数整数倍；sim 校准结论「8 格起步不漂移」取最近整数倍 10）
  GARAGE_MAX_CAPACITY: 20,   // S2a：大车占 2-4 格，上限 20 格保住车队组合取舍（≈10 辆中车或 5 辆大车）
  GARAGE_EXPAND_COST_BASE: 500,
  GARAGE_EXPAND_COST_GROWTH: 3.0,
  GARAGE_EXPAND_SPACES: 5,   // 每次扩建 +5 格 = 恰好 +1 行（10/15/20，列数的整数倍）

  // ===== 订单 =====
  ORDER_NORMAL_DURATION: 30,     // 秒
  ORDER_LONG_DIST_DURATION: 45,
  ORDER_VALUABLE_DURATION: 60,
  ORDER_EXPIRE_TIME: 120,        // 订单过期时间（秒）

  // ===== 检修 =====
  OVERHAUL_PARTS_COST: 2,       // 检修基础零件消耗（S2a：随里程浮动，每 2000km +1⚙️）
  OVERHAUL_PARTS_PER_2000KM: 1, // 里程每满 2000km 检修零件 +1
  OVERHAUL_COOLDOWN: 300,       // 检修冷却（秒）

  // ===== 继承概率 =====
  TRAIT_INHERIT_CHANCE: 0.25,

  // ===== 属性成长（递进曲线 + 断点特技：越点越值，L3/L5 给质变） =====
  // 曲线为「该等级时的累计效果」，索引 = 等级-1；满级收益略超原线性（+25%/-25%/-40%），前段略缓作平衡
  CARGO_INCOME_CURVE: [0.03, 0.07, 0.12, 0.18, 0.25],   // 载货 → 收入加成
  SPEED_DURATION_CURVE: [0.03, 0.07, 0.12, 0.18, 0.25], // 速度 → 订单耗时减免
  DURABILITY_WEAR_CURVE: [0.06, 0.13, 0.21, 0.30, 0.40], // 耐久 → 每单磨损减免（满级持平 -40%）
  // L3 断点
  SPEED_L3_FATIGUE_MULT: 0.5,      // 速度 L3：连单疲劳衰减减半（快车抗疲劳）
  CARGO_L3_VALUABLE_BONUS: 0.15,   // 载货 L3：贵重单收入 +15%（大件运输车吃高价单）
  // L5 断点
  CARGO_L5_CRIT_RATE: 0.05,        // 载货 L5：暴击率 +5%（满载惊喜）
  DURABILITY_L5_LIFESPAN_MULT: 1.25, // 耐久 L5：里程寿命 ×1.25（残值曲线同步放缓）
  // 速度 L5 断点无常量：orderEnergyCost 内 speedStat>=STAT_MAX_LEVEL 时速度加价归零

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
  SPEC_STEADY_BREAKIN_MULT: 1.15,   // 耐用：磨合增速 ×1.15（S2a：原经验加成改磨合）
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
  SIDE_ARCHIVE_RESIDUAL_PER_RANK: 0.07, // 技术档案（S2a 改残值体系）：出售残值金币每阶 +7%
  SIDE_RECYCLING_SCRAP_PER_RANK: 0.07,  // 回收工艺：拆解金币返还每阶 +7%（乘在残值上）

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
 * 磨合收入加成（S2a）：每 1000km +4%，上限 +40%（替代原「每级 +5%」）
 */
export function getBreakinBonus(mileage: number): number {
  return Math.min(
    GAME_CONSTANTS.BREAKIN_MAX,
    (mileage / 1000) * GAME_CONSTANTS.BREAKIN_PER_1000KM
  );
}

/** 里程寿命（S2a）：3000 × tier（T1 小车 3000km 报废期，T10 30000km）；耐久 L5 断点 ×1.25 */
export function getMileageLifespan(tier: number, durability = 0): number {
  const base = GAME_CONSTANTS.MILEAGE_LIFESPAN_PER_TIER * tier;
  return durability >= GAME_CONSTANTS.STAT_MAX_LEVEL
    ? Math.floor(base * GAME_CONSTANTS.DURABILITY_L5_LIFESPAN_MULT)
    : base;
}

/** 属性曲线取值：level 0 无效果，1-5 级取累计值（曲线索引 = 等级-1） */
function curveValue(curve: readonly number[], level: number): number {
  return level > 0 ? curve[Math.min(level, curve.length) - 1] : 0;
}

/** 载货 → 收入乘区（递进曲线） */
export function cargoIncomeMult(cargoLevel: number): number {
  return 1 + curveValue(GAME_CONSTANTS.CARGO_INCOME_CURVE, cargoLevel);
}

/** 速度 → 耗时乘区（递进曲线） */
export function speedDurationMult(speedLevel: number): number {
  return 1 - curveValue(GAME_CONSTANTS.SPEED_DURATION_CURVE, speedLevel);
}

/** 耐久 → 磨损减免比例（递进曲线，0-0.4） */
export function durabilityWearReduction(durabilityLevel: number): number {
  return curveValue(GAME_CONSTANTS.DURABILITY_WEAR_CURVE, durabilityLevel);
}

/** 检修零件成本（S2a）：基础 2⚙️ + 里程每满 2000km +1⚙️（老车检修更贵） */
export function overhaulPartsCost(mileage: number): number {
  return GAME_CONSTANTS.OVERHAUL_PARTS_COST +
    Math.floor(mileage / 2000) * GAME_CONSTANTS.OVERHAUL_PARTS_PER_2000KM;
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

/** 每单耗电：订单 tier × (1 + 车辆速度属性 × 0.1)（派单时预扣）；速度 L5 断点：速度加价归零 */
export function orderEnergyCost(orderTier: number, speedStat: number): number {
  const effSpeed = speedStat >= GAME_CONSTANTS.STAT_MAX_LEVEL ? 0 : speedStat;
  return orderTier * (1 + effSpeed * GAME_CONSTANTS.ENERGY_ORDER_SPEED_FACTOR);
}
