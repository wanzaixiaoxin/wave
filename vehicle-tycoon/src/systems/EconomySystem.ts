// ============================================================
// 经济系统 — 收入计算、资源管理
// ============================================================

import { EventBus } from '../core/EventBus';
import { GameEvent, GameState, Vehicle, Quality, OrderType, TalentType, Specialization } from '../core/types';
import { getVehicleConfig } from '../config/VehicleConfig';
import { getTraitConfig } from '../config/TraitConfig';
import { GAME_CONSTANTS, garageExpandCost } from '../config/GameConstants';
import { getEventMultiplier } from './EventSystem';

/**
 * 科技 L5 全厂收入倍率（唯一实现，OrderSystem / EconomySystem 共用）
 */
export function getGlobalIncomeMult(state: GameState): number {
  return state.techTree.currentLevel >= 5
    ? GAME_CONSTANTS.TECH_GLOBAL_INCOME_MULT
    : 1.0;
}

/**
 * 进化天赋带来的收入倍率（未进化为 1）
 * 需要 state 的天赋：T6 火车（同型车数量）、T10 星际飞船（全厂光环）
 */
export function getTalentIncomeMult(vehicle: Vehicle, state?: GameState, orderType?: OrderType): number {
  if (!vehicle.isEvolved) return 1.0;
  const talent = getVehicleConfig(vehicle.tier)?.talentType;
  let mult = 1.0;

  switch (talent) {
    case TalentType.Noble:
      // T3 马车：长途/贵重单收入加成
      if (orderType === OrderType.LongDistance || orderType === OrderType.Valuable) {
        mult *= GAME_CONSTANTS.TALENT_NOBLE_HIGH_ORDER_MULT;
      }
      break;
    case TalentType.Speedster:
      // T4 小汽车：短途（普通）订单收入 ×2
      if (orderType === OrderType.Normal) {
        mult *= GAME_CONSTANTS.TALENT_SPEEDSTER_NORMAL_MULT;
      }
      break;
    case TalentType.Hauler:
      mult *= GAME_CONSTANTS.TALENT_HAULER_INCOME_MULT;
      break;
    case TalentType.Convoy: {
      // T6 火车：车库中同型车每 1 辆 +5%
      if (state) {
        const sameTier = state.garage.vehicles.filter(v => v.tier === vehicle.tier).length;
        mult *= 1 + sameTier * GAME_CONSTANTS.TALENT_CONVOY_PER_VEHICLE;
      }
      break;
    }
  }

  // T10 星际飞船光环：车库中每艘进化飞船使全车型收入 ×1.15（最多叠 2 层，抗膨胀）
  if (state) {
    const warpCount = Math.min(
      state.garage.vehicles.filter(
        v => v.isEvolved && getVehicleConfig(v.tier)?.talentType === TalentType.Warp
      ).length,
      GAME_CONSTANTS.TALENT_WARP_MAX_STACKS
    );
    mult *= Math.pow(GAME_CONSTANTS.TALENT_WARP_GLOBAL_MULT, warpCount);
  }

  return mult;
}

export class EconomySystem {
  private state: GameState;
  private expandCount = 0;

  constructor(state: GameState) {
    this.state = state;
    this.expandCount = Math.floor((state.garage.maxCapacity - GAME_CONSTANTS.GARAGE_INITIAL_CAPACITY) / 2);
  }

  // ==================== 车库扩建 ====================

  expandGarage(): boolean {
    if (this.state.garage.maxCapacity >= GAME_CONSTANTS.GARAGE_MAX_CAPACITY) return false;

    const cost = garageExpandCost(this.expandCount);
    if (this.state.resources.gold < cost) return false;

    this.state.resources.gold -= cost;
    this.state.garage.maxCapacity += 2;
    this.expandCount++;

    EventBus.emit(GameEvent.GARAGE_EXPANDED, this.state.garage.maxCapacity);
    return true;
  }

  getNextExpandCost(): number {
    if (this.state.garage.maxCapacity >= GAME_CONSTANTS.GARAGE_MAX_CAPACITY) return -1;
    return garageExpandCost(this.expandCount);
  }

  // ==================== 订单收入计算（静态方法，供外部使用） ====================

