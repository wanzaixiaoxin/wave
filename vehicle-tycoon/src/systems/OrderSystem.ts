// ============================================================
// 订单系统 — 生成、指派、完成、结算
// ============================================================

import { EventBus } from '../core/EventBus';
import {
  GameEvent, GameState, Order, OrderType, OrderStatus,
  VehicleStatus, Quality, qualityRank
} from '../core/types';
import { getVehicleConfig } from '../config/VehicleConfig';
import { GAME_CONSTANTS } from '../config/GameConstants';
import { EconomySystem, getGlobalIncomeMult } from './EconomySystem';

export class OrderSystem {
  private state: GameState;
  private orderIdCounter = 0;
  private orderGenTimer = 0;

  constructor(state: GameState) {
    this.state = state;
    this.orderIdCounter = state.orders.length;
    this.orderGenTimer = 8; // 首次订单约 2 秒后出现
  }

  // ==================== Tick（每秒） ====================

  tick(deltaSeconds: number): void {
    this.orderGenTimer += deltaSeconds;

    // 每 10-15 秒生成一个新订单
    if (this.orderGenTimer >= 10 + Math.random() * 5) {
      this.orderGenTimer = 0;
      if (this.state.orders.filter(o => o.status === OrderStatus.Pending).length < 3) {
        this.generateOrder();
      }
    }

    // 自动结算到期订单（先收集，避免遍历中修改数组）
    const now = Date.now();
    const toComplete: string[] = [];
    const toExpire: string[] = [];

    for (const order of this.state.orders) {
      if (order.status === OrderStatus.InProgress) {
        const vehicle = this.state.garage.vehicles.find(v => v.id === order.assignedVehicleId);
        // 车辆已被拆解/不存在，或时间已到 → 结算
        if (!vehicle || (now >= vehicle.statusEndAt && vehicle.statusEndAt > 0)) {
          toComplete.push(order.id);
        }
      } else if (order.status === OrderStatus.Pending && now >= order.expiresAt) {
        toExpire.push(order.id);
      }
    }

    toComplete.forEach(id => this.completeOrder(id));
    toExpire.forEach(id => this.removeOrder(id));
  }

  // ==================== 生成订单 ====================

  private generateOrder(): void {
    const types = [OrderType.Normal, OrderType.LongDistance, OrderType.Valuable];
    const weights = [0.5, 0.3, 0.2];
    const rand = Math.random();
    let cumulative = 0;
    let selectedType = OrderType.Normal;

    for (let i = 0; i < types.length; i++) {
      cumulative += weights[i];
      if (rand < cumulative) {
        selectedType = types[i];
        break;
      }
    }

    // 如果没有任何车辆满足条件，降级为普通订单
    let type = selectedType;
    if (type === OrderType.LongDistance && !this.hasVehicleWithDurability(3)) {
      type = OrderType.Normal;
    }
    if (type === OrderType.Valuable && !this.hasVehicleWithQuality(Quality.Blue)) {
      type = OrderType.Normal;
    }

    // 选一个随机 tier 作为订单基准
    const availableTiers = this.state.garage.vehicles
      .filter(v => v.status === VehicleStatus.Idle)
      .map(v => v.tier);
    const baseTier = availableTiers.length > 0
      ? availableTiers[Math.floor(Math.random() * availableTiers.length)]
      : 1;

    const config = getVehicleConfig(baseTier);
    if (!config) return;

    let baseReward: number;
    let expReward: number;
    let duration: number;
    let requiredDurability: number | undefined;
    let requiredQuality: Quality | undefined;

    switch (type) {
      case OrderType.Normal:
        baseReward = config.basePrice;
        expReward = GAME_CONSTANTS.ORDER_NORMAL_EXP_BASE;
        duration = GAME_CONSTANTS.ORDER_NORMAL_DURATION;
        break;
      case OrderType.LongDistance:
        baseReward = config.basePrice * 2;
        expReward = GAME_CONSTANTS.ORDER_NORMAL_EXP_BASE * GAME_CONSTANTS.ORDER_LONG_DIST_EXP_MULT;
        duration = GAME_CONSTANTS.ORDER_LONG_DIST_DURATION;
        requiredDurability = 3;
        break;
      case OrderType.Valuable:
        baseReward = config.basePrice * 3;
        expReward = GAME_CONSTANTS.ORDER_NORMAL_EXP_BASE * GAME_CONSTANTS.ORDER_VALUABLE_EXP_MULT;
        duration = GAME_CONSTANTS.ORDER_VALUABLE_DURATION;
        requiredQuality = Quality.Blue;
        break;
    }

    const order: Order = {
      id: `o_${Date.now()}_${this.orderIdCounter++}`,
      type,
      baseReward,
      expReward,
      duration,
      requiredDurability,
      requiredQuality,
      assignedVehicleId: null,
      status: OrderStatus.Pending,
      createdAt: Date.now(),
      expiresAt: Date.now() + GAME_CONSTANTS.ORDER_EXPIRE_TIME * 1000,
    };

    this.state.orders.push(order);
    EventBus.emit(GameEvent.ORDER_GENERATED, order);
  }

