// ============================================================
// 订单系统 — 生成、指派、完成、结算
// ============================================================

import { EventBus } from '../core/EventBus';
import {
  GameEvent, GameState, Order, OrderType, OrderStatus,
  Vehicle, VehicleStatus, Quality, qualityRank, TalentType, Specialization,
  EnRouteEventChoice
} from '../core/types';
import { getVehicleConfig } from '../config/VehicleConfig';
import { getTraitConfig } from '../config/TraitConfig';
import { getEnRouteEventConfig, rollEnRouteEvent } from '../config/EnRouteEventConfig';
import { GAME_CONSTANTS } from '../config/GameConstants';
import { EconomySystem, getGlobalIncomeMult } from './EconomySystem';
import { getEventMultiplier } from './EventSystem';
import { hasSideTech } from './TechSystem';

export class OrderSystem {
  private state: GameState;
  private orderIdCounter = 0;
  private orderGenTimer = 0;

  constructor(state: GameState) {
    this.state = state;
    this.orderIdCounter = state.orders.length;
    this.orderGenTimer = 8; // 首次订单约 2 秒后出现

    // 「大订单」事件：立即刷出一个 3 倍奖励的普通订单
    EventBus.on(GameEvent.RANDOM_EVENT_TRIGGERED, (...args: unknown[]) => {
      const payload = args[0] as { id?: string } | undefined;
      if (payload?.id === 'big_order') {
        this.generateOrder(3.0);
      }
    });
  }

  // ==================== Tick（每秒） ====================

