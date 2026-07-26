// ============================================================
// 车辆系统 — 创建、升级、进化、退役
// ============================================================

import { EventBus } from '../core/EventBus';
import {
  GameEvent, GameState, Vehicle, VehicleStats,
  Quality, QUALITY_ORDER, qualityRank, VehicleStatus, TraitType, TalentType, Order,
  Specialization
} from '../core/types';
import { getVehicleConfig } from '../config/VehicleConfig';
import { rollTrait, getTraitConfig } from '../config/TraitConfig';
import {
  GAME_CONSTANTS, expForLevel, cumulativeExpForLevel,
  statUpgradeCost
} from '../config/GameConstants';
import { hasSideTech, getEffectivePartsCost } from './TechSystem';

export class VehicleSystem {
  private state: GameState;
  private vehicleIdCounter = 0;

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

  // ==================== 创建车辆 ====================

  createVehicle(tier: number): Vehicle | null {
    const config = getVehicleConfig(tier);
    if (!config) return null;

    if (this.state.garage.vehicles.length >= this.state.garage.maxCapacity) {
      EventBus.emit(GameEvent.GARAGE_FULL, tier);
      return null;
    }

    if (this.state.resources.gold < config.buildCost) return null;
    const partsCost = getEffectivePartsCost(this.state, config.partsCost);
    if (this.state.resources.parts < partsCost) return null;

    this.state.resources.gold -= config.buildCost;
    this.state.resources.parts -= partsCost;

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
    };

    this.state.garage.vehicles.push(vehicle);
    this.state.stats.totalVehiclesProduced++;
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

  // ==================== 品质 ====================

  upgradeQuality(vehicleId: string): boolean {
    const vehicle = this.getVehicle(vehicleId);
    if (!vehicle) return false;

    const currentIdx = QUALITY_ORDER.indexOf(vehicle.quality);
    if (currentIdx >= QUALITY_ORDER.length - 1) return false;

    const nextQuality = QUALITY_ORDER[currentIdx + 1];

    if (nextQuality === Quality.Blue) {
      if (vehicle.ordersCompleted < GAME_CONSTANTS.QUALITY_BLUE_REQUIRED_ORDERS) return false;
      if (this.state.resources.gold < GAME_CONSTANTS.QUALITY_BLUE_COST_GOLD) return false;
      if (this.state.resources.parts < GAME_CONSTANTS.QUALITY_BLUE_COST_PARTS) return false;
      this.state.resources.gold -= GAME_CONSTANTS.QUALITY_BLUE_COST_GOLD;
      this.state.resources.parts -= GAME_CONSTANTS.QUALITY_BLUE_COST_PARTS;
    } else if (nextQuality === Quality.Gold) {
      if (vehicle.level < GAME_CONSTANTS.QUALITY_GOLD_REQUIRED_LEVEL) return false;
      if (this.state.resources.gold < GAME_CONSTANTS.QUALITY_GOLD_COST_GOLD) return false;
      if (this.state.resources.parts < GAME_CONSTANTS.QUALITY_GOLD_COST_PARTS) return false;
      this.state.resources.gold -= GAME_CONSTANTS.QUALITY_GOLD_COST_GOLD;
      this.state.resources.parts -= GAME_CONSTANTS.QUALITY_GOLD_COST_PARTS;
    }

    vehicle.quality = nextQuality;
    EventBus.emit(GameEvent.QUALITY_UPGRADED, vehicle);
    return true;
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

    // 进化效果：
    // 1. 等级上限 +5（getMaxLevel 对进化车生效）
    // 2. 收入 ×3（EconomySystem.calculateOrderIncome 按 isEvolved 加成）
    // 3. 车型专属天赋生效（收入/耗时/零件/刷新等，见 EconomySystem / OrderSystem）
    vehicle.isEvolved = true;
    this.state.stats.totalEvolutions++;

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
    // 回收工艺：拆解金币返还 30% → 50%
    const scrapGoldRatio = hasSideTech(this.state, 'recycling')
      ? GAME_CONSTANTS.SIDE_RECYCLING_SCRAP_GOLD
      : 0.3;
    this.state.resources.gold += Math.floor((config?.buildCost ?? 0) * scrapGoldRatio);

    // 传承：累计经验按比例沉淀进传承池，下一辆新车继承（技术档案 +15%）
    const lifetimeExp = cumulativeExpForLevel(vehicle.level) + vehicle.exp;
    const inheritRatio = GAME_CONSTANTS.INHERIT_EXP_RATIO
      + (hasSideTech(this.state, 'archive') ? GAME_CONSTANTS.SIDE_ARCHIVE_INHERIT_BONUS : 0);
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
    for (const v of this.state.garage.vehicles) {
      if (v.status === VehicleStatus.OnOrder && v.statusEndAt > 0 && Date.now() >= v.statusEndAt) {
        v.status = VehicleStatus.Idle;
        v.statusEndAt = 0;
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
