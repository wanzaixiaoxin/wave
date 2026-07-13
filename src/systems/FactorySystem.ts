// ============================================================
// 工厂系统 — 产线管理、生产队列、扩建
// ============================================================

import { EventBus } from '../core/EventBus';
import { GameEvent, GameState, ProductionLine, ProductionOrder } from '../core/types';
import { getVehicleConfig } from '../config/VehicleConfig';
import { GAME_CONSTANTS } from '../config/GameConstants';

export class FactorySystem {
  private state: GameState;

  constructor(state: GameState) {
    this.state = state;
  }

  // ==================== Tick（每秒） ====================

  tick(deltaSeconds: number): void {
    for (const line of this.state.factory.productionLines) {
      if (line.currentOrder) {
        line.currentOrder.remainingTime -= deltaSeconds;

        if (line.currentOrder.remainingTime <= 0) {
          this.completeProduction(line.index);
        }
      }
    }
  }

  // ==================== 生产管理 ====================

  /**
   * 开始生产一辆车
   */
  startProduction(tier: number, lineIndex: number, autoSell = true): boolean {
    const line = this.state.factory.productionLines[lineIndex];
    if (!line) return false;
    if (line.currentOrder) return false; // 该产线正在生产

    const config = getVehicleConfig(tier);
    if (!config) return false;

    // 检查资源
    if (this.state.resources.gold < config.buildCost) return false;
    if (this.state.resources.parts < config.partsCost) return false;

    // 科技加成：L3+ 生产速度 +25%
    let buildTime = config.buildTime;
    if (this.state.techTree.currentLevel >= 3) {
      buildTime = Math.ceil(buildTime * 0.75);
    }

    // 扣除资源
    this.state.resources.gold -= config.buildCost;
    this.state.resources.parts -= config.partsCost;

    line.currentOrder = {
      tier,
      remainingTime: buildTime,
      isAutoSell: autoSell,
    };

    EventBus.emit(GameEvent.PRODUCTION_STARTED, tier, lineIndex);
    return true;
  }

  /**
   * 添加到生产队列
   */
  addToQueue(tier: number, lineIndex: number): boolean {
    const line = this.state.factory.productionLines[lineIndex];
    if (!line) return false;
    if (line.queue.length >= 5) return false; // 队列上限

    const config = getVehicleConfig(tier);
    if (!config) return false;

    // 检查资源
    if (this.state.resources.gold < config.buildCost) return false;
    if (this.state.resources.parts < config.partsCost) return false;

    // 科技加成
    let buildTime = config.buildTime;
    if (this.state.techTree.currentLevel >= 3) {
      buildTime = Math.ceil(buildTime * 0.75);
    }

    this.state.resources.gold -= config.buildCost;
    this.state.resources.parts -= config.partsCost;

    line.queue.push({
      tier,
      remainingTime: buildTime,
      isAutoSell: true,
    });

    return true;
  }

  /**
   * 完成生产
   */
  private completeProduction(lineIndex: number): void {
    const line = this.state.factory.productionLines[lineIndex];
    if (!line.currentOrder) return;

    const { tier } = line.currentOrder;
    line.currentOrder = null;

    EventBus.emit(GameEvent.PRODUCTION_COMPLETED, tier, lineIndex);

    // 从队列取下一个
    if (line.queue.length > 0) {
      const next = line.queue.shift()!;
      line.currentOrder = next;
    }
  }

  /**
   * 取消当前生产（不退款资源）
   */
  cancelProduction(lineIndex: number): boolean {
    const line = this.state.factory.productionLines[lineIndex];
    if (!line?.currentOrder) return false;

    line.currentOrder = null;

    // 如果有队列，取下一个
    if (line.queue.length > 0) {
      const next = line.queue.shift()!;
      line.currentOrder = next;
    }

    return true;
  }

  // ==================== 工厂升级 ====================

  /**
   * 升级工厂（增加产线 + 加速）
   */
  upgradeFactory(): boolean {
    const currentLevel = this.state.factory.level;
    if (currentLevel >= 5) return false;

    const cost = this.getUpgradeCost(currentLevel);
    if (this.state.resources.gold < cost) return false;

    this.state.resources.gold -= cost;
    this.state.factory.level++;

    // 部分等级增加产线
    if (currentLevel === 1 || currentLevel === 3) {
      this.state.factory.productionLines.push({
        index: this.state.factory.productionLines.length,
        currentOrder: null,
        queue: [],
      });
    }

    EventBus.emit(GameEvent.FACTORY_UPGRADED, this.state.factory.level);
    return true;
  }

  getUpgradeCost(level: number): number {
    // 等级越高越贵
    const costs = [0, 500, 2000, 8000, 30000];
    return costs[level] ?? 99999;
  }

  // ==================== 查询 ====================

  getAvailableLines(): ProductionLine[] {
    return this.state.factory.productionLines;
  }

  getIdleLines(): ProductionLine[] {
    return this.state.factory.productionLines.filter(l => !l.currentOrder);
  }
}
