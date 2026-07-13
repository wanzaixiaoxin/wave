// ============================================================
// 经济系统 — 收入计算、资源管理
// ============================================================

import { EventBus } from '../core/EventBus';
import { GameEvent, GameState, Vehicle, Quality } from '../core/types';
import { getVehicleConfig } from '../config/VehicleConfig';
import { getTraitConfig } from '../config/TraitConfig';
import { GAME_CONSTANTS, garageExpandCost } from '../config/GameConstants';

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
   * 计算单次订单收入
   */
  static calculateOrderIncome(
    vehicle: Vehicle,
    basePrice: number,
    orderTypeMult: number,
    globalMult: number
  ): { income: number; isCrit: boolean } {
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

    // 暴击判定
    const critRate = 0.05 + vehicle.stats.speed * 0.01;
    const isCrit = Math.random() < critRate;

    if (isCrit) {
      let critMult = GAME_CONSTANTS.CRIT_MULT_DEFAULT;
      if (vehicle.trait) {
        const tc = getTraitConfig(vehicle.trait);
        if (tc?.effectType === 'crit_mult') {
          critMult = tc.effectValue;
        }
      }
      income = Math.floor(income * critMult);
    }

    return { income, isCrit };
  }

  // ==================== 统计查询 ====================

  /**
   * 获取每秒收入估算
   */
  getEstimatedEPS(): number {
    let total = 0;
    for (const v of this.state.garage.vehicles) {
      if (v.status !== 'idle') continue;
      const config = getVehicleConfig(v.tier);
      if (!config) continue;
      const { income } = EconomySystem.calculateOrderIncome(v, config.basePrice, 1.0, 1.0);
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
