import { EventBus } from '../core/EventBus';
import { GameEvent, GameState } from '../core/types';
import { GAME_CONSTANTS } from '../config/GameConstants';
import { getEventMultiplier } from './EventSystem';

export class FactorySystem {
  private state: GameState;

  constructor(state: GameState) {
    this.state = state;
  }

  tick(deltaSeconds: number): void {
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

  getPartsPerSecond(): number {
    const level = this.state.factory.level;
    const lineCount = this.getLineCount();
    const baseRate = GAME_CONSTANTS.FACTORY_BASE_RATE;
    const levelMult = 1 + (level - 1) * GAME_CONSTANTS.FACTORY_RATE_GROWTH;
    const techBoost = this.state.techTree.currentLevel >= 3
      ? 1 + GAME_CONSTANTS.TECH_SPEED_BOOST
      : 1.0;
    // 「加速光环」事件：产线速度倍率
    const eventBoost = getEventMultiplier(this.state, 'speed_mult');
    // 超负荷运转：限时产出倍率
    const overclockBoost = Date.now() < this.state.factory.overclockUntil
      ? GAME_CONSTANTS.FACTORY_OVERCLOCK_MULT
      : 1.0;
    return lineCount * baseRate * levelMult * techBoost * eventBoost * overclockBoost;
  }

  // ==================== 超负荷运转 ====================

  /** 激活超负荷：60 秒产出 ×2，之后进入 5 分钟冷却 */
  activateOverclock(): boolean {
    const now = Date.now();
    if (now < this.state.factory.overclockCooldownUntil) return false;
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
