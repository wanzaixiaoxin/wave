import { EventBus } from '../core/EventBus';
import { GameEvent, GameState } from '../core/types';
import { GAME_CONSTANTS } from '../config/GameConstants';
import { getRetrofitConfig, getRetrofitCost } from '../config/UpgradeConfig';
import { getEventMultiplier } from './EventSystem';
import { getUpgradeMult } from './UpgradeSystem';

/**
 * 建造排队位上限（v1.3：工厂 L5 里程碑 +1，3→4）
 * 唯一实现，VehicleSystem / UI / main 共用
 */
export function getBuildQueueMax(state: GameState): number {
  return GAME_CONSTANTS.BUILD_QUEUE_MAX +
    (state.factory.level >= GAME_CONSTANTS.FACTORY_QUEUE_BONUS_LEVEL
      ? GAME_CONSTANTS.FACTORY_QUEUE_BONUS
      : 0);
}

export class FactorySystem {
  private state: GameState;

  constructor(state: GameState) {
    this.state = state;
  }

  tick(deltaSeconds: number): void {
    // 电站产电（M8）：不受「全员休息」影响，到储存上限停产
    const cap = this.getEnergyCapacity();
    if (this.state.resources.energy < cap) {
      this.state.resources.energy = Math.min(
        cap,
        this.state.resources.energy + this.getEnergyPerSecond() * deltaSeconds
      );
    }

    // 「全员休息」事件：产线停产
    if (getEventMultiplier(this.state, 'stop_production') !== 1.0) return;

    const pps = this.getPartsPerSecond();
    // 「零件雨」事件：零件产出倍率
    const gained = pps * deltaSeconds * getEventMultiplier(this.state, 'parts_mult');
    if (gained > 0) {
      this.state.resources.parts += gained;
    }
  }

  upgradeFactory(): boolean {
    const level = this.state.factory.level;
    if (level >= GAME_CONSTANTS.FACTORY_MAX_LEVEL) return false;

    const cost = GAME_CONSTANTS.FACTORY_UPGRADE_COSTS[level];
    if (this.state.resources.gold < cost) return false;

    this.state.resources.gold -= cost;
    this.state.factory.level++;

    const newLineCount = this.getLineCount();
    while (this.state.factory.productionLines.length < newLineCount) {
      this.state.factory.productionLines.push({
        index: this.state.factory.productionLines.length,
        isActive: true,
      });
    }

    EventBus.emit(GameEvent.FACTORY_UPGRADED, this.state.factory.level);
    return true;
  }

  /** 车库最高车型 tier（空车库按 1 计）— 工厂进度系数用（M7） */
  getTopTier(): number {
    const vehicles = this.state.garage.vehicles;
    if (vehicles.length === 0) return 1;
    return Math.max(...vehicles.map(v => v.tier));
  }

  /** 进度系数：1 + 最高车型 tier × FACTORY_TIER_SCALING（工厂随进程变强） */
  getTierScaling(): number {
    return 1 + this.getTopTier() * GAME_CONSTANTS.FACTORY_TIER_SCALING;
  }

  getPartsPerSecond(): number {
    const level = this.state.factory.level;
    const lineCount = this.getLineCount();
    const baseRate = GAME_CONSTANTS.FACTORY_BASE_RATE;
    const levelMult = 1 + (level - 1) * GAME_CONSTANTS.FACTORY_RATE_GROWTH;
    const techBoost = this.state.techTree.currentLevel >= 3
      ? 1 + GAME_CONSTANTS.TECH_SPEED_BOOST
      : 1.0;
    // 进度系数（M7）：车库最高车型 tier 越高，工厂产出越强
    const tierScaling = this.getTierScaling();
    // 「加速光环」事件：产线速度倍率
    const eventBoost = getEventMultiplier(this.state, 'speed_mult');
    // 超负荷运转：限时产出倍率
    const overclockBoost = Date.now() < this.state.factory.overclockUntil
      ? GAME_CONSTANTS.FACTORY_OVERCLOCK_MULT
      : 1.0;
    // 产线自动化改造（v1.3）：零件速率 +15%/级
    const retrofitBoost = getUpgradeMult(this.state, 'parts_rate');
    return lineCount * baseRate * levelMult * techBoost * tierScaling * eventBoost * overclockBoost * retrofitBoost;
  }

  // ==================== 改造线（v1.3：即时购买生效，不占研究槽） ====================

