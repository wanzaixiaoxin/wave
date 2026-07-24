import { EventBus } from '../core/EventBus';
import { GameEvent, GameState } from '../core/types';
import { GAME_CONSTANTS } from '../config/GameConstants';

export class FactorySystem {
  private state: GameState;

  constructor(state: GameState) {
    this.state = state;
  }

  tick(deltaSeconds: number): void {
    const pps = this.getPartsPerSecond();
    const gained = pps * deltaSeconds;
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
    return lineCount * baseRate * levelMult * techBoost;
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
