// ============================================================
// 车辆系统 — 创建、升级、进化、退役
// ============================================================

import { EventBus } from '../core/EventBus';
import {
  GameEvent, GameState, Vehicle, VehicleStats, BuildJob,
  Quality, QUALITY_ORDER, qualityRank, VehicleStatus, TraitType, TalentType, Order,
  Specialization
} from '../core/types';
import { getVehicleConfig, getUnmetRequirements } from '../config/VehicleConfig';
import { rollTrait, getTraitConfig } from '../config/TraitConfig';
import {
  GAME_CONSTANTS, expForLevel, cumulativeExpForLevel,
  statUpgradeCost, buildEnergyCost
} from '../config/GameConstants';
import { getSideTechRank, getEffectivePartsCost } from './TechSystem';
import { getUpgradeMult } from './UpgradeSystem';
import { getBuildQueueMax } from './FactorySystem';

export class VehicleSystem {
  private state: GameState;
  private vehicleIdCounter = 0;

  /** 测试用：true 时造车/升品即时完成（smoke 等同步断言用），游戏内保持 false */
  debugInstantBuild = false;

  constructor(state: GameState) {
    this.state = state;
    this.vehicleIdCounter = state.garage.vehicles.length;

    // 订单完成 → 统一走 addExp() 发放经验（含特质/品质加成与升级判定）
    EventBus.on(GameEvent.ORDER_COMPLETED, (...args: unknown[]) => {
      const order = args[0] as Order;
      const vehicle = args[1] as Vehicle | undefined;
      if (order && vehicle) {
        this.addExp(vehicle.id, order.expReward);
      }
    });
  }

  // ==================== 创建车辆（M7：建造队列） ====================

