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
  Quick = 'quick',       // 勤快：速度 +15%
  Strong = 'strong',     // 强壮：载货 +20%
  Precise = 'precise',   // 精准：暴击 +5%
  Smart = 'smart',       // 聪明：经验 +20%
  Lucky = 'lucky',       // 幸运：暴击 ×3（稀有）
  Wealth = 'wealth',     // 招财：收入 +10%
}

export enum TalentType {
  Agile = 'agile',           // 独轮车: 速度 +20%
  Endurance = 'endurance',   // 自行车: 连续2单
  Noble = 'noble',           // 马车: 高品质优先
  Speedster = 'speedster',   // 小汽车: 短途×2
  Hauler = 'hauler',         // 卡车: 收入+50%
  Convoy = 'convoy',         // 火车: 同型每辆+5%
  Explorer = 'explorer',     // 轮船: 额外零件
  Network = 'network',       // 飞机: 订单刷新+30%
  Stellar = 'stellar',       // 火箭: 零件+50%
  Warp = 'warp',             // 星际: 全车型+15%
}

export enum ChallengeType {
  SpeedRush = 'speed_rush',
  Survival = 'survival',
  Randomizer = 'randomizer',
}

export enum ChallengeRank {
  Bronze = 'bronze',
  Silver = 'silver',
  Gold = 'gold',
  Diamond = 'diamond',
  Legend = 'legend',
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
  VEHICLE_NAMED = 'vehicle:named',
  VEHICLE_LEVEL_UP = 'vehicle:level_up',
  VEHICLE_EVOLVED = 'vehicle:evolved',
  VEHICLE_RETIRED = 'vehicle:retired',
  VEHICLE_TRAIT_INHERITED = 'vehicle:trait_inherited',
  VEHICLE_STATS_CHANGED = 'vehicle:stats_changed',

  // 订单事件
  ORDER_GENERATED = 'order:generated',
  ORDER_ASSIGNED = 'order:assigned',
  ORDER_COMPLETED = 'order:completed',

  // 资源事件
  RESOURCE_CHANGED = 'resource:changed',

  // 科技事件
  TECH_RESEARCHED = 'tech:researched',

  // 工厂事件
  FACTORY_UPGRADED = 'factory:upgraded',
  PRODUCTION_STARTED = 'production:started',
  PRODUCTION_COMPLETED = 'production:completed',

  // 车库事件
  GARAGE_EXPANDED = 'garage:expanded',
  GARAGE_FULL = 'garage:full',

  // 养成事件
  INTIMACY_CHANGED = 'intimacy:changed',
  QUALITY_UPGRADED = 'quality:upgraded',

  // 成就事件
  ACHIEVEMENT_UNLOCKED = 'achievement:unlocked',

  // 终局事件
  CHALLENGE_COMPLETED = 'challenge:completed',
  PRESTIGE_RESET = 'prestige:reset',

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
  speed: number;       // 0-5
  cargo: number;       // 0-5
  durability: number;  // 0-5
}

export interface Vehicle {
  id: string;
  tier: number;                    // 1-10
  name: string;
  level: number;                   // 1-10
  exp: number;
  quality: Quality;
  trait: TraitType | null;
  intimacy: number;                // 0-100
  stats: VehicleStats;
  isEvolved: boolean;
  ordersCompleted: number;
  totalEarnings: number;
  createdAt: number;
  status: VehicleStatus;
  statusEndAt: number;             // 0 = no limit
}

export interface Order {
  id: string;
  type: OrderType;
  baseReward: number;
  expReward: number;
  duration: number;                // seconds
  requiredDurability?: number;
  requiredQuality?: Quality;
  assignedVehicleId: string | null;
  status: OrderStatus;
  createdAt: number;
  expiresAt: number;
}

export interface ProductionOrder {
  tier: number;
  remainingTime: number;
  isAutoSell: boolean;
}

export interface ProductionLine {
  index: number;
  currentOrder: ProductionOrder | null;
  queue: ProductionOrder[];
}

export interface Factory {
  level: number;
  productionLines: ProductionLine[];
}

export interface Garage {
  maxCapacity: number;
  vehicles: Vehicle[];
}

export interface TechTree {
  currentLevel: number;
  isResearched: boolean[];
  // 解锁条件计数
  producedCount: number[];
}

export interface Resources {
  gold: number;
  parts: number;
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
  type: 'produce_count' | 'evolve_count' | 'intimacy_max'
       | 'quality_count' | 'trait_collect' | 'profit_total'
       | 'order_count' | 'prestige_count';
  target: number;
  params?: Record<string, unknown>;
}

export interface AchievementReward {
  gold?: number;
  parts?: number;
  title?: string;
  skin?: string;
}

export interface GameStats {
  totalGoldEarned: number;
  totalVehiclesProduced: number;
  totalOrdersCompleted: number;
  totalEvolutions: number;
  totalPlayTime: number;
  offlineTime: number;
}

export interface PrestigeData {
  count: number;
  points: number;
  purchases: string[];
}

export interface ChallengeData {
  speedRush: {
    bestScore: number;
    rank: ChallengeRank;
    dailyAttempts: number;
  };
  survival: {
    isUnlocked: boolean;
    bestProgress: number;
  };
  randomizer: {
    bestScore: number;
    completedRuns: number;
  };
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
  prestige: PrestigeData;
  challenge: ChallengeData;
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
  unlockCondition: {
    type: 'initial' | 'produce_count' | 'tech_level';
    targetTier?: number;
    targetCount?: number;
    techLevel?: number;
  };
  evolvedName: string;
  talentType: TalentType;
  talentDesc: string;
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

export interface TraitConfigEntry {
  type: TraitType;
  name: string;
  rarity: TraitRarity;
  effectType: string;
  effectValue: number;
  probability: number;
}

// ==================== 运行时状态 ====================

export interface GameState {
  phase: 'playing' | 'challenge' | 'prestige';
  resources: Resources;
  garage: Garage;
  factory: Factory;
  orders: Order[];
  techTree: TechTree;
  activeEvents: ActiveEvent[];
  achievements: Achievement[];
  stats: GameStats;
  prestige: PrestigeData;
  challenge: ChallengeData;
  settings: GameSettings;
}

export interface UIState {
  currentView: 'garage' | 'factory' | 'tech' | 'achievement' | 'challenge' | 'memorial';
  selectedVehicleId: string | null;
  visibleModal: string | null;
  notifications: string[];
}