  tick(deltaSeconds: number): void {
    this.orderGenTimer += deltaSeconds;

    // 订单供给随进度扩张：生成间隔 5-8 秒（T8 飞机天赋 ×0.7），
    // 待接单上限随科技等级提升（L1:3 → L3:4 → L5:5）
    let genInterval = 3.5 + Math.random() * 2;
    if (this.hasEvolvedTalent(TalentType.Network)) {
      genInterval *= GAME_CONSTANTS.TALENT_NETWORK_REFRESH_MULT;
    }
    // 辅助科技「物流优化」：订单生成间隔 ×0.8
    if (hasSideTech(this.state, 'logistics')) {
      genInterval *= GAME_CONSTANTS.SIDE_LOGISTICS_INTERVAL_MULT;
    }
    const maxPending = 3 + this.state.techTree.currentLevel;
    if (this.orderGenTimer >= genInterval) {
      this.orderGenTimer = 0;
      if (this.state.orders.filter(o => o.status === OrderStatus.Pending).length < maxPending) {
        this.generateOrder();
      }
    }

    // 路上事件（M1）：到点未触发 → 发事件弹窗；已触发超决策窗口未决策 → 自动走默认项
    // （车辆已不存在或订单结算时仍未触发的事件随订单静默丢弃）
    const now = Date.now();
    for (const order of this.state.orders) {
      const ee = order.enRouteEvent;
      if (order.status !== OrderStatus.InProgress || !ee || ee.resolved) continue;
      const vehicle = this.state.garage.vehicles.find(v => v.id === order.assignedVehicleId);
      if (!vehicle) continue; // 车辆不存在，订单马上被结算，事件丢弃

      if (ee.triggeredAt === undefined) {
        if (now >= ee.triggerAt) {
          // 同屏最多 1 个待决策事件：已有未决策的触发事件时，本事件顺延 3 秒
          if (this.hasPendingEnRouteEvent()) {
            ee.triggerAt = now + GAME_CONSTANTS.EN_ROUTE_POSTPONE_SECONDS * 1000;
            continue;
          }
          ee.triggeredAt = now;
          EventBus.emit(GameEvent.EN_ROUTE_EVENT_TRIGGERED, order, vehicle);
        }
      } else if (now >= ee.triggeredAt +
        (GAME_CONSTANTS.EN_ROUTE_DECISION_WINDOW + GAME_CONSTANTS.EN_ROUTE_DECISION_TOLERANCE) * 1000) {
        // 超时/挂机兜底：自动按默认项结算（默认项对玩家无害）
        this.resolveEnRouteEventDefault(order.id);
      }
    }

    // 自动结算到期订单（先收集，避免遍历中修改数组）
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

  private generateOrder(rewardMult = 1.0): void {
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

    // 订单 tier 按车队最高战力定锚：在「最高 tier 及其下两级」内生成，
    // 低 tier 垃圾单随进度自然淘汰（高 tier 车可以向下兼容接单）
    const topTier = this.state.garage.vehicles.length > 0
      ? Math.max(...this.state.garage.vehicles.map(v => v.tier))
      : 1;
    const roll = Math.random();
    let baseTier: number;
    if (roll < 0.5 || topTier <= 1) {
      baseTier = topTier;
    } else if (roll < 0.8 || topTier <= 2) {
      baseTier = topTier - 1;
    } else {
      baseTier = topTier - 2;
    }

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

    // 高 tier 订单耗时更长（时间是最根本的抗膨胀货币）
    duration = Math.round(duration * (1 + (baseTier - 1) * 0.08));

    const order: Order = {
      id: `o_${Date.now()}_${this.orderIdCounter++}`,
      type,
      tier: baseTier,
      baseReward: Math.floor(baseReward * rewardMult),
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

    // 检查条件：低 tier 车辆不能承接高 tier 订单
    if (vehicle.tier < order.tier) return false;
    if (order.requiredDurability && vehicle.stats.durability < order.requiredDurability) {
      return false;
    }
    if (order.requiredQuality && qualityRank(vehicle.quality) < qualityRank(order.requiredQuality)) {
      return false;
    }

    order.assignedVehicleId = vehicleId;
    order.status = OrderStatus.InProgress;
    vehicle.status = VehicleStatus.OnOrder;

    // 订单耗时加成：速度属性每级 -4%、勤快特质 ×0.85、T1 天赋 ×0.8、
    // 专精（快车 ×0.75 / 重载 ×1.15）、高磨损 ×1.2
    let duration = order.duration;
    duration *= 1 - vehicle.stats.speed * GAME_CONSTANTS.SPEED_DURATION_PER_LEVEL;
    if (vehicle.trait) {
      const tc = getTraitConfig(vehicle.trait);
      if (tc?.effectType === 'speed') {
        duration *= tc.effectValue;
      }
    }
    if (vehicle.isEvolved && getVehicleConfig(vehicle.tier)?.talentType === TalentType.Agile) {
      duration *= GAME_CONSTANTS.TALENT_AGILE_DURATION_MULT;
    }
    if (vehicle.specialization === Specialization.Express) {
      duration *= GAME_CONSTANTS.SPEC_EXPRESS_DURATION_MULT;
    } else if (vehicle.specialization === Specialization.Heavy) {
      duration *= GAME_CONSTANTS.SPEC_HEAVY_DURATION_MULT;
    }
    if (vehicle.wear >= GAME_CONSTANTS.WEAR_PENALTY_THRESHOLD) {
      duration *= GAME_CONSTANTS.WEAR_DURATION_MULT;
    }
    const departAt = Date.now();
    vehicle.statusEndAt = departAt + duration * 1000;

    // 路上事件（M1）：按概率排定一个途中事件（普通/贵重 40%、长途 70%），
    // 触发点在行程 30%-70% 之间的随机时刻
    const triggerChance = order.type === OrderType.LongDistance
      ? GAME_CONSTANTS.EN_ROUTE_TRIGGER_CHANCE_LONG
      : GAME_CONSTANTS.EN_ROUTE_TRIGGER_CHANCE_NORMAL;
    if (Math.random() < triggerChance) {
      const evt = rollEnRouteEvent();
      order.enRouteEvent = {
        eventId: evt.id,
        triggerAt: departAt + duration * 1000 *
          (GAME_CONSTANTS.EN_ROUTE_TRIGGER_POINT_MIN + Math.random() * GAME_CONSTANTS.EN_ROUTE_TRIGGER_POINT_RANGE),
        resolved: false,
      };
    }

    EventBus.emit(GameEvent.ORDER_ASSIGNED, order, vehicle);
    return true;
  }

  // ==================== 路上事件（M1） ====================

  /**
   * 是否存在已触发但未决策的路上事件（同屏最多 1 个）
   */
  private hasPendingEnRouteEvent(): boolean {
    return this.state.orders.some(o =>
      o.status === OrderStatus.InProgress &&
      o.enRouteEvent && !o.enRouteEvent.resolved && o.enRouteEvent.triggeredAt !== undefined
    );
  }

  /**
   * 选项是否可选（耐久门槛 / 零件消耗校验，UI 层据此置灰）
   */
  isEnRouteChoiceAvailable(choice: EnRouteEventChoice, vehicle: Vehicle): boolean {
    if (choice.requiredDurability && vehicle.stats.durability < choice.requiredDurability) return false;
    if (choice.partsCost && this.state.resources.parts < choice.partsCost) return false;
    return true;
  }

  /**
   * 默认项下标：优先 isDefault 且可选的选项；默认项不可选（如耐久不足）时退到第一个可选项
   */
  private getDefaultChoiceIndex(eventId: string, vehicle: Vehicle): number {
    const config = getEnRouteEventConfig(eventId);
    if (!config) return 0;
    const defaultIdx = config.choices.findIndex(c => c.isDefault);
    if (defaultIdx >= 0 && this.isEnRouteChoiceAvailable(config.choices[defaultIdx], vehicle)) {
      return defaultIdx;
    }
    const firstAvailable = config.choices.findIndex(c => this.isEnRouteChoiceAvailable(c, vehicle));
    return firstAvailable >= 0 ? firstAvailable : 0;
  }

  /**
   * 按默认项决策（超时/挂机兜底，UI 倒计时结束也走这里）
   */
  resolveEnRouteEventDefault(orderId: string): boolean {
    const order = this.state.orders.find(o => o.id === orderId);
    const ee = order?.enRouteEvent;
    if (!order || !ee) return false;
    const vehicle = this.state.garage.vehicles.find(v => v.id === order.assignedVehicleId);
    if (!vehicle) return false;
    return this.resolveEnRouteEvent(orderId, this.getDefaultChoiceIndex(ee.eventId, vehicle));
  }

  /**
   * 决策路上事件：应用选项效果
   * 耗时变化直接改 vehicle.statusEndAt；收入倍率累乘到 order.pendingRewardMult（结算时乘入）；
   * 磨损/零件/金币/亲密度立即结算
   */
  resolveEnRouteEvent(orderId: string, choiceIndex: number): boolean {
    const order = this.state.orders.find(o => o.id === orderId);
    if (!order || order.status !== OrderStatus.InProgress) return false;
    const ee = order.enRouteEvent;
    if (!ee || ee.resolved || ee.triggeredAt === undefined) return false;
    const config = getEnRouteEventConfig(ee.eventId);
    const vehicle = this.state.garage.vehicles.find(v => v.id === order.assignedVehicleId);
    if (!config || !vehicle) return false;
    const choice = config.choices[choiceIndex];
    if (!choice || !this.isEnRouteChoiceAvailable(choice, vehicle)) return false;

    const now = Date.now();

    // 耗时变化：倍率作用于剩余时间，秒数直接加到截止时刻
    if (choice.durationMult) {
      vehicle.statusEndAt = now + Math.round((vehicle.statusEndAt - now) * choice.durationMult);
    }
    if (choice.durationDeltaSec) {
      vehicle.statusEndAt += choice.durationDeltaSec * 1000;
    }

    // 本单收入倍率（累乘，completeOrder 结算时走 EconomySystem 统一乘区）
    if (choice.rewardMult) {
      order.pendingRewardMult = (order.pendingRewardMult ?? 1) * choice.rewardMult;
    }

    // 磨损增减
    if (choice.wearDelta) {
      vehicle.wear = Math.min(GAME_CONSTANTS.WEAR_MAX, Math.max(0, vehicle.wear + choice.wearDelta));
    }

    // 零件消耗（可选性已校验，此处双保险不为负）
    if (choice.partsCost) {
      this.state.resources.parts = Math.max(0, this.state.resources.parts - choice.partsCost);
    }

    // 金币消耗：按本单期望收入百分比（期望模式计算，结果确定）
    if (choice.goldCostPct) {
      const estIncome = EconomySystem.calculateOrderIncome(
        vehicle, order.baseReward, order.pendingRewardMult ?? 1,
        getGlobalIncomeMult(this.state), false, this.state, order.type
      ).income;
      this.state.resources.gold = Math.max(0, this.state.resources.gold - Math.floor(estIncome * choice.goldCostPct));
    }

    // 亲密度增加
    if (choice.intimacyGain) {
      vehicle.intimacy = Math.min(GAME_CONSTANTS.MAX_INTIMACY, vehicle.intimacy + choice.intimacyGain);
    }

    ee.resolved = true;
    ee.choiceIndex = choiceIndex;
    EventBus.emit(GameEvent.EN_ROUTE_EVENT_RESOLVED, order, vehicle, choiceIndex);
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
      // 疲劳重置：距上一单完成超过 30 秒，连续计数清零（在收入计算之前）
      const now = Date.now();
      if (now - vehicle.lastOrderCompletedAt > GAME_CONSTANTS.FATIGUE_RESET_SECONDS * 1000) {
        vehicle.consecutiveOrders = 0;
      }

      // 收入统一走 EconomySystem（等级/品质/特质/载货/专精/进化/天赋/事件/磨损/疲劳 + 暴击 + 科技L5全局加成）
      // 路上事件的收入倍率（pendingRewardMult）落在 orderTypeMult 乘区，保持乘区统一
      const result = EconomySystem.calculateOrderIncome(
        vehicle, order.baseReward, order.pendingRewardMult ?? 1, getGlobalIncomeMult(this.state),
        true, this.state, order.type
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

      // 加亲密度（完成订单的主要亲密度来源；双倍亲密度事件生效）
      const intimacyGain = GAME_CONSTANTS.INTIMACY_ORDER_AMOUNT * getEventMultiplier(this.state, 'intimacy_mult');
      vehicle.intimacy = Math.min(
        GAME_CONSTANTS.MAX_INTIMACY,
        vehicle.intimacy + Math.floor(intimacyGain)
      );

      // 零件产出：收入 1% + tier 保底，叠加 T7/T9 天赋与零件雨事件
      const config = getVehicleConfig(vehicle.tier);
      if (config) {
        let partsReward = Math.floor(totalReward * 0.01) + vehicle.tier;
        if (vehicle.isEvolved) {
          if (config.talentType === TalentType.Explorer) {
            partsReward = Math.floor(partsReward * GAME_CONSTANTS.TALENT_EXPLORER_PARTS_MULT);
          }
          if (config.talentType === TalentType.Stellar) {
            partsReward = Math.floor(partsReward * GAME_CONSTANTS.TALENT_STELLAR_PARTS_MULT);
          }
        }
        partsReward = Math.floor(partsReward * getEventMultiplier(this.state, 'parts_mult'));
        this.state.resources.parts += partsReward;
      }

      vehicle.status = VehicleStatus.Idle;
      vehicle.statusEndAt = 0;

      // 磨损累积（稳健专精减半）与疲劳计数
      const wearGain = GAME_CONSTANTS.WEAR_PER_ORDER *
        (vehicle.specialization === Specialization.Steady ? GAME_CONSTANTS.SPEC_STEADY_WEAR_MULT : 1);
      vehicle.wear = Math.min(GAME_CONSTANTS.WEAR_MAX, vehicle.wear + wearGain);
      vehicle.consecutiveOrders++;
      vehicle.lastOrderCompletedAt = now;

      // T2 自行车天赋：完成订单后自动接下一个可接的待接订单
      if (vehicle.isEvolved && config?.talentType === TalentType.Endurance) {
        const next = this.getAvailableOrders()
          .sort((a, b) => b.baseReward - a.baseReward)
          .find(o => this.canVehicleTakeOrder(vehicle.id, o));
        if (next) {
          this.assignVehicle(next.id, vehicle.id);
        }
      }
    }

    this.removeOrder(orderId);
    EventBus.emit(GameEvent.ORDER_COMPLETED, order, vehicle, totalReward, isCrit, critMult);
    return true;
  }

  // ==================== 查询方法 ====================

  getAvailableOrders(): Order[] {
    return this.state.orders.filter(o => o.status === OrderStatus.Pending);
  }

  /**
   * 获取某辆车正在执行的订单（用于 UI 显示进度）
   */
  getInProgressOrder(vehicleId: string): Order | undefined {
    return this.state.orders.find(
      o => o.status === OrderStatus.InProgress && o.assignedVehicleId === vehicleId
    );
  }

  /**
   * 自动派单：贪心匹配（高价订单优先，派给能接的最低等级车，大车留给大单）
   * @returns 成功派出的订单数
   */
  autoAssign(): number {
    const pending = this.getAvailableOrders()
      .sort((a, b) => b.baseReward - a.baseReward);

    let assigned = 0;
    for (const order of pending) {
      const candidates = this.state.garage.vehicles
        .filter(v => this.canVehicleTakeOrder(v.id, order))
        .sort((a, b) => a.tier - b.tier); // 低 tier 优先，把高 tier 留给后面高价单
      if (candidates.length > 0) {
        if (this.assignVehicle(order.id, candidates[0].id)) {
          assigned++;
        }
      }
    }
    return assigned;
  }

  canVehicleTakeOrder(vehicleId: string, order: Order): boolean {
    const vehicle = this.state.garage.vehicles.find(v => v.id === vehicleId);
    if (!vehicle || vehicle.status !== VehicleStatus.Idle) return false;
    // 低 tier 车辆不能承接高 tier 订单
    if (vehicle.tier < order.tier) return false;
    if (order.requiredDurability && vehicle.stats.durability < order.requiredDurability) return false;
    if (order.requiredQuality && qualityRank(vehicle.quality) < qualityRank(order.requiredQuality)) return false;
    return true;
  }

  private hasVehicleWithDurability(minDurability: number): boolean {
    return this.state.garage.vehicles.some(
      v => v.status === VehicleStatus.Idle && v.stats.durability >= minDurability
    );
  }

  /**
   * 车库中是否存在已进化且拥有指定天赋的车
   */
  private hasEvolvedTalent(talent: TalentType): boolean {
    return this.state.garage.vehicles.some(
      v => v.isEvolved && getVehicleConfig(v.tier)?.talentType === talent
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
