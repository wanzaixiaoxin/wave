// ============================================================
// 科技树系统 — 研究解锁
// ============================================================

import { EventBus } from '../core/EventBus';
import { GameEvent, GameState, TechLevel } from '../core/types';
import { getTechConfig, getSideTechConfig, TECH_CONFIGS } from '../config/TechConfig';
import { getSubTechConfig } from '../config/UpgradeConfig';
import { GAME_CONSTANTS } from '../config/GameConstants';

/** 辅助科技是否已研究（至少 1 阶；纯函数，供各消费点读取） */
export function hasSideTech(state: GameState, id: string): boolean {
  return getSideTechRank(state, id) > 0;
}

/** 辅助科技当前阶数（v1.3：0-3 阶制） */
export function getSideTechRank(state: GameState, id: string): number {
  return state.techTree.sideTechs[id] ?? 0;
}

/** 造车零件实际消耗（精益制造每阶 -9%，向下取整） */
export function getEffectivePartsCost(state: GameState, base: number): number {
  const rank = getSideTechRank(state, 'lean_mfg');
  return rank > 0
    ? Math.floor(base * (1 - GAME_CONSTANTS.SIDE_LEAN_PARTS_PER_RANK * rank))
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
      // 支线 3 阶制（v1.3）：到点 +1 阶
      this.state.techTree.sideTechs[job.sideId] = getSideTechRank(this.state, job.sideId) + 1;
    } else if (job.kind === 'sub' && job.subId) {
      // 子科技（v1.3）：到点 +1 阶
      this.state.techTree.subTechs[job.subId] = (this.state.techTree.subTechs[job.subId] ?? 0) + 1;
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
        // 解锁规格系统（规格在 VehicleSystem 中已经可用）
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

  // ==================== 辅助科技（支线，v1.3：3 阶制） ====================

  /**
   * 开始研究辅助科技下一阶。要求：研究槽空闲 + 主线等级达标 + 未满阶 + 资源足够。
   * 资源在开始时扣除（防刷），到点后由 tick 生效
   */
  researchSideTech(id: string): boolean {
    if (this.state.techTree.researching) return false; // 研究槽被占用

    const config = getSideTechConfig(id);
    if (!config) return false;
    const rank = getSideTechRank(this.state, id);
    if (rank >= config.maxRank) return false; // 已满阶
    if (this.state.techTree.currentLevel < config.requiredLevel) return false;

    const goldCost = config.goldCosts[rank];
    const partsCost = config.partsCosts[rank];
    if (this.state.resources.gold < goldCost) return false;
    if (this.state.resources.parts < partsCost) return false;

    this.state.resources.gold -= goldCost;
    this.state.resources.parts -= partsCost;

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
  getSideTechState(id: string): {
    rank: number; maxRank: number; levelMet: boolean; canAfford: boolean;
    goldCost: number; partsCost: number;
  } {
    const config = getSideTechConfig(id);
    if (!config) return { rank: 0, maxRank: 0, levelMet: false, canAfford: false, goldCost: 0, partsCost: 0 };
    const rank = getSideTechRank(this.state, id);
    const maxed = rank >= config.maxRank;
    const goldCost = maxed ? 0 : config.goldCosts[rank];
    const partsCost = maxed ? 0 : config.partsCosts[rank];
    return {
      rank,
      maxRank: config.maxRank,
      levelMet: this.state.techTree.currentLevel >= config.requiredLevel,
      canAfford:
        !maxed &&
        this.state.resources.gold >= goldCost &&
        this.state.resources.parts >= partsCost &&
        !this.state.techTree.researching,
      goldCost,
      partsCost,
    };
  }

  // ==================== 子科技（v1.3：主线每级挂 2 项 × 3 阶，共享研究槽） ====================

  /**
   * 开始研究子科技下一阶。要求：研究槽空闲 + 所属主线等级已研究 + 未满 3 阶 + 资源足够。
   * 资源在开始时扣除（防刷），到点后由 tick 生效
   */
  researchSubTech(id: string): boolean {
    if (this.state.techTree.researching) return false; // 研究槽被占用

    const config = getSubTechConfig(id);
    if (!config) return false;
    if (this.state.techTree.currentLevel < config.mainLevel) return false; // 前置主线等级

    const rank = this.state.techTree.subTechs[id] ?? 0;
    if (rank >= 3) return false; // 已满阶

    const goldCost = config.goldCosts[rank];
    const partsCost = config.partsCosts[rank];
    if (this.state.resources.gold < goldCost) return false;
    if (this.state.resources.parts < partsCost) return false;

    this.state.resources.gold -= goldCost;
    this.state.resources.parts -= partsCost;

    const totalTime = config.researchTimes[rank];
    this.state.techTree.researching = {
      kind: 'sub',
      subId: id,
      totalTime,
      finishAt: Date.now() + totalTime * 1000,
    };

    if (this.debugInstantResearch) this.settleResearch();
    return true;
  }

  /** 子科技研究状态查询（UI 用） */
  getSubTechState(id: string): {
    rank: number; unlocked: boolean; canAfford: boolean;
    goldCost: number; partsCost: number; researchTime: number;
  } {
    const config = getSubTechConfig(id);
    if (!config) return { rank: 0, unlocked: false, canAfford: false, goldCost: 0, partsCost: 0, researchTime: 0 };
    const rank = this.state.techTree.subTechs[id] ?? 0;
    const maxed = rank >= 3;
    const goldCost = maxed ? 0 : config.goldCosts[rank];
    const partsCost = maxed ? 0 : config.partsCosts[rank];
    return {
      rank,
      unlocked: this.state.techTree.currentLevel >= config.mainLevel,
      canAfford:
        !maxed &&
        this.state.resources.gold >= goldCost &&
        this.state.resources.parts >= partsCost &&
        !this.state.techTree.researching,
      goldCost,
      partsCost,
      researchTime: maxed ? 0 : config.researchTimes[rank],
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
