// ============================================================
// 科技树系统 — 研究解锁
// ============================================================

import { EventBus } from '../core/EventBus';
import { GameEvent, GameState, TechLevel } from '../core/types';
import { getTechConfig, TECH_CONFIGS } from '../config/TechConfig';
import { GAME_CONSTANTS } from '../config/GameConstants';

export class TechSystem {
  private state: GameState;

  constructor(state: GameState) {
    this.state = state;
  }

  // ==================== 研究 ====================

  /**
   * 研究下一级科技
   */
  researchNext(): boolean {
    const nextLevel = this.state.techTree.currentLevel + 1;
    if (nextLevel > 5) return false; // 已满级
    if (this.state.techTree.isResearched[nextLevel - 1]) return false; // 已研究

    const config = getTechConfig(nextLevel);
    if (!config) return false;

    // 检查条件
    if (!this.checkUnlockCondition(nextLevel)) return false;

    // 检查资源
    if (this.state.resources.gold < config.goldCost) return false;
    if (this.state.resources.parts < config.partsCost) return false;

    // 扣除资源
    this.state.resources.gold -= config.goldCost;
    this.state.resources.parts -= config.partsCost;

    // 解锁
    this.state.techTree.isResearched[nextLevel - 1] = true;
    this.state.techTree.currentLevel = nextLevel;

    // 科技专属效果
    this.applyTechEffect(nextLevel);

    EventBus.emit(GameEvent.TECH_RESEARCHED, nextLevel, config);
    return true;
  }

  // ==================== 解锁条件检查 ====================

  private checkUnlockCondition(level: number): boolean {
    switch (level) {
      case 1:
        return true; // 初始可用
      case 2:
        return this.state.techTree.producedCount[2] >= 5; // 产5辆T3马车
      case 3:
        return this.state.techTree.producedCount[4] >= 5; // 产5辆T5卡车
      case 4:
        return this.state.techTree.producedCount[6] >= 3; // 产3辆T7轮船
      case 5:
        return this.state.techTree.producedCount[8] >= 2; // 产2辆T9火箭
      default:
        return false;
    }
  }

  // ==================== 科技效果 ====================

  private applyTechEffect(level: number): void {
    switch (level) {
      case 1:
        // 解锁品质系统（品质在 VehicleSystem 中已经可用）
        break;
      case 2:
        // 解锁 T4-T5（由 VehicleSystem 控制）
        break;
      case 3:
        // 生产速度 +25%（在 FactorySystem 中实现）
        break;
      case 4:
        // 产线 +1（已在升级时触发）
        this.state.factory.productionLines.push({
          index: this.state.factory.productionLines.length,
          currentOrder: null,
          queue: [],
        });
        break;
      case 5:
        // 全厂收入 +50%（在 OrderSystem 计算时实现）
        break;
    }
  }

  // ==================== 查询 ====================

  /**
   * 获取当前可研究的科技
   */
  getNextResearchable(): { level: number; canAfford: boolean; conditionMet: boolean } | null {
    const nextLevel = this.state.techTree.currentLevel + 1;
    if (nextLevel > 5) return null;
    if (this.state.techTree.isResearched[nextLevel - 1]) return null;

    const config = getTechConfig(nextLevel);
    if (!config) return null;

    const conditionMet = this.checkUnlockCondition(nextLevel);
    const canAfford =
      this.state.resources.gold >= config.goldCost &&
      this.state.resources.parts >= config.partsCost;

    return { level: nextLevel, canAfford, conditionMet };
  }

  /**
   * 获取全厂收入倍率
   */
  getGlobalIncomeMultiplier(): number {
    if (this.state.techTree.currentLevel >= 5) {
      return GAME_CONSTANTS.QUALITY_INCOME_MULT_GOLD;
    }
    return 1.0;
  }

  /**
   * 获取所有已研究科技
   */
  getResearchedLevels(): number[] {
    return TECH_CONFIGS
      .filter(t => this.state.techTree.isResearched[t.level - 1])
      .map(t => t.level);
  }
}