  // ==================== 指派 ====================

  /**
   * 指派车辆执行订单
   */
  assignVehicle(orderId: string, vehicleId: string): boolean {
    const order = this.state.orders.find(o => o.id === orderId);
    const vehicle = this.state.garage.vehicles.find(v => v.id === vehicleId);

    if (!order || !vehicle) return false;
    if (order.status !== OrderStatus.Pending) return false;
    if (vehicle.status !== VehicleStatus.Idle) return false;

    // 检查条件
    if (order.requiredDurability && vehicle.stats.durability < order.requiredDurability) {
      return false;
    }
    if (order.requiredQuality && qualityRank(vehicle.quality) < qualityRank(order.requiredQuality)) {
      return false;
    }

    order.assignedVehicleId = vehicleId;
    order.status = OrderStatus.InProgress;
    vehicle.status = VehicleStatus.OnOrder;
    vehicle.statusEndAt = Date.now() + order.duration * 1000;

    EventBus.emit(GameEvent.ORDER_ASSIGNED, order, vehicle);
    return true;
  }

  // ==================== 完成订单 ====================

  /**
   * 完成订单（由 tick 或手动触发）
   */
  completeOrder(orderId: string): boolean {
    const order = this.state.orders.find(o => o.id === orderId);
    if (!order || order.status !== OrderStatus.InProgress) return false;

    const vehicle = this.state.garage.vehicles.find(v => v.id === order.assignedVehicleId);

    order.status = OrderStatus.Completed;
    let totalReward = 0;
    let isCrit = false;
    let critMult = 1;

    if (vehicle) {
      // 收入统一走 EconomySystem（等级/品质/特质/暴击 + 科技L5全局加成）
      const result = EconomySystem.calculateOrderIncome(
        vehicle, order.baseReward, 1.0, getGlobalIncomeMult(this.state)
      );
      totalReward = result.income;
      isCrit = result.isCrit;
      critMult = result.critMult;

      // 加金币
      this.state.resources.gold += totalReward;
      this.state.stats.totalGoldEarned += totalReward;
      this.state.stats.totalOrdersCompleted++;

      // 经验由 VehicleSystem 监听 ORDER_COMPLETED 后统一走 addExp() 处理
      // （含特质/品质加成与升级判定），此处不再直接累加
      vehicle.ordersCompleted++;
      vehicle.totalEarnings += totalReward;

      // 加亲密度（完成订单少量增加）
      vehicle.intimacy = Math.min(
        GAME_CONSTANTS.MAX_INTIMACY,
        vehicle.intimacy + 1
      );

      // 零件产出
      const config = getVehicleConfig(vehicle.tier);
      if (config) {
        let partsReward = Math.floor(totalReward * 0.01);
        // 轮船天赋加成
        if (vehicle.isEvolved && vehicle.tier === 7) {
          partsReward = Math.floor(partsReward * 2);
        }
        this.state.resources.parts += partsReward;
      }

      vehicle.status = VehicleStatus.Idle;
      vehicle.statusEndAt = 0;
    }

    this.removeOrder(orderId);
    EventBus.emit(GameEvent.ORDER_COMPLETED, order, vehicle, totalReward, isCrit, critMult);
    return true;
  }

  // ==================== 查询方法 ====================

  getAvailableOrders(): Order[] {
    return this.state.orders.filter(o => o.status === OrderStatus.Pending);
  }

  canVehicleTakeOrder(vehicleId: string, order: Order): boolean {
    const vehicle = this.state.garage.vehicles.find(v => v.id === vehicleId);
    if (!vehicle || vehicle.status !== VehicleStatus.Idle) return false;
    if (order.requiredDurability && vehicle.stats.durability < order.requiredDurability) return false;
    if (order.requiredQuality && qualityRank(vehicle.quality) < qualityRank(order.requiredQuality)) return false;
    return true;
  }

  private hasVehicleWithDurability(minDurability: number): boolean {
    return this.state.garage.vehicles.some(
      v => v.status === VehicleStatus.Idle && v.stats.durability >= minDurability
    );
  }

  private hasVehicleWithQuality(minQuality: Quality): boolean {
    return this.state.garage.vehicles.some(
      v => v.status === VehicleStatus.Idle && qualityRank(v.quality) >= qualityRank(minQuality)
    );
  }

  private removeOrder(orderId: string): void {
    const idx = this.state.orders.findIndex(o => o.id === orderId);
    if (idx >= 0) this.state.orders.splice(idx, 1);
  }
}