  /**
   * 计算单次订单收入（唯一的收入计算入口）
   * @param rollCrit true=真实掷暴击（结算用）；false=按期望值折算（估算用，结果确定）
   * @param state 提供后启用：进化倍率、载货属性、强壮特质、进化天赋、牛市/熊市事件
   * @param orderType 订单类型（影响 T3/T4 天赋判定）
   */
  static calculateOrderIncome(
    vehicle: Vehicle,
    basePrice: number,
    orderTypeMult: number,
    globalMult: number,
    rollCrit = true,
    state?: GameState,
    orderType?: OrderType
  ): { income: number; isCrit: boolean; critMult: number } {
    const levelMult = 1 + vehicle.level * 0.05;

    let qualityMult: number;
    switch (vehicle.quality) {
      case Quality.White: qualityMult = GAME_CONSTANTS.QUALITY_INCOME_MULT_WHITE; break;
      case Quality.Blue: qualityMult = GAME_CONSTANTS.QUALITY_INCOME_MULT_BLUE; break;
      case Quality.Gold: qualityMult = GAME_CONSTANTS.QUALITY_INCOME_MULT_GOLD; break;
    }

    let income = Math.floor(basePrice * levelMult * qualityMult * orderTypeMult * globalMult);

    // 特质加成（招财）
    if (vehicle.trait) {
      const tc = getTraitConfig(vehicle.trait);
      if (tc?.effectType === 'income') {
        income = Math.floor(income * tc.effectValue);
      }
    }

    if (state) {
      // 载货属性：每级收入 +4%
      income = Math.floor(income * (1 + vehicle.stats.cargo * GAME_CONSTANTS.CARGO_INCOME_PER_LEVEL));

      // 强壮特质：载货加成转化为收入加成
      if (vehicle.trait) {
        const tc = getTraitConfig(vehicle.trait);
        if (tc?.effectType === 'cargo') {
          income = Math.floor(income * tc.effectValue);
        }
      }

      // 专精收入修正（快车 -10% / 重载 +25%）
      if (vehicle.specialization === Specialization.Express) {
        income = Math.floor(income * GAME_CONSTANTS.SPEC_EXPRESS_INCOME_MULT);
      } else if (vehicle.specialization === Specialization.Heavy) {
        income = Math.floor(income * GAME_CONSTANTS.SPEC_HEAVY_INCOME_MULT);
      }

      // 进化：收入 ×3
      if (vehicle.isEvolved) {
        income = Math.floor(income * GAME_CONSTANTS.EVOLVED_INCOME_MULT);
      }

      // 进化天赋（含 T10 全厂光环）
      income = Math.floor(income * getTalentIncomeMult(vehicle, state, orderType));

      // 牛市/熊市事件
      income = Math.floor(income * getEventMultiplier(state, 'price_mult'));

      // 高磨损惩罚：收入 -30%
      if (vehicle.wear >= GAME_CONSTANTS.WEAR_PENALTY_THRESHOLD) {
        income = Math.floor(income * GAME_CONSTANTS.WEAR_INCOME_MULT);
      }

      // 疲劳递减：连续接单每单 -8%（下限 ×0.6），逼玩家轮班经营
      const fatigueMult = Math.max(
        GAME_CONSTANTS.FATIGUE_MIN_MULT,
        1 - vehicle.consecutiveOrders * GAME_CONSTANTS.FATIGUE_DECAY
      );
      income = Math.floor(income * fatigueMult);
    }

    // 暴击（基础 5%，含「精准」特质暴击率加成、「幸运」特质暴击倍率）
    let critRate = 0.05;
    let critMult = GAME_CONSTANTS.CRIT_MULT_DEFAULT;
    if (vehicle.trait) {
      const tc = getTraitConfig(vehicle.trait);
      if (tc?.effectType === 'crit_rate') {
        critRate += tc.effectValue;
      }
      if (tc?.effectType === 'crit_mult') {
        critMult = tc.effectValue;
      }
    }

    if (rollCrit) {
      const isCrit = Math.random() < critRate;
      if (isCrit) {
        income = Math.floor(income * critMult);
      }
      return { income, isCrit, critMult: isCrit ? critMult : 1 };
    }

    // 期望模式：按 暴击率 × (倍率-1) 折算额外收益，结果确定
    income = Math.floor(income * (1 + critRate * (critMult - 1)));
    return { income, isCrit: false, critMult: 1 };
  }

  // ==================== 统计查询 ====================

  /**
   * 获取每秒收入估算
   */
  getEstimatedEPS(): number {
    let total = 0;
    const globalMult = getGlobalIncomeMult(this.state);
    for (const v of this.state.garage.vehicles) {
      if (v.status !== 'idle') continue;
      const config = getVehicleConfig(v.tier);
      if (!config) continue;
      // rollCrit=false → 期望模式，EPS 不再每秒随机跳动
      const { income } = EconomySystem.calculateOrderIncome(
        v, config.basePrice, 1.0, globalMult, false, this.state, OrderType.Normal
      );
      total += income / GAME_CONSTANTS.ORDER_NORMAL_DURATION;
    }
    return Math.floor(total);
  }

  /**
   * 获取总资产
   */
  getNetWorth(): number {
    let worth = this.state.resources.gold;

    for (const v of this.state.garage.vehicles) {
      const config = getVehicleConfig(v.tier);
      if (config) {
        worth += Math.floor(config.basePrice * (1 + v.level * 0.1));
      }
    }

    return worth;
  }
}
