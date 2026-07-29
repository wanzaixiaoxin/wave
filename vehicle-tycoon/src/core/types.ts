// ============================================================
// 造物运输大亨 — 核心类型定义
// 此文件是所有系统的类型基础，禁止循环引用此文件
// ============================================================

// ==================== 枚举常量 ====================

export enum Quality {
  White = 'white',
  Blue = 'blue',
  Gold = 'gold',
}

export const QUALITY_ORDER: Quality[] = [Quality.White, Quality.Blue, Quality.Gold];

/**
 * 规格数值等级（白=0 < 蓝=1 < 金=2）
 * 注意：Quality 是字符串枚举，禁止直接用 < / > 比较（字典序下 'white' > 'blue'）
 */
export function qualityRank(quality: Quality): number {
  return QUALITY_ORDER.indexOf(quality);
}

export enum VehicleStatus {
  Idle = 'idle',
  OnOrder = 'on_order',
  Maintenance = 'maintenance',
  Retired = 'retired',
}

export enum OrderType {
  Normal = 'normal',
  LongDistance = 'long_distance',
  Valuable = 'valuable',
}

export enum OrderStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  Completed = 'completed',
}

export enum TraitRarity {
  Normal = 'normal',
  Rare = 'rare',
}

export enum TraitType {
  Quick = 'quick',       // 高速：订单耗时 -15%
  Strong = 'strong',     // 重载：收入 +20%
  Precise = 'precise',   // 精准：暴击 +5%
  Smart = 'smart',       // 老练：经验 +20%
  Lucky = 'lucky',       // 幸运：暴击 ×3（稀有）
  Wealth = 'wealth',     // 节能：收入 +10%
}

export enum TechLevel {
  L1 = 1,
  L2 = 2,
  L3 = 3,
  L4 = 4,
  L5 = 5,
}

export enum GameEvent {
  // 车辆事件
  VEHICLE_PRODUCED = 'vehicle:produced',
  VEHICLE_LEVEL_UP = 'vehicle:level_up',
  VEHICLE_RETIRED = 'vehicle:retired',
  VEHICLE_TRAIT_INHERITED = 'vehicle:trait_inherited',
  VEHICLE_STATS_CHANGED = 'vehicle:stats_changed',

  // 订单事件
  ORDER_GENERATED = 'order:generated',
  ORDER_ASSIGNED = 'order:assigned',
  ORDER_COMPLETED = 'order:completed',
  // 路上事件（M1）：在途订单触发 2-3 选 1 微决策
  EN_ROUTE_EVENT_TRIGGERED = 'order:en_route_triggered',
  EN_ROUTE_EVENT_RESOLVED = 'order:en_route_resolved',

  // 资源事件
  RESOURCE_CHANGED = 'resource:changed',

  // 科技事件
  TECH_RESEARCHED = 'tech:researched',

  // 工厂事件
  FACTORY_UPGRADED = 'factory:upgraded',
  POWER_UPGRADED = 'power:upgraded',
  PRODUCTION_STARTED = 'production:started',
  PRODUCTION_COMPLETED = 'production:completed',

  // 车库事件
  GARAGE_EXPANDED = 'garage:expanded',
  GARAGE_FULL = 'garage:full',

  // 规格事件
  QUALITY_UPGRADED = 'quality:upgraded',

  // 成就事件
  ACHIEVEMENT_UNLOCKED = 'achievement:unlocked',

  // 离线事件
  OFFLINE_EARNINGS = 'offline:earnings',

  // 随机事件
  RANDOM_EVENT_TRIGGERED = 'event:random_triggered',
  RANDOM_EVENT_EXPIRED = 'event:random_expired',

  // 游戏状态
  GAME_TICK = 'game:tick',
  GAME_SAVED = 'game:saved',
}

// ==================== 核心接口 ====================

export interface VehicleStats {
  speed: number;       // 0-5，每级订单耗时 -4%
  cargo: number;       // 0-5，每级收入 +4%
  durability: number;  // 0-5，≥3 可接长途单
}

