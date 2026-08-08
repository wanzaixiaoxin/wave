// ============================================================
// 车辆系统 — 创建、规格升级、翻新/出售/拆解（S2a 资产曲线核心）
// S2a：等级/经验/传承池已删除，改为里程（磨合加成 + 残值折旧）驱动的资产生命周期
// ============================================================

import { EventBus } from '../core/EventBus';
import {
  GameEvent, GameState, Vehicle, VehicleStats, BuildJob,
  Quality, QUALITY_ORDER, VehicleStatus, TraitType, Order,
  Specialization
} from '../core/types';
import { getVehicleConfig, getUnmetRequirements, getOccupiedSpaces, getParkingSpaces } from '../config/VehicleConfig';
import { rollTrait, getTraitConfig } from '../config/TraitConfig';
import {
  GAME_CONSTANTS, getMileageLifespan, overhaulPartsCost,
  statUpgradeCost, buildEnergyCost
} from '../config/GameConstants';
import { getSideTechRank, getEffectivePartsCost } from './TechSystem';
import { getUpgradeMult } from './UpgradeSystem';
import { getBuildQueueMax } from './FactorySystem';

/** 置换报价：UI 清单与 tradeIn 校验共用同一套数值口径 */
export interface TradeInQuote {
  ok: boolean;
  reason?: string;
  residual: number;      // 旧车当前残值（S2a 残值体系）
  scrapParts: number;    // 旧车回收零件（拆解口径 60%）
  scrapGold: number;     // 旧车回收金币（残值 × (30%+回收工艺)）
  buildGold: number;     // 新车金币成本（createVehicle 扣费口径）
  buildParts: number;    // 新车零件成本
  buildEnergy: number;   // 新车能源成本
  buildTime: number;     // 新车建造耗时（秒）
  goldDiff: number;      // 实际需补金币（buildGold - scrapGold，负数=倒找）
}

/**
 * 残值曲线（S2a，模块级纯函数，EconomySystem 净资产等共用）：
 * 实付造价 × max(15%, 1 - 里程/里程寿命) × (1 - 磨损/200)
 * 里程寿命 = 3000 × tier（T1 小车 3000km 报废期，T10 30000km）
 */
export function getResidualValue(state: GameState, vehicle: Vehicle): number {
  const config = getVehicleConfig(vehicle.tier);
  if (!config) return 0;
  // 实付价口径：按当前统一乘区（批量采购/精益生产）折算的造车金币
  const paidCost = Math.floor(config.buildCost * getUpgradeMult(state, 'build_cost'));
  const mileageFactor = Math.max(
    GAME_CONSTANTS.RESIDUAL_MIN_RATIO,
    1 - vehicle.mileage / getMileageLifespan(vehicle.tier, vehicle.stats.durability)
  );
  const wearFactor = 1 - vehicle.wear / GAME_CONSTANTS.RESIDUAL_WEAR_FACTOR;
  return Math.floor(paidCost * mileageFactor * wearFactor);
}

/** 出售报价（S2a）：残值 × (1 + 技术档案 7%×阶数)，UI 与 sellVehicle 同一口径 */
export function getSellPrice(state: GameState, vehicle: Vehicle): number {
  const archiveRank = getSideTechRank(state, 'archive');
  return Math.floor(
    getResidualValue(state, vehicle) * (1 + GAME_CONSTANTS.SIDE_ARCHIVE_RESIDUAL_PER_RANK * archiveRank)
  );
}

export class VehicleSystem {
  private state: GameState;
  private vehicleIdCounter = 0;

  /** 测试用：true 时造车/升品即时完成（smoke 等同步断言用），游戏内保持 false */
  debugInstantBuild = false;

