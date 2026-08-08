// ============================================================
// S4 城市需求压力系统 — 根本动力：城市经济发展 → 运输需求紧张（负反馈）
// → 玩家经营解决（扩车队/提效率/基建）→ 积压清零、城市繁荣（释放）
// 纯软压力：所有惩罚随积压回落立即恢复，无硬失败
// ============================================================

import { EventBus } from '../core/EventBus';
import { GameEvent, GameState, Order, CityProjectProgress } from '../core/types';
import { GAME_CONSTANTS } from '../config/GameConstants';
import { CITY_PROJECTS, getCityProject } from '../config/CityConfig';

// ==================== 纯函数（EconomySystem/OrderSystem/hint 共用，防循环依赖） ====================

/** 已建成的项目 id 集合判断 */
export function isCityProjectDone(state: GameState, id: string): boolean {
  return state.city.projects[id]?.done === true;
}

/** 名义需求速率（单位/分钟）：基准 + 时长增长 + 繁荣附加 */
export function getNominalDemandRate(state: GameState): number {
  const minutes = state.stats.totalPlayTime / 60;
  return GAME_CONSTANTS.CITY_DEMAND_BASE +
    GAME_CONSTANTS.CITY_DEMAND_GROWTH * minutes +
    GAME_CONSTANTS.CITY_DEMAND_PER_PROSPERITY * state.city.prosperity;
}

/** 城市容忍度 K（环城快速路网 +25%） */
export function getCitySoftK(state: GameState): number {
  return GAME_CONSTANTS.CITY_BACKLOG_SOFT_K *
    (isCityProjectDone(state, 'ring_expressway') ? GAME_CONSTANTS.CITY_PROJECT_SOFT_K_MULT : 1);
}

/** 有效需求速率：积压越大新增需求越衰减（客户转投竞争对手）——自稳定、永不死锁 */
export function getEffectiveDemandRate(state: GameState): number {
  return getNominalDemandRate(state) / (1 + state.city.backlog / getCitySoftK(state));
}

/** 压力等级 0-3：按积压 / K 的倍数分级（对应需求/运力比 ≈1.5/2/3 的均衡积压） */
export function getCityPressureTier(state: GameState): 0 | 1 | 2 | 3 {
  const ratio = state.city.backlog / getCitySoftK(state);
  if (ratio >= GAME_CONSTANTS.CITY_PRESSURE_L3_K) return 3;
  if (ratio >= GAME_CONSTANTS.CITY_PRESSURE_L2_K) return 2;
  if (ratio >= GAME_CONSTANTS.CITY_PRESSURE_L1_K) return 1;
  return 0;
}

/** 城市收入乘区：压力惩罚（L1/L3 叠乘）× 繁荣加成 × 城际走廊项目 */
export function getCityIncomeMult(state: GameState): number {
  const tier = getCityPressureTier(state);
  let mult = 1;
  if (tier >= 1) mult *= GAME_CONSTANTS.CITY_PRESSURE_INCOME_L1;
  if (tier >= 3) mult *= GAME_CONSTANTS.CITY_PRESSURE_INCOME_L3;
  mult *= 1 + state.city.prosperity * GAME_CONSTANTS.CITY_PROSPERITY_INCOME_PER_LEVEL;
  if (isCityProjectDone(state, 'intercity_corridor')) mult *= GAME_CONSTANTS.CITY_PROJECT_INCOME;
  return mult;
}

/** 城市耗时乘区：L2+ 堵车（环城快速路网减半） */
export function getCityDurationMult(state: GameState): number {
  if (getCityPressureTier(state) < 2) return 1;
  return isCityProjectDone(state, 'ring_expressway')
    ? GAME_CONSTANTS.CITY_PROJECT_DURATION_EASE
    : GAME_CONSTANTS.CITY_PRESSURE_DURATION_L2;
}

/** 订单槽修正：L3 -1（瘫痪边缘），智能调度中心 +1 */
export function getCityOrderSlotDelta(state: GameState): number {
  return (getCityPressureTier(state) >= 3 ? -1 : 0) +
    (isCityProjectDone(state, 'smart_dispatch') ? 1 : 0);
}

/** 每单交付效率（物流集散点 +10%） */
export function getCityDeliveryEfficiency(state: GameState): number {
  return 1 + (isCityProjectDone(state, 'logistics_hub') ? GAME_CONSTANTS.CITY_PROJECT_DELIVERY_BONUS : 0);
}

/** 繁荣升级里程碑奖励（3/6/9 级一次性大礼包） */
export function getProsperityMilestoneReward(level: number): { gold: number; parts: number } | null {
  switch (level) {
    case 3: return { gold: 5000, parts: 500 };
    case 6: return { gold: 50000, parts: 3000 };
    case 9: return { gold: 300000, parts: 15000 };
    default: return null;
  }
}

// ==================== 系统类 ====================

export class CitySystem {
  private state: GameState;