/**
 * 车辆运营配置 — 蓝规格解锁，三选一，永久互斥
 */
export enum Specialization {
  Express = 'express',   // 快运：耗时 -25%，收入 -10%
  Heavy = 'heavy',       // 重载：收入 +25%，耗时 +15%
  Steady = 'steady',     // 耐用：磨损减半，经验 +15%
}

export interface Vehicle {
  id: string;
  tier: number;                    // 1-10
  name: string;
  level: number;                   // 1-10
  exp: number;
  quality: Quality;
  trait: TraitType | null;
  stats: VehicleStats;
  specialization: Specialization | null;
  wear: number;                    // 磨损 0-100，≥70 收入 -30%、耗时 +20%
  consecutiveOrders: number;       // 连续接单数（疲劳），空闲 30 秒重置
  lastOrderCompletedAt: number;    // 0 = 从未完成过订单
  ordersCompleted: number;
  totalEarnings: number;
  createdAt: number;
  status: VehicleStatus;
  statusEndAt: number;             // 0 = no limit
  qualityUpgrade: QualityUpgradeJob | null;  // 进行中的规格升级（M7），null = 无
}

export interface Order {
  id: string;
  type: OrderType;
  tier: number;                    // 订单等级（1-10），低 tier 车辆不能接高 tier 订单
  baseReward: number;
  expReward: number;
  duration: number;                // seconds
  requiredDurability?: number;
  requiredQuality?: Quality;
  assignedVehicleId: string | null;
  status: OrderStatus;
  createdAt: number;
  expiresAt: number;
  lowPower?: boolean;              // 动力不足（M8）：派单时能源不够，本次耗时 ×1.5
  // 路上事件（M1）：派单时按概率排定，到点弹出 2-3 选 1 决策
  enRouteEvent?: {
    eventId: string;
    triggerAt: number;             // 触发时间戳（毫秒）
    resolved: boolean;             // 是否已决策（含超时走默认项）
    triggeredAt?: number;          // 实际触发（弹窗）时间戳，用于 UI 倒计时与超时兜底
    choiceIndex?: number;          // 玩家所选选项下标
  };
  pendingRewardMult?: number;      // 路上事件累积的本单收入倍率（默认 1，结算时乘入）
}

export interface ProductionLine {
  index: number;
  isActive: boolean;
}

/** 建造任务（M7）：下标 0 在建造槽上（finishAt 为完成时间戳），其余排队中（finishAt = 0） */
export interface BuildJob {
  tier: number;
  totalTime: number;   // 总耗时（秒，取自车型 buildTime）
  finishAt: number;    // 完成时间戳（毫秒）；0 = 排队中未上槽
}

/** 进行中的研究（M7）：主线/支线/子科技共享一个研究槽 */
export interface ActiveResearch {
  kind: 'main' | 'side' | 'sub';
  level?: number;      // kind = 'main' 时的目标等级
  sideId?: string;     // kind = 'side' 时的支线 id
  subId?: string;      // kind = 'sub' 时的子科技 id
  totalTime: number;   // 总耗时（秒）
  finishAt: number;    // 完成时间戳（毫秒）
}

/** 进行中的规格升级（M7）：期间车辆 status = Maintenance */
export interface QualityUpgradeJob {
  target: Quality;
  totalTime: number;   // 总耗时（秒）
  finishAt: number;    // 完成时间戳（毫秒）
}

export interface Factory {
  level: number;
  productionLines: ProductionLine[];
  overclockUntil: number;           // 超负荷运转截止时间戳（0=未激活）
  overclockCooldownUntil: number;   // 超负荷冷却结束时间戳
  powerLevel: number;               // 电站等级（M8）：企业的动力源，1-10 级
  retrofits: Record<string, number>; // 改造线等级（v1.3）：改造线 id → 0-5 级，即时购买生效
}

export interface Garage {
  maxCapacity: number;
  vehicles: Vehicle[];
  inheritanceExp: number;   // 传承池：拆解车辆沉淀的经验，下一辆新车落地继承
  buildQueue: BuildJob[];   // 建造队列（M7）：下标 0 为建造槽，最多 1 + BUILD_QUEUE_MAX 个
}