  constructor(state: GameState) {
    this.state = state;
    this.vehicleIdCounter = state.garage.vehicles.length;

    // 订单完成 → 累积里程（S2a）：实际耗时(秒) × (5 + tier)，吃老练出厂参数/耐用配置的磨合增速
    EventBus.on(GameEvent.ORDER_COMPLETED, (...args: unknown[]) => {
      const order = args[0] as Order;
      const vehicle = args[1] as Vehicle | undefined;
      if (order && vehicle) {
        const actualSeconds = order.assignedAt
          ? (Date.now() - order.assignedAt) / 1000
          : order.duration;
        this.addMileage(vehicle, actualSeconds);
      }
    });
  }

  /** 里程累积（含磨合增速加成：老练出厂参数 ×1.2、耐用运营配置 ×1.15） */
  addMileage(vehicle: Vehicle, actualSeconds: number): void {
    let gain = actualSeconds * (GAME_CONSTANTS.MILEAGE_SPEED_BASE + vehicle.tier);
    if (vehicle.trait) {
      const tc = getTraitConfig(vehicle.trait);
      if (tc?.effectType === 'breakin') gain *= tc.effectValue;
    }
    if (vehicle.specialization === Specialization.Steady) {
      gain *= GAME_CONSTANTS.SPEC_STEADY_BREAKIN_MULT;
    }
    vehicle.mileage += Math.floor(gain);
  }

  // ==================== 创建车辆（M7：建造队列） ====================

  /**
   * 造车 = 加入建造队列。建造槽 1 个 + 排队最多 BUILD_QUEUE_MAX 个；
   * 资源在入队时扣除（防刷），车库按占格数（parkingSpaces，S2a）预留未来车位。
   * 返回：入队成功返回 BuildJob；debugInstantBuild 下即时落地返回 Vehicle；失败返回 null
   */
  createVehicle(tier: number): Vehicle | BuildJob | null {
    const config = getVehicleConfig(tier);
    if (!config) return null;

    // 预留未来车位（占格数口径）：建造完成时车库必然有位置
    if (getOccupiedSpaces(this.state) + config.parkingSpaces > this.state.garage.maxCapacity) {
      EventBus.emit(GameEvent.GARAGE_FULL, tier);
      return null;
    }

    if (this.state.garage.buildQueue.length >= 1 + getBuildQueueMax(this.state)) return null;

    // 市场准入（M9）：时代差异化解锁矩阵（科技/工厂/电站/声望/产量，逐车型声明）
    if (getUnmetRequirements(this.state, tier).length > 0) return null;

    // 造车金币：批量采购子科技 / 精益生产改造（v1.3 统一乘区）
    const buildCost = Math.floor(config.buildCost * getUpgradeMult(this.state, 'build_cost'));
    if (this.state.resources.gold < buildCost) return null;
    const partsCost = getEffectivePartsCost(this.state, config.partsCost);
    if (this.state.resources.parts < partsCost) return null;
    // 造车耗电（M8）：5 × tier²，入队时扣除，不足禁止入队
    const energyCost = buildEnergyCost(tier);
    if (this.state.resources.energy < energyCost) return null;

    this.state.resources.gold -= buildCost;
    this.state.resources.parts -= partsCost;
    this.state.resources.energy -= energyCost;

    // 建造耗时：改良工具 / 流水线优化子科技 / 装配工艺改造（v1.3 统一乘区）
    const totalTime = Math.max(1, Math.round(config.buildTime * getUpgradeMult(this.state, 'build_time')));
    const job: BuildJob = { tier, totalTime, finishAt: 0 };
    this.state.garage.buildQueue.push(job);
    // 空队列直接上建造槽，开始倒计时
    if (this.state.garage.buildQueue.length === 1) {
      job.finishAt = Date.now() + job.totalTime * 1000;
    }

    if (this.debugInstantBuild) {
      // 测试模式：立即清空队列逐辆落地，行为等同原即时造车
      while (this.state.garage.buildQueue.length > 0) {
        const j = this.state.garage.buildQueue.shift()!;
        this.produceVehicle(j.tier);
      }
      return this.state.garage.vehicles[this.state.garage.vehicles.length - 1] ?? null;
    }
    return job;
  }

