// ============================================================
// 经济系统 — 收入计算、资源管理
// ============================================================

import { EventBus } from '../core/EventBus';
import { GameEvent, GameState, Vehicle, Quality, OrderType, Specialization } from '../core/types';
import { getVehicleConfig } from '../config/VehicleConfig';
import { getTraitConfig } from '../config/TraitConfig';
import { GAME_CONSTANTS, garageExpandCost, getBreakinBonus, cargoIncomeMult } from '../config/GameConstants';
import { getEventMultiplier } from './EventSystem';
import { getResidualValue } from './VehicleSystem';
import { getCityIncomeMult } from './CitySystem';

/**
 * 科技 L5 全厂收入倍率（唯一实现，OrderSystem / EconomySystem 共用）
 */
export function getGlobalIncomeMult(state: GameState): number {
  return state.techTree.currentLevel >= 5
    ? GAME_CONSTANTS.TECH_GLOBAL_INCOME_MULT
    : 1.0;
}

export class EconomySystem {
  private state: GameState;
  private expandCount = 0;

  constructor(state: GameState) {
    this.state = state;
    this.expandCount = Math.floor(
      (state.garage.maxCapacity - GAME_CONSTANTS.GARAGE_INITIAL_CAPACITY) / GAME_CONSTANTS.GARAGE_EXPAND_SPACES
    );
  }

  // ==================== 车库扩建 ====================

  expandGarage(): boolean {
    if (this.state.garage.maxCapacity >= GAME_CONSTANTS.GARAGE_MAX_CAPACITY) return false;

    const cost = garageExpandCost(this.expandCount);
    if (this.state.resources.gold < cost) return false;

    this.state.resources.gold -= cost;
    this.state.garage.maxCapacity += GAME_CONSTANTS.GARAGE_EXPAND_SPACES;
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
   * @param state 提供后启用：载货属性、重载出厂参数、牛市/熊市事件
   * @param orderType 订单类型（预留参数，供订单类型相关加成使用）
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
    // 磨合加成（S2a）：替代原「每级 +5%」——每 1000km +4%，上限 +40%
    const breakinMult = 1 + getBreakinBonus(vehicle.mileage);

    let qualityMult: number;
    switch (vehicle.quality) {
      case Quality.White: qualityMult = GAME_CONSTANTS.QUALITY_INCOME_MULT_WHITE; break;
      case Quality.Blue: qualityMult = GAME_CONSTANTS.QUALITY_INCOME_MULT_BLUE; break;
      case Quality.Gold: qualityMult = GAME_CONSTANTS.QUALITY_INCOME_MULT_GOLD; break;
    }

    let income = Math.floor(basePrice * breakinMult * qualityMult * orderTypeMult * globalMult);

    // 出厂参数加成（节能）
    if (vehicle.trait) {
      const tc = getTraitConfig(vehicle.trait);
      if (tc?.effectType === 'income') {
        income = Math.floor(income * tc.effectValue);
      }
    }

    if (state) {
      // S4 城市乘区：压力惩罚（客户压价）× 繁荣加成 × 城际走廊项目
      income = Math.floor(income * getCityIncomeMult(state));

      // 载货属性：递进曲线加成（满级 +25%）
      income = Math.floor(income * cargoIncomeMult(vehicle.stats.cargo));

      // 载货 L3 断点：贵重单收入 +15%（大件运输车吃高价单）
      if (orderType === OrderType.Valuable && vehicle.stats.cargo >= 3) {
        income = Math.floor(income * (1 + GAME_CONSTANTS.CARGO_L3_VALUABLE_BONUS));
      }

      // 重载出厂参数：载货加成转化为收入加成
      if (vehicle.trait) {
        const tc = getTraitConfig(vehicle.trait);
        if (tc?.effectType === 'cargo') {
          income = Math.floor(income * tc.effectValue);
        }
      }

      // 运营配置收入修正（快运 -10% / 重载 +25%）
      if (vehicle.specialization === Specialization.Express) {
        income = Math.floor(income * GAME_CONSTANTS.SPEC_EXPRESS_INCOME_MULT);
      } else if (vehicle.specialization === Specialization.Heavy) {
        income = Math.floor(income * GAME_CONSTANTS.SPEC_HEAVY_INCOME_MULT);
      }

      // 牛市/熊市事件
      income = Math.floor(income * getEventMultiplier(state, 'price_mult'));

      // 高磨损惩罚：收入 -30%
      if (vehicle.wear >= GAME_CONSTANTS.WEAR_PENALTY_THRESHOLD) {
        income = Math.floor(income * GAME_CONSTANTS.WEAR_INCOME_MULT);
      }

      // 疲劳递减：连续接单每单 -8%（下限 ×0.6），逼玩家轮班经营；速度 L3 断点：衰减减半
      const fatigueDecay = GAME_CONSTANTS.FATIGUE_DECAY *
        (vehicle.stats.speed >= 3 ? GAME_CONSTANTS.SPEED_L3_FATIGUE_MULT : 1);
      const fatigueMult = Math.max(
        GAME_CONSTANTS.FATIGUE_MIN_MULT,
        1 - vehicle.consecutiveOrders * fatigueDecay
      );
      income = Math.floor(income * fatigueMult);
    }

    // 暴击（基础 5%，载货 L5 断点 +5%，含「精准」出厂参数暴击率加成、「幸运」出厂参数暴击倍率）
    let critRate = 0.05;
    if (vehicle.stats.cargo >= GAME_CONSTANTS.STAT_MAX_LEVEL) {
      critRate += GAME_CONSTANTS.CARGO_L5_CRIT_RATE;
    }
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
   * 获取总资产（S2a：车辆按当前残值计入，随里程/磨损折旧）
   */
  getNetWorth(): number {
    let worth = this.state.resources.gold;

    for (const v of this.state.garage.vehicles) {
      worth += getResidualValue(this.state, v);
    }

    return worth;
  }
}