  /**
   * 造车 = 加入建造队列。建造槽 1 个 + 排队最多 BUILD_QUEUE_MAX 个；
   * 资源在入队时扣除（防刷），车库按「现有 + 建造中 + 排队」预留未来车位。
   * 返回：入队成功返回 BuildJob；debugInstantBuild 下即时落地返回 Vehicle；失败返回 null
   */
  createVehicle(tier: number): Vehicle | BuildJob | null {
    const config = getVehicleConfig(tier);
    if (!config) return null;

    // 预留未来车位：建造完成时车库必然有位置
    if (this.state.garage.vehicles.length + this.state.garage.buildQueue.length >= this.state.garage.maxCapacity) {
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

  /** 建造落地：特质随机、传承池继承、产量计数，与原即时造车路径一致 */
  private produceVehicle(tier: number): Vehicle {
    const config = getVehicleConfig(tier)!;
    const trait = rollTrait();

    const vehicle: Vehicle = {
      id: `v_${Date.now()}_${this.vehicleIdCounter++}`,
      tier,
      name: config.name,
      level: 1,
      exp: 0,
      quality: Quality.White,
      trait,
      intimacy: 0,
      stats: { speed: 0, cargo: 0, durability: 0 },
      isEvolved: false,
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

    // 传承池：拆解旧车沉淀的经验，新车落地一次性继承（原始经验，不吃特质/品质加成）
    const pool = this.state.garage.inheritanceExp;
    if (pool > 0) {
      this.state.garage.inheritanceExp = 0;
      this.state.stats.totalVehiclesInherited++;
      vehicle.exp += pool;
      while (vehicle.level < this.getMaxLevel(vehicle.quality, vehicle.isEvolved)) {
        const needed = expForLevel(vehicle.level);
        if (vehicle.exp >= needed) {
          vehicle.exp -= needed;
          vehicle.level++;
        } else {
          break;
        }
      }
    }

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

  nameVehicle(vehicleId: string, name: string): boolean {
    const vehicle = this.getVehicle(vehicleId);
    if (!vehicle) return false;
    vehicle.name = name;
    EventBus.emit(GameEvent.VEHICLE_NAMED, vehicle);
    return true;
  }

  // ==================== 等级 ====================

  addExp(vehicleId: string, exp: number): boolean {
    const vehicle = this.getVehicle(vehicleId);
    if (!vehicle) return false;

    const traitConfig = getTraitConfig(vehicle.trait!);
    if (traitConfig?.effectType === 'exp') {
      exp = Math.floor(exp * traitConfig.effectValue);
    }

    // 稳健专精：经验 ×1.15
    if (vehicle.specialization === 'steady') {
      exp = Math.floor(exp * GAME_CONSTANTS.SPEC_STEADY_EXP_MULT);
    }

    const qualityExpMultMap: Record<Quality, number> = {
      [Quality.White]: GAME_CONSTANTS.QUALITY_EXP_MULT_WHITE,
      [Quality.Blue]: GAME_CONSTANTS.QUALITY_EXP_MULT_BLUE,
      [Quality.Gold]: GAME_CONSTANTS.QUALITY_EXP_MULT_GOLD,
    };
    exp = Math.floor(exp * (1 + qualityExpMultMap[vehicle.quality]));

    vehicle.exp += exp;

    while (vehicle.level < this.getMaxLevel(vehicle.quality, vehicle.isEvolved)) {
      const needed = expForLevel(vehicle.level);
      if (vehicle.exp >= needed) {
        vehicle.exp -= needed;
        vehicle.level++;
        EventBus.emit(GameEvent.VEHICLE_LEVEL_UP, vehicle);
      } else {
        break;
      }
    }

    return true;
  }

  // ==================== 品质（M7：耗时化 + 锁车） ====================

  /**
   * 开始品质升级：白→蓝 60s、蓝→金 180s。
   * 资源在开始升级时扣除（防刷）；期间车辆 status = Maintenance（不可接单/指派），
   * 到点后由 tick 应用品质并恢复 Idle。
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
      if (this.state.resources.gold < GAME_CONSTANTS.QUALITY_BLUE_COST_GOLD) return false;
      if (this.state.resources.parts < GAME_CONSTANTS.QUALITY_BLUE_COST_PARTS) return false;
      if (this.state.resources.energy < GAME_CONSTANTS.ENERGY_QUALITY_BLUE) return false; // M8 耗电
      this.state.resources.gold -= GAME_CONSTANTS.QUALITY_BLUE_COST_GOLD;
      this.state.resources.parts -= GAME_CONSTANTS.QUALITY_BLUE_COST_PARTS;
      this.state.resources.energy -= GAME_CONSTANTS.ENERGY_QUALITY_BLUE;
    } else if (nextQuality === Quality.Gold) {
      if (vehicle.level < GAME_CONSTANTS.QUALITY_GOLD_REQUIRED_LEVEL) return false;
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

  /** 到点结算品质升级：应用目标品质、恢复空闲、发事件 */
  private settleQualityUpgrade(vehicle: Vehicle): void {
    const job = vehicle.qualityUpgrade;
    if (!job) return;
    vehicle.qualityUpgrade = null;
    vehicle.quality = job.target;
    vehicle.status = VehicleStatus.Idle;
    EventBus.emit(GameEvent.QUALITY_UPGRADED, vehicle);
  }

  // ==================== 专精 ====================

  /**
   * 选择专精（蓝品质解锁，三选一，永久不可更改）
   */
  specialize(vehicleId: string, spec: Specialization): boolean {
    const vehicle = this.getVehicle(vehicleId);
    if (!vehicle) return false;
    if (vehicle.specialization) return false;
    if (qualityRank(vehicle.quality) < qualityRank(Quality.Blue)) return false;

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

  // ==================== 进化 ====================

  evolve(vehicleId: string): boolean {
    const vehicle = this.getVehicle(vehicleId);
    if (!vehicle) return false;
    if (vehicle.isEvolved) return false;
    if (vehicle.quality !== Quality.Gold) return false;
    if (vehicle.level < GAME_CONSTANTS.MAX_VEHICLE_LEVEL) return false;
    if (vehicle.intimacy < GAME_CONSTANTS.INTIMACY_EVOLVE_REQUIREMENT) return false;
    if (this.state.resources.energy < GAME_CONSTANTS.ENERGY_EVOLVE) return false; // M8 耗电

    this.state.resources.energy -= GAME_CONSTANTS.ENERGY_EVOLVE;

    // 进化效果：
    // 1. 等级上限 +5（getMaxLevel 对进化车生效）
    // 2. 收入 ×3（EconomySystem.calculateOrderIncome 按 isEvolved 加成）
    // 3. 车型专属天赋生效（收入/耗时/零件/刷新等，见 EconomySystem / OrderSystem）
    // 4. 品牌声望 +100（M8）
    vehicle.isEvolved = true;
    this.state.stats.totalEvolutions++;
    this.state.resources.reputation += GAME_CONSTANTS.REP_EVOLVE;

    EventBus.emit(GameEvent.VEHICLE_EVOLVED, vehicle);
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

  scrapVehicle(vehicleId: string): { parts: number; inheritedTrait: TraitType | null; inheritedExp: number } {
    const vehicle = this.getVehicle(vehicleId);
    if (!vehicle) return { parts: 0, inheritedTrait: null, inheritedExp: 0 };

    const config = getVehicleConfig(vehicle.tier);
    const partsReturned = Math.floor((config?.partsCost ?? 0) * 0.6);
    this.state.resources.parts += partsReturned;
    // 回收工艺：拆解金币返还 30% + 7%×阶数（v1.3 支线 3 阶制）
    const scrapGoldRatio = 0.3 +
      GAME_CONSTANTS.SIDE_RECYCLING_SCRAP_PER_RANK * getSideTechRank(this.state, 'recycling');
    this.state.resources.gold += Math.floor((config?.buildCost ?? 0) * scrapGoldRatio);

    // 传承：累计经验按比例沉淀进传承池，下一辆新车继承（技术档案每阶 +6 个百分点）
    const lifetimeExp = cumulativeExpForLevel(vehicle.level) + vehicle.exp;
    const inheritRatio = GAME_CONSTANTS.INHERIT_EXP_RATIO
      + GAME_CONSTANTS.SIDE_ARCHIVE_INHERIT_PER_RANK * getSideTechRank(this.state, 'archive');
    const inheritedExp = Math.floor(lifetimeExp * inheritRatio);
    this.state.garage.inheritanceExp += inheritedExp;

    let inheritedTrait: TraitType | null = null;
    if (vehicle.trait && Math.random() < GAME_CONSTANTS.TRAIT_INHERIT_CHANCE) {
      inheritedTrait = vehicle.trait;
      EventBus.emit(GameEvent.VEHICLE_TRAIT_INHERITED, inheritedTrait);
    }

    this.removeFromGarage(vehicleId);
    return { parts: partsReturned, inheritedTrait, inheritedExp };
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
      // 品质升级到点结算
      if (v.qualityUpgrade && Date.now() >= v.qualityUpgrade.finishAt) {
        this.settleQualityUpgrade(v);
      }
    }
  }

  // ==================== 查询 ====================

  getVehicle(vehicleId: string): Vehicle | undefined {
    return this.state.garage.vehicles.find(v => v.id === vehicleId);
  }

  getMaxLevel(quality: Quality, isEvolved = false): number {
    let base: number;
    switch (quality) {
      case Quality.White: base = GAME_CONSTANTS.QUALITY_WHITE_MAX_LEVEL; break;
      case Quality.Blue: base = GAME_CONSTANTS.QUALITY_BLUE_MAX_LEVEL; break;
      case Quality.Gold: base = GAME_CONSTANTS.QUALITY_GOLD_MAX_LEVEL; break;
    }
    return isEvolved ? base + GAME_CONSTANTS.EVOLVED_LEVEL_BONUS : base;
  }

  getTalentType(tier: number): TalentType | undefined {
    return getVehicleConfig(tier)?.talentType;
  }

  getEvolvedName(tier: number): string | undefined {
    return getVehicleConfig(tier)?.evolvedName;
  }

  private removeFromGarage(vehicleId: string): void {
    const idx = this.state.garage.vehicles.findIndex(v => v.id === vehicleId);
    if (idx >= 0) this.state.garage.vehicles.splice(idx, 1);
  }
}