  /** 建造落地：出厂参数随机、产量计数，与原即时造车路径一致 */
  private produceVehicle(tier: number): Vehicle {
    const config = getVehicleConfig(tier)!;
    const trait = rollTrait();
    // 车辆名称落地自动生成：车型名 + #编号（编号 = 该 tier 历史产出序号，保证不重复）
    const seq = this.state.techTree.producedCount[tier - 1] + 1;

    const vehicle: Vehicle = {
      id: `v_${Date.now()}_${this.vehicleIdCounter++}`,
      tier,
      name: `${config.name} #${seq}`,
      mileage: 0,
      refurbishCount: 0,
      quality: Quality.White,
      trait,
      stats: { speed: 0, cargo: 0, durability: 0 },
      specialization: null,
      wear: 0,
      consecutiveOrders: 0,
      lastOrderCompletedAt: 0,
      ordersCompleted: 0,
      totalEarnings: 0,
      createdAt: Date.now(),
      status: VehicleStatus.Idle,
      statusEndAt: 0,
      qualityUpgrade: null,
    };

    this.state.garage.vehicles.push(vehicle);
    this.state.stats.totalVehiclesProduced++;
    // 首台下线的品牌效应（M8）：某 tier 首次造出 +20×tier 声望（producedCount 防重复）
    // 手工艺传承子科技（v1.3）：首台下线声望 +20%/阶
    if (this.state.techTree.producedCount[tier - 1] === 0) {
      this.state.resources.reputation += Math.floor(
        GAME_CONSTANTS.REP_FIRST_BUILD_PER_TIER * tier * getUpgradeMult(this.state, 'first_produce_rep')
      );
    }
    this.state.techTree.producedCount[tier - 1]++;

    EventBus.emit(GameEvent.VEHICLE_PRODUCED, vehicle, config);
    return vehicle;
  }

  /** 结算建造队列：到点的建造槽车辆落地，下一辆上槽（可连续结算多辆，覆盖离线） */
  private settleBuildQueue(): void {
    const queue = this.state.garage.buildQueue;
    while (queue.length > 0 && queue[0].finishAt > 0 && Date.now() >= queue[0].finishAt) {
      const job = queue.shift()!;
      this.produceVehicle(job.tier);
      if (queue.length > 0) {
        queue[0].finishAt = Date.now() + queue[0].totalTime * 1000;
      }
    }
  }

  // ==================== 规格（M7：耗时化 + 锁车） ====================

