// ============================================================
// 科技树系统 — 研究解锁
// ============================================================

import { EventBus } from '../core/EventBus';
import { GameEvent, GameState, TechLevel } from '../core/types';
import { getTechConfig, getSideTechConfig, TECH_CONFIGS } from '../config/TechConfig';
import { GAME_CONSTANTS } from '../config/GameConstants';

/** 辅助科技是否已研究（纯函数，供各消费点读取） */
export function hasSideTech(state: GameState, id: string): boolean {
  return (state.techTree.sideTechs[id] ?? 0) > 0;
}

/** 造车零件实际消耗（精益制造 ×0.75，向下取整） */
export function getEffectivePartsCost(state: GameState, base: number): number {
  return hasSideTech(state, 'lean_mfg')
    ? Math.floor(base * GAME_CONSTANTS.SIDE_LEAN_PARTS_MULT)
    : base;
}

export class TechSystem {
  private state: GameState;

  /** 测试用：true 时研究即时完成（smoke 等同步断言用），游戏内保持 false */
  debugInstantResearch = false;

  constructor(state: GameState) {
    this.state = state;
  }

  // ==================== 研究（M7：耗时化，主线/支线共享一个研究槽） ====================

  /**
   * 开始研究下一级主线科技：资源在开始时扣除（防刷），到点后由 tick 解锁
   */
  researchNext(): boolean {
    if (this.state.techTree.researching) return false; // 研究槽被占用

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

    const totalTime = GAME_CONSTANTS.RESEARCH_TIME_MAIN[nextLevel] ?? 60;
    this.state.techTree.researching = {
      kind: 'main',
      level: nextLevel,
      totalTime,
      finishAt: Date.now() + totalTime * 1000,
    };

    if (this.debugInstantResearch) this.settleResearch();
    return true;
  }

  /** 到点结算研究：应用解锁/效果并发事件 */
  private settleResearch(): void {
    const job = this.state.techTree.researching;
    if (!job) return;
    this.state.techTree.researching = null;

    if (job.kind === 'main' && job.level !== undefined) {
      const config = getTechConfig(job.level);
      this.state.techTree.isResearched[job.level - 1] = true;
      this.state.techTree.currentLevel = job.level;
      this.applyTechEffect(job.level);
      EventBus.emit(GameEvent.TECH_RESEARCHED, job.level, config);
    } else if (job.kind === 'side' && job.sideId) {
      this.state.techTree.sideTechs[job.sideId] = 1;
    }
  }

  /** 研究计时（1Hz，由 GameLoop 驱动；时间戳制，离线到点自动完成） */
  tick(_deltaSeconds: number): void {
    if (this.state.techTree.researching && Date.now() >= this.state.techTree.researching.finishAt) {
      this.settleResearch();
    }
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
        // 工厂产出速度 +25%（FactorySystem.getPartsPerSecond 中实现）
        break;
      case 4:
        // 工厂增加产线（FactorySystem 按等级自动管理）
        break;
      case 5:
        // 全厂收入 +50%（预留，由 OrderSystem 计算时实现）
        break;
    }
  }

  // ==================== 辅助科技（支线） ====================

  /**
   * 开始研究辅助科技。要求：研究槽空闲 + 主线等级达标 + 未研究过 + 资源足够。
   * 资源在开始时扣除（防刷），到点后由 tick 生效
   */
  researchSideTech(id: string): boolean {
    if (this.state.techTree.researching) return false; // 研究槽被占用

    const config = getSideTechConfig(id);
    if (!config) return false;
    if (hasSideTech(this.state, id)) return false;
    if (this.state.techTree.currentLevel < config.requiredLevel) return false;
    if (this.state.resources.gold < config.goldCost) return false;
    if (this.state.resources.parts < config.partsCost) return false;

    this.state.resources.gold -= config.goldCost;
    this.state.resources.parts -= config.partsCost;

    const totalTime = GAME_CONSTANTS.RESEARCH_TIME_SIDE;
    this.state.techTree.researching = {
      kind: 'side',
      sideId: id,
      totalTime,
      finishAt: Date.now() + totalTime * 1000,
    };

    if (this.debugInstantResearch) this.settleResearch();
    return true;
  }

  /** 辅助科技研究状态查询（UI 用） */
  getSideTechState(id: string): { researched: boolean; levelMet: boolean; canAfford: boolean } {
    const config = getSideTechConfig(id);
    if (!config) return { researched: false, levelMet: false, canAfford: false };
    return {
      researched: hasSideTech(this.state, id),
      levelMet: this.state.techTree.currentLevel >= config.requiredLevel,
      canAfford:
        this.state.resources.gold >= config.goldCost &&
        this.state.resources.parts >= config.partsCost &&
        !this.state.techTree.researching,
    };
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
      this.state.resources.parts >= config.partsCost &&
      !this.state.techTree.researching; // 研究槽占用时不可开始（M7）

    return { level: nextLevel, canAfford, conditionMet };
  }

  /**
   * 获取全厂收入倍率（科技 L5 ×1.5）
   * 注意：订单结算统一走 EconomySystem 模块的 getGlobalIncomeMult(state)
   */
  getGlobalIncomeMultiplier(): number {
    if (this.state.techTree.currentLevel >= 5) {
      return GAME_CONSTANTS.TECH_GLOBAL_INCOME_MULT;
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
