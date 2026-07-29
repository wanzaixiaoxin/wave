// ============================================================
// 订单系统 — 生成、指派、完成、结算
// ============================================================

import { EventBus } from '../core/EventBus';
import {
  GameEvent, GameState, Order, OrderType, OrderStatus,
  Vehicle, VehicleStatus, Quality, qualityRank, Specialization,
  EnRouteEventChoice
} from '../core/types';
import { getVehicleConfig } from '../config/VehicleConfig';
import { getTraitConfig } from '../config/TraitConfig';
import { getEnRouteEventConfig, rollEnRouteEvent } from '../config/EnRouteEventConfig';
import { GAME_CONSTANTS, orderEnergyCost } from '../config/GameConstants';
import { EconomySystem, getGlobalIncomeMult } from './EconomySystem';
import { getEventMultiplier } from './EventSystem';
import { getSideTechRank } from './TechSystem';
import { getUpgradeMult } from './UpgradeSystem';

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

    // 订单供给随进度扩张：生成间隔 5-8 秒，
    // 待接单上限随科技等级提升（L1:3 → L3:4 → L5:5）
    let genInterval = 3.5 + Math.random() * 2;
    // 辅助科技「物流优化」（v1.3 3 阶制）：订单生成间隔 ×(1 - 7%×阶数)
    const logisticsRank = getSideTechRank(this.state, 'logistics');
    if (logisticsRank > 0) {
      genInterval *= 1 - GAME_CONSTANTS.SIDE_LOGISTICS_INTERVAL_PER_RANK * logisticsRank;
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

    // 贵重单动用客户关系（M8）：派单时 -10 声望，不足不能派
    if (order.type === OrderType.Valuable) {
      if (this.state.resources.reputation < GAME_CONSTANTS.REP_VALUABLE_COST) return false;
      this.state.resources.reputation -= GAME_CONSTANTS.REP_VALUABLE_COST;
    }

    order.assignedVehicleId = vehicleId;
    order.status = OrderStatus.InProgress;
    vehicle.status = VehicleStatus.OnOrder;

    // 每单耗电（M8）：订单tier × (1 + 速度 × 0.1)，派单时预扣；
    // 高效燃烧/曲率引擎子科技（v1.3 统一乘区）逐阶降低耗电；
    // 能源不足不锁单，扣到 0 为止，本次订单耗时 ×1.5（动力不足惩罚）
    const energyNeed = orderEnergyCost(order.tier, vehicle.stats.speed) *
      getUpgradeMult(this.state, 'order_energy');
    const energyPaid = Math.min(this.state.resources.energy, energyNeed);
    this.state.resources.energy -= energyPaid;
    if (energyPaid < energyNeed) {
      order.lowPower = true;
    }

    // 订单耗时加成：速度属性每级 -4%、高速出厂参数 ×0.85、
    // 运营配置（快运 ×0.75 / 重载 ×1.15）、高磨损 ×1.2
    let duration = order.duration;
    duration *= 1 - vehicle.stats.speed * GAME_CONSTANTS.SPEED_DURATION_PER_LEVEL;
    if (vehicle.trait) {
      const tc = getTraitConfig(vehicle.trait);
      if (tc?.effectType === 'speed') {
        duration *= tc.effectValue;
      }
    }
    if (vehicle.specialization === Specialization.Express) {
      duration *= GAME_CONSTANTS.SPEC_EXPRESS_DURATION_MULT;
    } else if (vehicle.specialization === Specialization.Heavy) {
      duration *= GAME_CONSTANTS.SPEC_HEAVY_DURATION_MULT;
    }
    if (vehicle.wear >= GAME_CONSTANTS.WEAR_PENALTY_THRESHOLD) {
      duration *= GAME_CONSTANTS.WEAR_DURATION_MULT;
    }
    // 动力不足惩罚（M8）：派单时能源不够，本次耗时 ×1.5
    if (order.lowPower) {
      duration *= GAME_CONSTANTS.ENERGY_SHORTAGE_DURATION_MULT;
    }
    // 物流网络子科技（v1.3 统一乘区）：订单耗时 -5%/阶
    duration *= getUpgradeMult(this.state, 'order_duration');
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
   * 磨损/零件/金币立即结算
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

    // 零件获得
    if (choice.partsGain) {
      this.state.resources.parts += choice.partsGain;
    }

    // 金币消耗：按本单期望收入百分比（期望模式计算，结果确定）
    if (choice.goldCostPct) {
      const estIncome = EconomySystem.calculateOrderIncome(
        vehicle, order.baseReward, order.pendingRewardMult ?? 1,
        getGlobalIncomeMult(this.state), false, this.state, order.type
      ).income;
      this.state.resources.gold = Math.max(0, this.state.resources.gold - Math.floor(estIncome * choice.goldCostPct));
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

      // 收入统一走 EconomySystem（等级/规格/出厂参数/载货/运营配置/事件/磨损/疲劳 + 暴击 + 科技L5全局加成）
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

      // 品牌声望（M8）：订单tier × 类型系数（普通1/长途2/贵重4），营销推广期间 ×2
      // 品牌运营/深空网络子科技（v1.3 统一乘区）：声望获取 +10%/+15% 每阶
      const repMultMap: Record<OrderType, number> = {
        [OrderType.Normal]: GAME_CONSTANTS.REP_ORDER_MULT_NORMAL,
        [OrderType.LongDistance]: GAME_CONSTANTS.REP_ORDER_MULT_LONG,
        [OrderType.Valuable]: GAME_CONSTANTS.REP_ORDER_MULT_VALUABLE,
      };
      this.state.resources.reputation += Math.floor(
        order.tier * repMultMap[order.type] * getEventMultiplier(this.state, 'reputation_mult') *
        getUpgradeMult(this.state, 'rep_gain')
      );

      // 经验由 VehicleSystem 监听 ORDER_COMPLETED 后统一走 addExp() 处理
      // （含出厂参数/规格加成与升级判定），此处不再直接累加
      vehicle.ordersCompleted++;
      vehicle.totalEarnings += totalReward;

      // 零件产出：收入 1% + tier 保底，叠加零件雨事件
      const config = getVehicleConfig(vehicle.tier);
      if (config) {
        const partsReward = Math.floor(
          (Math.floor(totalReward * 0.01) + vehicle.tier) * getEventMultiplier(this.state, 'parts_mult')
        );
        this.state.resources.parts += partsReward;
      }

      vehicle.status = VehicleStatus.Idle;
      vehicle.statusEndAt = 0;

      // 磨损累积（耐用运营配置减半；质控体系子科技 v1.3 统一乘区逐阶 -10%）与疲劳计数
      const wearGain = GAME_CONSTANTS.WEAR_PER_ORDER *
        (vehicle.specialization === Specialization.Steady ? GAME_CONSTANTS.SPEC_STEADY_WEAR_MULT : 1) *
        getUpgradeMult(this.state, 'wear');
      vehicle.wear = Math.min(GAME_CONSTANTS.WEAR_MAX, vehicle.wear + wearGain);
      vehicle.consecutiveOrders++;
      vehicle.lastOrderCompletedAt = now;
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
    // 贵重单动用客户关系（M8）：声望不足不能派（autoAssign 同样跳过）
    if (order.type === OrderType.Valuable && this.state.resources.reputation < GAME_CONSTANTS.REP_VALUABLE_COST) return false;
    return true;
  }

  // ==================== 营销推广（M8） ====================

  /**
   * 营销推广：1000🪙 买 2 分钟声望获取 ×2，冷却 5 分钟
   * buff 与冷却都复用 ActiveEvent 机制（effectType='reputation_mult' / 'marketing_cooldown'）
   */
  runMarketing(): boolean {
    if (this.state.resources.gold < GAME_CONSTANTS.MARKETING_GOLD_COST) return false;
    if (getEventMultiplier(this.state, 'reputation_mult') !== 1.0) return false; // buff 进行中
    if (this.state.activeEvents.some(e => e.effectType === 'marketing_cooldown')) return false;

    this.state.resources.gold -= GAME_CONSTANTS.MARKETING_GOLD_COST;
    this.state.activeEvents.push({
      id: 'marketing',
      effectType: 'reputation_mult',
      value: GAME_CONSTANTS.MARKETING_REP_MULT,
      remainingTime: GAME_CONSTANTS.MARKETING_DURATION,
      totalDuration: GAME_CONSTANTS.MARKETING_DURATION,
    });
    this.state.activeEvents.push({
      id: 'marketing_cd',
      effectType: 'marketing_cooldown',
      value: 1,
      remainingTime: GAME_CONSTANTS.MARKETING_COOLDOWN,
      totalDuration: GAME_CONSTANTS.MARKETING_COOLDOWN,
    });
    return true;
  }

  /** 营销状态查询（UI 用）：buff 剩余秒数 / 冷却剩余秒数 */
  getMarketingState(): { buff: number; cooldown: number } {
    const buff = this.state.activeEvents.find(e => e.effectType === 'reputation_mult');
    const cd = this.state.activeEvents.find(e => e.effectType === 'marketing_cooldown');
    return {
      buff: buff?.remainingTime ?? 0,
      cooldown: cd?.remainingTime ?? 0,
    };
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