  /**
   * 开始升级规格：白→蓝 60s、蓝→金 180s。
   * 门槛（S2a）：原等级门槛改为里程门槛——标准型需 10 单 + ≥300km，工业型需 ≥1500km。
   * 资源在开始升级时扣除（防刷）；期间车辆 status = Maintenance（不可接单/指派），
   * 到点后由 tick 应用规格并恢复 Idle。
   */
  upgradeQuality(vehicleId: string): boolean {
    const vehicle = this.getVehicle(vehicleId);
    if (!vehicle) return false;
    if (vehicle.qualityUpgrade) return false;                 // 已在升级中
    if (vehicle.status !== VehicleStatus.Idle) return false;  // 锁车前提：空闲才能进场升级

    const currentIdx = QUALITY_ORDER.indexOf(vehicle.quality);
    if (currentIdx >= QUALITY_ORDER.length - 1) return false;

    const nextQuality = QUALITY_ORDER[currentIdx + 1];

    if (nextQuality === Quality.Blue) {
      if (vehicle.ordersCompleted < GAME_CONSTANTS.QUALITY_BLUE_REQUIRED_ORDERS) return false;
      if (vehicle.mileage < GAME_CONSTANTS.QUALITY_BLUE_REQUIRED_MILEAGE) return false;
      if (this.state.resources.gold < GAME_CONSTANTS.QUALITY_BLUE_COST_GOLD) return false;
      if (this.state.resources.parts < GAME_CONSTANTS.QUALITY_BLUE_COST_PARTS) return false;
      if (this.state.resources.energy < GAME_CONSTANTS.ENERGY_QUALITY_BLUE) return false; // M8 耗电
      this.state.resources.gold -= GAME_CONSTANTS.QUALITY_BLUE_COST_GOLD;
      this.state.resources.parts -= GAME_CONSTANTS.QUALITY_BLUE_COST_PARTS;
      this.state.resources.energy -= GAME_CONSTANTS.ENERGY_QUALITY_BLUE;
    } else if (nextQuality === Quality.Gold) {
      if (vehicle.mileage < GAME_CONSTANTS.QUALITY_GOLD_REQUIRED_MILEAGE) return false;
      if (this.state.resources.gold < GAME_CONSTANTS.QUALITY_GOLD_COST_GOLD) return false;
      if (this.state.resources.parts < GAME_CONSTANTS.QUALITY_GOLD_COST_PARTS) return false;
      if (this.state.resources.energy < GAME_CONSTANTS.ENERGY_QUALITY_GOLD) return false; // M8 耗电
      this.state.resources.gold -= GAME_CONSTANTS.QUALITY_GOLD_COST_GOLD;
      this.state.resources.parts -= GAME_CONSTANTS.QUALITY_GOLD_COST_PARTS;
      this.state.resources.energy -= GAME_CONSTANTS.ENERGY_QUALITY_GOLD;
    }

    const totalTime = nextQuality === Quality.Blue
      ? GAME_CONSTANTS.QUALITY_UPGRADE_TIME_BLUE
      : GAME_CONSTANTS.QUALITY_UPGRADE_TIME_GOLD;
    vehicle.qualityUpgrade = {
      target: nextQuality,
      totalTime,
      finishAt: Date.now() + totalTime * 1000,
    };
    vehicle.status = VehicleStatus.Maintenance;

    if (this.debugInstantBuild) this.settleQualityUpgrade(vehicle);
    return true;
  }

  /** 到点结算规格升级：应用目标规格、恢复空闲、发事件 */
  private settleQualityUpgrade(vehicle: Vehicle): void {
    const job = vehicle.qualityUpgrade;
    if (!job) return;
    vehicle.qualityUpgrade = null;
    vehicle.quality = job.target;
    vehicle.status = VehicleStatus.Idle;
    EventBus.emit(GameEvent.QUALITY_UPGRADED, vehicle);
  }

  // ==================== 运营配置 ====================

  /**
   * 选择运营配置（蓝规格解锁，三选一，永久不可更改）
   */
  specialize(vehicleId: string, spec: Specialization): boolean {
    const vehicle = this.getVehicle(vehicleId);
    if (!vehicle) return false;
    if (vehicle.specialization) return false;
    if (vehicle.quality !== Quality.Blue && vehicle.quality !== Quality.Gold) return false;

    vehicle.specialization = spec;
    EventBus.emit(GameEvent.VEHICLE_STATS_CHANGED, vehicle);
    return true;
  }

  // ==================== 属性升级 ====================

  upgradeStat(vehicleId: string, stat: keyof VehicleStats): boolean {
    const vehicle = this.getVehicle(vehicleId);
    if (!vehicle) return false;
    if (vehicle.stats[stat] >= GAME_CONSTANTS.STAT_MAX_LEVEL) return false;

    const cost = statUpgradeCost(vehicle.stats[stat]);
    if (this.state.resources.gold < cost) return false;

    this.state.resources.gold -= cost;
    vehicle.stats[stat]++;
    EventBus.emit(GameEvent.VEHICLE_STATS_CHANGED, vehicle);
    return true;
  }

  // ==================== 检修 ====================

  private lastOverhaulTime: Record<string, number> = {};