export interface TechTree {
  currentLevel: number;
  isResearched: boolean[];
  // 解锁条件计数
  producedCount: number[];
  // 辅助科技（支线）：id → 已研究阶数（0-3，v1.3 起 3 阶制）
  sideTechs: Record<string, number>;
  // 子科技（v1.3）：id → 已研究阶数（0-3），挂在主线等级下
  subTechs: Record<string, number>;
  // 进行中的研究（M7）：主线/支线/子科技共享一个研究槽，null = 空闲
  researching: ActiveResearch | null;
}

export interface Resources {
  gold: number;
  parts: number;
  energy: number;       // ⚡ 能源（M8）：企业动力源，电站产出，造车/升级规格/派单消耗
  reputation: number;   // 📈 声望（M8）：企业品牌口碑，高 tier 车型市场准入门槛
}

export interface ActiveEvent {
  id: string;
  effectType: string;
  value: number;
  remainingTime: number;
  totalDuration: number;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  condition: AchievementCondition;
  reward: AchievementReward;
  isUnlocked: boolean;
  unlockedAt: number | null;
}

export interface AchievementCondition {
  type: 'produce_count' | 'quality_count' | 'profit_total'
       | 'order_count' | 'stats_max' | 'tradein_count'
       | 'total_orders' | 'tech_level' | 'factory_level'
       | 'inherit_count' | 'side_tech_count';
  target: number;
  params?: Record<string, unknown>;
}

export interface AchievementReward {
  gold?: number;
  parts?: number;
  title?: string;
}

export interface GameStats {
  totalGoldEarned: number;
  totalVehiclesProduced: number;
  totalOrdersCompleted: number;
  totalTradeIns: number;            // 以旧换新累计次数
  totalVehiclesInherited: number;   // 触发传承（新车继承经验）的次数
  totalPlayTime: number;
  offlineTime: number;
}

export interface GameSettings {
  soundEnabled: boolean;
  musicEnabled: boolean;
  autoCollectOrders: boolean;
}

export interface SaveData {
  version: string;
  timestamp: number;
  resources: Resources;
  factory: Factory;
  garage: Garage;
  techTree: TechTree;
  achievements: Achievement[];
  stats: GameStats;
  settings: GameSettings;
}

export interface OfflineResult {
  offlineSeconds: number;
  carsProduced: number;
  goldEarned: number;
  partsEarned: number;
}

// ==================== 配置表接口 ====================

export interface VehicleConfigEntry {
  tier: number;
  name: string;
  emoji: string;
  basePrice: number;
  buildCost: number;
  buildTime: number;
  parkingSpaces: number;
  partsCost: number;
  /**
   * 时代差异化解锁需求（M9）：全部字段可选，缺省 = 无要求；空对象 = 初始可用。
   * 手工作坊时代靠产量，工业时代靠工厂等级，电气/航天时代靠电站等级，声望自内燃机时代起贯穿。
   */
  unlock: {
    techLevel?: number;      // 科技主线等级
    factoryLevel?: number;   // 工厂等级
    powerLevel?: number;     // 电站等级
    reputation?: number;     // 品牌声望
    produceTier?: number;    // 需累计生产某车型
    produceCount?: number;   // …N 辆
  };
}

export interface TechConfigEntry {
  level: number;
  name: string;
  description: string;
  unlockCondition: string;
  goldCost: number;
  partsCost: number;
  effect: string;
}

/** 辅助科技（支线，v1.3 起 3 阶制）：主线等级达标后可逐阶研究，效果逐阶线性叠加 */
export interface SideTechConfigEntry {
  id: string;
  name: string;
  description: string;
  requiredLevel: number;   // 需要主线科技等级
  maxRank: number;         // 3 阶
  effectKey: string;       // 效果标识：'order_interval' | 'parts_cost' | 'inherit_ratio' | 'scrap_gold'
  valuePerRank: number;    // 每阶效果量（线性叠加，符号自带方向）
  goldCosts: number[];     // 各阶金币费用（逐阶递增）
  partsCosts: number[];    // 各阶零件费用（逐阶递增）
  effect: string;
}

