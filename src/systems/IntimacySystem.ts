// ============================================================
// 亲密度系统 — 互动、等级、解锁
// ============================================================

import { EventBus } from '../core/EventBus';
import { GameEvent, GameState } from '../core/types';
import { GAME_CONSTANTS } from '../config/GameConstants';

export class IntimacySystem {
  private state: GameState;
  private lastWashTime: Record<string, number> = {};
  private lastRepairTime: Record<string, number> = {};
  private lastTapTime: Record<string, number> = {};

  constructor(state: GameState) {
    this.state = state;
  }

  // ==================== 互动操作 ====================

  /**
   * 清洗车辆
   */
  wash(vehicleId: string): boolean {
    const now = Date.now();
    const last = this.lastWashTime[vehicleId] ?? 0;
    if (now - last < GAME_CONSTANTS.INTIMACY_WASH_COOLDOWN * 1000) return false;

    const vehicle = this.state.garage.vehicles.find(v => v.id === vehicleId);
    if (!vehicle) return false;

    this.lastWashTime[vehicleId] = now;
    vehicle.intimacy = Math.min(
      GAME_CONSTANTS.MAX_INTIMACY,
      vehicle.intimacy + GAME_CONSTANTS.INTIMACY_WASH_AMOUNT
    );

    EventBus.emit(GameEvent.INTIMACY_CHANGED, vehicleId, vehicle.intimacy);
    return true;
  }

  /**
   * 保养车辆（消耗零件）
   */
  repair(vehicleId: string): boolean {
    const now = Date.now();
    const last = this.lastRepairTime[vehicleId] ?? 0;
    if (now - last < GAME_CONSTANTS.INTIMACY_REPAIR_COOLDOWN * 1000) return false;

    const vehicle = this.state.garage.vehicles.find(v => v.id === vehicleId);
    if (!vehicle) return false;

    // 零件消耗
    const partsCost = 2;
    if (this.state.resources.parts < partsCost) return false;

    this.state.resources.parts -= partsCost;
    this.lastRepairTime[vehicleId] = now;
    vehicle.intimacy = Math.min(
      GAME_CONSTANTS.MAX_INTIMACY,
      vehicle.intimacy + GAME_CONSTANTS.INTIMACY_REPAIR_AMOUNT
    );

    EventBus.emit(GameEvent.INTIMACY_CHANGED, vehicleId, vehicle.intimacy);
    return true;
  }

  /**
   * 点击互动
   */
  tap(vehicleId: string): boolean {
    const now = Date.now();
    const last = this.lastTapTime[vehicleId] ?? 0;
    if (now - last < GAME_CONSTANTS.INTIMACY_TAP_COOLDOWN * 1000) {
      return false; // 冷却中
    }

    const vehicle = this.state.garage.vehicles.find(v => v.id === vehicleId);
    if (!vehicle) return false;

    this.lastTapTime[vehicleId] = now;
    vehicle.intimacy = Math.min(
      GAME_CONSTANTS.MAX_INTIMACY,
      vehicle.intimacy + GAME_CONSTANTS.INTIMACY_TAP_AMOUNT
    );

    EventBus.emit(GameEvent.INTIMACY_CHANGED, vehicleId, vehicle.intimacy);
    return true;
  }

  // ==================== 查询 ====================

  /**
   * 获取亲密度等级
   */
  getIntimacyLevel(vehicleId: string): number {
    const vehicle = this.state.garage.vehicles.find(v => v.id === vehicleId);
    if (!vehicle) return 0;

    if (vehicle.intimacy >= 100) return 5;
    if (vehicle.intimacy >= 80) return 4;
    if (vehicle.intimacy >= 60) return 3;
    if (vehicle.intimacy >= 40) return 2;
    if (vehicle.intimacy >= 20) return 1;
    return 0;
  }

  /**
   * 检查互动冷却
   */
  getWashCooldownRemaining(vehicleId: string): number {
    const last = this.lastWashTime[vehicleId] ?? 0;
    return Math.max(0, GAME_CONSTANTS.INTIMACY_WASH_COOLDOWN - Math.floor((Date.now() - last) / 1000));
  }

  getRepairCooldownRemaining(vehicleId: string): number {
    const last = this.lastRepairTime[vehicleId] ?? 0;
    return Math.max(0, GAME_CONSTANTS.INTIMACY_REPAIR_COOLDOWN - Math.floor((Date.now() - last) / 1000));
  }

  getTapCooldownRemaining(vehicleId: string): number {
    const last = this.lastTapTime[vehicleId] ?? 0;
    return Math.max(0, GAME_CONSTANTS.INTIMACY_TAP_COOLDOWN - Math.floor((Date.now() - last) / 1000));
  }
}