  /**
   * 检修车辆（消耗零件）：只清磨损，无其他养成效果
   * S2a：成本随里程浮动 2⚙️ + floor(里程/2000)⚙️（老车检修更贵）
   */
  overhaul(vehicleId: string): boolean {
    const now = Date.now();
    const last = this.lastOverhaulTime[vehicleId] ?? 0;
    if (now - last < GAME_CONSTANTS.OVERHAUL_COOLDOWN * 1000) return false;

    const vehicle = this.getVehicle(vehicleId);
    if (!vehicle) return false;

    const partsCost = overhaulPartsCost(vehicle.mileage);
    if (this.state.resources.parts < partsCost) return false;

    this.state.resources.parts -= partsCost;
    this.lastOverhaulTime[vehicleId] = now;
    vehicle.wear = 0; // 检修修复磨损

    EventBus.emit(GameEvent.VEHICLE_STATS_CHANGED, vehicle);
    return true;
  }

  /** 当前检修零件成本（UI/sim 用，随里程浮动） */
  getOverhaulCost(vehicleId: string): number {
    const vehicle = this.getVehicle(vehicleId);
    return vehicle ? overhaulPartsCost(vehicle.mileage) : GAME_CONSTANTS.OVERHAUL_PARTS_COST;
  }

  /** 检修冷却剩余秒数（UI 用） */
  getOverhaulCooldownRemaining(vehicleId: string): number {
    const last = this.lastOverhaulTime[vehicleId] ?? 0;
    return Math.max(0, GAME_CONSTANTS.OVERHAUL_COOLDOWN - Math.floor((Date.now() - last) / 1000));
  }

  // ==================== 翻新（S2a：折旧回春，每车限 2 次） ====================

  /** 翻新费用：金币 floor(buildCost×0.35) + 零件 floor(partsCost×0.5) */
  getRefurbishCost(vehicleId: string): { gold: number; parts: number } | null {
    const vehicle = this.getVehicle(vehicleId);
    if (!vehicle) return null;
    const config = getVehicleConfig(vehicle.tier);
    if (!config) return null;
    return {
      gold: Math.floor(config.buildCost * GAME_CONSTANTS.REFURBISH_GOLD_RATIO),
      parts: Math.floor(config.partsCost * GAME_CONSTANTS.REFURBISH_PARTS_RATIO),
    };
  }

  /**
   * 翻新：磨损清零、里程 ×0.4（折旧回春，残值随之回升）；每车限 REFURBISH_MAX_COUNT 次
   */
  refurbish(vehicleId: string): boolean {
    const vehicle = this.getVehicle(vehicleId);
    if (!vehicle) return false;
    if (vehicle.status !== VehicleStatus.Idle) return false;
    if (vehicle.refurbishCount >= GAME_CONSTANTS.REFURBISH_MAX_COUNT) return false;

    const cost = this.getRefurbishCost(vehicleId);
    if (!cost) return false;
    if (this.state.resources.gold < cost.gold) return false;
    if (this.state.resources.parts < cost.parts) return false;

    this.state.resources.gold -= cost.gold;
    this.state.resources.parts -= cost.parts;
    vehicle.wear = 0;
    vehicle.mileage = Math.floor(vehicle.mileage * GAME_CONSTANTS.REFURBISH_MILEAGE_MULT);
    vehicle.refurbishCount++;
    this.state.stats.totalRefurbishes++;

    EventBus.emit(GameEvent.VEHICLE_STATS_CHANGED, vehicle);
    return true;
  }

  // ==================== 退役 ====================

  retireToHall(vehicleId: string): boolean {
    const vehicle = this.getVehicle(vehicleId);
    if (!vehicle) return false;

    vehicle.status = VehicleStatus.Retired;
    this.removeFromGarage(vehicleId);
    EventBus.emit(GameEvent.VEHICLE_RETIRED, vehicle);
    return true;
  }

  // ==================== 出售 / 拆解（S2a 残值体系） ====================