  /**
   * 购买工厂/电站改造线下一级：资源够即扣即生效（工厂线花金币+零件，电站线只花金币）
   */
  buyRetrofit(id: string): boolean {
    const cfg = getRetrofitConfig(id);
    if (!cfg) return false;
    const level = this.state.factory.retrofits[id] ?? 0;
    const cost = getRetrofitCost(cfg, level);
    if (!cost) return false; // 已满级
    if (this.state.resources.gold < cost.gold) return false;
    if (this.state.resources.parts < cost.parts) return false;

    this.state.resources.gold -= cost.gold;
    this.state.resources.parts -= cost.parts;
    this.state.factory.retrofits[id] = level + 1;
    EventBus.emit(GameEvent.FACTORY_UPGRADED, this.state.factory.level);
    return true;
  }

  /** 改造线状态查询（UI 用）：当前等级与下一级费用（满级 cost 为 null） */
  getRetrofitState(id: string): { level: number; maxLevel: number; cost: { gold: number; parts: number } | null } {
    const cfg = getRetrofitConfig(id);
    const level = this.state.factory.retrofits[id] ?? 0;
    return {
      level,
      maxLevel: cfg?.maxLevel ?? 0,
      cost: cfg ? getRetrofitCost(cfg, level) : null,
    };
  }

  // ==================== 电站（M8） ====================

  /** 电站产出速率 ⚡/秒：1.0 × (1 + 0.6×(等级-1))，科技 L3+ 同样加速 +25%，能效优化改造 +12%/级 */
  getEnergyPerSecond(): number {
    const level = this.state.factory.powerLevel;
    const levelMult = 1 + (level - 1) * GAME_CONSTANTS.POWER_RATE_GROWTH;
    const techBoost = this.state.techTree.currentLevel >= 3
      ? 1 + GAME_CONSTANTS.TECH_SPEED_BOOST
      : 1.0;
    return GAME_CONSTANTS.POWER_BASE_RATE * levelMult * techBoost * getUpgradeMult(this.state, 'power_rate');
  }

  /** 能源储存上限 = 100 × 电站等级 × 储能扩容改造（+25%/级） */
  getEnergyCapacity(): number {
    return Math.floor(
      GAME_CONSTANTS.POWER_CAPACITY_PER_LEVEL * this.state.factory.powerLevel *
      getUpgradeMult(this.state, 'power_cap')
    );
  }

  /** 升级电站：只花金币 */
  upgradePower(): boolean {
    const level = this.state.factory.powerLevel;
    if (level >= GAME_CONSTANTS.POWER_MAX_LEVEL) return false;

    const cost = GAME_CONSTANTS.POWER_UPGRADE_COSTS[level];
    if (this.state.resources.gold < cost) return false;

    this.state.resources.gold -= cost;
    this.state.factory.powerLevel++;
    EventBus.emit(GameEvent.POWER_UPGRADED, this.state.factory.powerLevel);
    return true;
  }

  getPowerUpgradeCost(): number {
    const level = this.state.factory.powerLevel;
    if (level >= GAME_CONSTANTS.POWER_MAX_LEVEL) return -1;
    return GAME_CONSTANTS.POWER_UPGRADE_COSTS[level];
  }

  // ==================== 超负荷运转 ====================

  /** 激活超负荷：60 秒产出 ×2，之后进入 5 分钟冷却；激活时耗 50⚡（M8） */
  activateOverclock(): boolean {
    const now = Date.now();
    if (now < this.state.factory.overclockCooldownUntil) return false;
    if (this.state.resources.energy < GAME_CONSTANTS.ENERGY_OVERCLOCK) return false;
    this.state.resources.energy -= GAME_CONSTANTS.ENERGY_OVERCLOCK;
    this.state.factory.overclockUntil = now + GAME_CONSTANTS.FACTORY_OVERCLOCK_DURATION * 1000;
    this.state.factory.overclockCooldownUntil = now + GAME_CONSTANTS.FACTORY_OVERCLOCK_COOLDOWN * 1000;
    return true;
  }

  /** 超负荷状态：active=剩余激活秒数，cooldown=剩余冷却秒数 */
  getOverclockState(): { active: number; cooldown: number } {
    const now = Date.now();
    return {
      active: Math.max(0, (this.state.factory.overclockUntil - now) / 1000),
      cooldown: Math.max(0, (this.state.factory.overclockCooldownUntil - now) / 1000),
    };
  }

  getLineCount(): number {
    const idx = Math.min(this.state.factory.level - 1, GAME_CONSTANTS.FACTORY_LINES_AT_LEVEL.length - 1);
    return GAME_CONSTANTS.FACTORY_LINES_AT_LEVEL[idx];
  }

  getUpgradeCost(): number {
    const level = this.state.factory.level;
    if (level >= GAME_CONSTANTS.FACTORY_MAX_LEVEL) return -1;
    return GAME_CONSTANTS.FACTORY_UPGRADE_COSTS[level];
  }

  getMaxLevel(): number {
    return GAME_CONSTANTS.FACTORY_MAX_LEVEL;
  }
}