/** 统一倍率入口的效果标识（v1.3）：子科技与工厂/电站改造共用同一乘区查询 */
export type UpgradeEffectKey =
  | 'build_time'         // 建造耗时
  | 'build_cost'         // 造车金币
  | 'order_energy'       // 每单耗电
  | 'rep_gain'           // 声望获取
  | 'order_duration'     // 订单耗时
  | 'wear'               // 磨损累积
  | 'parts_rate'         // 零件产出速率
  | 'power_rate'         // 电站产出速率
  | 'power_cap'          // 能源储存上限
  | 'first_produce_rep'; // 首台下线声望

/** 子科技（v1.3）：挂在主线等级下，3 阶，走研究槽，效果逐阶线性叠加 */
export interface SubTechConfigEntry {
  id: string;
  mainLevel: number;       // 所属主线等级（该级研究完成后解锁）
  name: string;
  effectKey: UpgradeEffectKey;
  valuePerRank: number;    // 每阶效果（乘区线性叠加：mult = 1 + valuePerRank × rank）
  goldCosts: number[];     // 3 阶金币费用
  partsCosts: number[];    // 3 阶零件费用
  researchTimes: number[]; // 3 阶研究耗时（秒）
  effectDesc: string;      // 显示用，如「建造耗时 -6%/阶」
}

/** 工厂/电站改造线（v1.3）：即时购买生效，不占研究槽 */
export interface RetrofitConfigEntry {
  id: string;
  kind: 'factory' | 'power';
  name: string;
  effectKey: UpgradeEffectKey;
  valuePerLevel: number;   // 每级效果（乘区线性叠加）
  maxLevel: number;        // 5 级
  goldBase: number;        // 1 级金币费用
  goldGrowth: number;      // 每级费用倍率
  partsBase?: number;      // 1 级零件费用（缺省 = 不花零件）
  partsGrowth?: number;
  effectDesc: string;      // 显示用，如「零件速率 +15%/级」
}

export interface TraitConfigEntry {
  type: TraitType;
  name: string;
  rarity: TraitRarity;
  effectType: string;
  effectValue: number;
  probability: number;
}

/** 路上事件选项（M1）：每个事件 2-3 选 1，效果可叠加多种类型 */
export interface EnRouteEventChoice {
  label: string;                // 选项名，如「绕行」
  summary: string;              // 效果摘要，如「+15s」（弹窗按钮与结果 toast 共用）
  isDefault?: boolean;          // 是否为超时默认项（挂机兜底，对玩家无害）
  requiredDurability?: number;  // 车辆耐久门槛（如交警「出示年检」需耐久≥4）
  durationDeltaSec?: number;    // 耗时增减（秒，直接加到 statusEndAt）
  durationMult?: number;        // 剩余耗时倍率（如好天气「赶路」×0.85）
  wearDelta?: number;           // 磨损增减
  rewardMult?: number;          // 本单收入倍率（累乘到 order.pendingRewardMult）
  partsCost?: number;           // 零件消耗（零件不足时该选项不可选）
  partsGain?: number;           // 零件获得（立即入账）
  goldCostPct?: number;         // 金币消耗（按本单期望收入百分比）
}

export interface EnRouteEventConfigEntry {
  id: string;
  name: string;
  emoji: string;
  description: string;
  weight: number;               // 基础触发权重（事件池内按权重抽取）
  choices: EnRouteEventChoice[];
}

// ==================== 运行时状态 ====================

export interface GameState {
  phase: 'playing';
  resources: Resources;
  garage: Garage;
  factory: Factory;
  orders: Order[];
  techTree: TechTree;
  activeEvents: ActiveEvent[];
  achievements: Achievement[];
  stats: GameStats;
  settings: GameSettings;
}

export interface UIState {
  currentView: 'garage' | 'factory' | 'tech' | 'achievement';
  selectedVehicleId: string | null;
  visibleModal: string | null;
  notifications: string[];
}