  /** 拆解返还预览（S2a 残值口径）：零件 60% + 金币 残值×(30%+回收工艺)（scrapVehicle / tradeIn / 置换弹窗共用，单一数据源） */
  getScrapPreview(vehicleId: string): { parts: number; gold: number } | null {
    const vehicle = this.getVehicle(vehicleId);
    if (!vehicle) return null;
    const config = getVehicleConfig(vehicle.tier);
    const parts = Math.floor((config?.partsCost ?? 0) * 0.6);
    // 回收工艺：拆解金币 = 残值 × (30% + 7%×阶数)（v1.3 支线 3 阶制）
    const scrapGoldRatio = GAME_CONSTANTS.SCRAP_GOLD_RESIDUAL_BASE +
      GAME_CONSTANTS.SIDE_RECYCLING_SCRAP_PER_RANK * getSideTechRank(this.state, 'recycling');
    const gold = Math.floor(getResidualValue(this.state, vehicle) * scrapGoldRatio);
    return { parts, gold };
  }

  scrapVehicle(vehicleId: string): { parts: number; gold: number; inheritedTrait: TraitType | null } {
    const vehicle = this.getVehicle(vehicleId);
    if (!vehicle) return { parts: 0, gold: 0, inheritedTrait: null };

    const preview = this.getScrapPreview(vehicleId)!;
    this.state.resources.parts += preview.parts;
    this.state.resources.gold += preview.gold;

    let inheritedTrait: TraitType | null = null;
    if (vehicle.trait && Math.random() < GAME_CONSTANTS.TRAIT_INHERIT_CHANCE) {
      inheritedTrait = vehicle.trait;
      EventBus.emit(GameEvent.VEHICLE_TRAIT_INHERITED, inheritedTrait);
    }

    this.removeFromGarage(vehicleId);
    return { parts: preview.parts, gold: preview.gold, inheritedTrait };
  }

  /**
   * 出售（S2a）：获得残值金币（技术档案每阶 +7%），车辆移除，无零件。
   * 与拆解的取舍：拆解金币少但返零件，出售金币多但无零件。
   */
  sellVehicle(vehicleId: string): number {
    const vehicle = this.getVehicle(vehicleId);
    if (!vehicle) return 0;
    if (vehicle.status !== VehicleStatus.Idle) return 0; // 派单中/升级中不可出售

    const price = getSellPrice(this.state, vehicle);
    this.state.resources.gold += price;
    this.removeFromGarage(vehicleId);
    return price;
  }

  // ==================== 以旧换新 ====================