  constructor(state: GameState) {
    this.state = state;
    // 订单完成 = 向城市交付（监听事件解耦，同 VehicleSystem 里程模式）
    EventBus.on(GameEvent.ORDER_COMPLETED, (...args: unknown[]) => {
      const order = args[0] as Order;
      this.onDelivered(order.tier);
    });
  }

  /** 每秒：累积需求/积压、压力副作用（信誉流失）、繁荣进度 */
  tick(sec = 1): void {
    const city = this.state.city;
    city.backlog += (getEffectiveDemandRate(this.state) / 60) * sec;

    const tier = getCityPressureTier(this.state);

    // L2+ 信誉持续流失（扣到 0 止）
    if (tier >= 2 && this.state.resources.reputation > 0) {
      this.state.resources.reputation = Math.max(
        0, this.state.resources.reputation - (GAME_CONSTANTS.CITY_REP_DRAIN_PER_MIN / 60) * sec
      );
    }

    // 繁荣进度：L0/L1 畅通累积，L3 倒退（等级不降，只损进度）
    if (tier <= 1 && city.prosperity < GAME_CONSTANTS.CITY_PROSPERITY_MAX_LEVEL) {
      city.prosperityProgress += GAME_CONSTANTS.CITY_PROSPERITY_PROGRESS_PER_SEC * sec;
      while (city.prosperityProgress >= GAME_CONSTANTS.CITY_PROSPERITY_PROGRESS_NEED
        && city.prosperity < GAME_CONSTANTS.CITY_PROSPERITY_MAX_LEVEL) {
        city.prosperityProgress -= GAME_CONSTANTS.CITY_PROSPERITY_PROGRESS_NEED;
        city.prosperity++;
        const reward = getProsperityMilestoneReward(city.prosperity);
        if (reward) {
          this.state.resources.gold += reward.gold;
          this.state.resources.parts += reward.parts;
        }
        EventBus.emit(GameEvent.CITY_PROSPERITY_UP, city.prosperity, reward);
      }
    } else if (tier >= 3) {
      city.prosperityProgress = Math.max(
        0, city.prosperityProgress - GAME_CONSTANTS.CITY_PROSPERITY_REGRESS_PER_SEC * sec
      );
    }
  }

  /** 完成订单交付：按 tier × 交付效率扣积压（下限 0） */
  onDelivered(orderTier: number): void {
    const delivered = orderTier * getCityDeliveryEfficiency(this.state);
    this.state.city.backlog = Math.max(0, this.state.city.backlog - delivered);
    this.state.city.deliveredTotal += delivered;
  }

  /** 项目投入进度（缺省全 0） */
  getProjectProgress(id: string): CityProjectProgress {
    return this.state.city.projects[id] ?? { gold: 0, parts: 0, energy: 0, rep: 0, done: false };
  }

  /**
   * 分批捐赠：每次投入各资源当前存量的 25%（不超过剩余需求），可多次调用直到建成。
   * 不一次掏空存量——玩家保留经营周转金，能源/声望按整数扣（显示口径一致）。
   */
  investProject(id: string): { ok: boolean; reason?: string } {
    const cfg = getCityProject(id);
    if (!cfg) return { ok: false, reason: '项目不存在' };
    const prog = this.getProjectProgress(id);
    if (prog.done) return { ok: false, reason: '项目已建成' };

    const res = this.state.resources;
    const pools: Array<{ key: keyof CityProjectProgress & ('gold' | 'parts' | 'energy' | 'rep'); get: () => number; set: (v: number) => void }> = [
      { key: 'gold', get: () => res.gold, set: v => { res.gold = v; } },
      { key: 'parts', get: () => res.parts, set: v => { res.parts = v; } },
      { key: 'energy', get: () => res.energy, set: v => { res.energy = v; } },
      { key: 'rep', get: () => res.reputation, set: v => { res.reputation = v; } },
    ];

    let investedAny = false;
    const next = { ...prog };
    for (const p of pools) {
      const need = cfg.cost[p.key] ?? 0;
      const remaining = need - prog[p.key];
      if (remaining <= 0) continue;
      const put = Math.min(remaining, Math.ceil(p.get() * 0.25));
      if (put > 0) {
        p.set(p.get() - put);
        next[p.key] = prog[p.key] + put;
        investedAny = true;
      }
    }
    if (!investedAny) return { ok: false, reason: '没有可投入的资源（先攒钱/零件/能源/声望）' };

    next.done = pools.every(p => next[p.key] >= (cfg.cost[p.key] ?? 0));
    this.state.city.projects[id] = next;
    if (next.done) EventBus.emit(GameEvent.CITY_PROJECT_COMPLETED, cfg);
    return { ok: true };
  }

  /** 全部项目建成（遥测里程碑用） */
  allProjectsDone(): boolean {
    return CITY_PROJECTS.every(p => this.getProjectProgress(p.id).done);
  }
}