  /**
   * 置换报价：旧车回收（S2a 残值口径）与新车成本（createVehicle 口径）分别列明，
   * 金币按差价净扣（回收金币先入账再扣新车费用）。ok=false 时 reason 为可读原因。
   */
  getTradeInQuote(oldVehicleId: string, newTier: number): TradeInQuote {
    const fail = (reason: string): TradeInQuote => ({
      ok: false, reason,
      residual: 0, scrapParts: 0, scrapGold: 0,
      buildGold: 0, buildParts: 0, buildEnergy: 0, buildTime: 0, goldDiff: 0,
    });

    const old = this.getVehicle(oldVehicleId);
    if (!old) return fail('旧车不存在');
    if (old.status !== VehicleStatus.Idle) return fail('车辆派单中/升级中，不可置换');
    const newConfig = getVehicleConfig(newTier);
    if (!newConfig) return fail('未知车型');
    if (newTier <= old.tier) return fail('相同或更低 tier 没有置换意义，可直接拆解旧车');

    // 市场准入（M9）：与 createVehicle 同一解锁矩阵
    const unmet = getUnmetRequirements(this.state, newTier);
    if (unmet.length > 0) return fail(`目标车型未解锁：${unmet.join('、')}`);

    // 建造队列有位（1 建造槽 + 排队位，与 createVehicle 同口径）
    if (this.state.garage.buildQueue.length >= 1 + getBuildQueueMax(this.state)) {
      return fail('建造队列已满');
    }
    // 车位核算（S2a 占格数口径）：旧车拆解先腾出自身占格，车库满时也允许同格数置换
    const freed = getParkingSpaces(old.tier);
    if (getOccupiedSpaces(this.state) - freed + newConfig.parkingSpaces > this.state.garage.maxCapacity) {
      return fail('车库车位不足（含建造队列预留，按占格数计）');
    }

    const scrap = this.getScrapPreview(oldVehicleId)!;
    const buildGold = Math.floor(newConfig.buildCost * getUpgradeMult(this.state, 'build_cost'));
    const buildParts = getEffectivePartsCost(this.state, newConfig.partsCost);
    const buildEnergy = buildEnergyCost(newTier);
    const buildTime = Math.max(1, Math.round(newConfig.buildTime * getUpgradeMult(this.state, 'build_time')));
    const goldDiff = buildGold - scrap.gold;

    // 总余额校验：回收金币/零件先入账再扣新车费用，差额不足则失败
    if (this.state.resources.gold + scrap.gold < buildGold) {
      return fail(`金币不足，还差 ${(buildGold - scrap.gold - this.state.resources.gold).toLocaleString()}🪙`);
    }
    if (this.state.resources.parts + scrap.parts < buildParts) return fail('零件不足');
    if (this.state.resources.energy < buildEnergy) return fail(`能源不足，需要 ${buildEnergy}⚡`);

    return {
      ok: true,
      residual: getResidualValue(this.state, old),
      scrapParts: scrap.parts, scrapGold: scrap.gold,
      buildGold, buildParts, buildEnergy, buildTime, goldDiff,
    };
  }

  /**
   * 以旧换新：一次确认完成「旧车拆解回收 + 新车进建造队列」。
   * 拆解复用 scrapVehicle（S2a 残值口径一致），新车复用 createVehicle
   * 内部路径（VEHICLE_PRODUCED 等事件链不变）。
   */
  tradeIn(oldVehicleId: string, newTier: number): { ok: boolean; reason?: string } {
    const quote = this.getTradeInQuote(oldVehicleId, newTier);
    if (!quote.ok) return { ok: false, reason: quote.reason };

    this.scrapVehicle(oldVehicleId);   // 1) 拆解旧车：返还口径与直接拆解一致
    this.createVehicle(newTier);       // 2) 新车入队：预校验通过，必然成功
    this.state.stats.totalTradeIns++;
    return { ok: true };
  }

  // ==================== 状态管理 ====================

  tick(_deltaSeconds: number): void {
    // 建造队列结算（时间戳制，离线期间到点的落地后下一辆自动上槽）
    this.settleBuildQueue();

    for (const v of this.state.garage.vehicles) {
      if (v.status === VehicleStatus.OnOrder && v.statusEndAt > 0 && Date.now() >= v.statusEndAt) {
        v.status = VehicleStatus.Idle;
        v.statusEndAt = 0;
      }
      // 规格升级到点结算
      if (v.qualityUpgrade && Date.now() >= v.qualityUpgrade.finishAt) {
        this.settleQualityUpgrade(v);
      }
    }
  }

  // ==================== 查询 ====================

  getVehicle(vehicleId: string): Vehicle | undefined {
    return this.state.garage.vehicles.find(v => v.id === vehicleId);
  }

  /** 当前残值（UI 详情/卡片/sim 换车决策共用） */
  getResidual(vehicleId: string): number {
    const vehicle = this.getVehicle(vehicleId);
    return vehicle ? getResidualValue(this.state, vehicle) : 0;
  }

  private removeFromGarage(vehicleId: string): void {
    const idx = this.state.garage.vehicles.findIndex(v => v.id === vehicleId);
    if (idx >= 0) this.state.garage.vehicles.splice(idx, 1);
  }
}
