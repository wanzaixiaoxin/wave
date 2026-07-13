// ============================================================
// 造物运输大亨 — 游戏入口
// 导出所有核心模块，供 UI 层 / Cocos Creator 编辑器调用
// ============================================================

// 核心基础设施
export { EventBus } from './core/EventBus';
export { GameLoop } from './core/GameLoop';
export { SaveManager } from './core/SaveManager';

// 类型定义
export * from './core/types';

// 配置表
export { VEHICLE_CONFIGS, getVehicleConfig, getUnlockedConfigs } from './config/VehicleConfig';
export { TECH_CONFIGS, getTechConfig } from './config/TechConfig';
export { TRAIT_CONFIGS, rollTrait, getTraitConfig } from './config/TraitConfig';
export { GAME_CONSTANTS, expForLevel, cumulativeExpForLevel, statUpgradeCost, garageExpandCost } from './config/GameConstants';

// 系统
export { VehicleSystem } from './systems/VehicleSystem';
export { OrderSystem } from './systems/OrderSystem';
export { FactorySystem } from './systems/FactorySystem';
export { TechSystem } from './systems/TechSystem';
export { EconomySystem } from './systems/EconomySystem';
export { IntimacySystem } from './systems/IntimacySystem';
export { AchievementSystem } from './systems/AchievementSystem';
export { EventSystem } from './systems/EventSystem';
export { ChallengeSystem } from './systems/ChallengeSystem';
export { PrestigeSystem } from './systems/PrestigeSystem';

// 为了便捷创建而内部引用
import { SaveManager as SM } from './core/SaveManager';
import { GameLoop as GL } from './core/GameLoop';

/**
 * 创建新游戏实例
 */
export function createNewGame(): GL {
  const initialState = SM.createInitialState();
  return new GL(initialState);
}

/**
 * 加载已有存档
 */
export function loadGame(): GL | null {
  const saveData = SM.load();
  if (!saveData) return null;

  const state = SM.createInitialState();
  state.resources = saveData.resources;
  state.factory = saveData.factory;
  state.garage = saveData.garage;
  state.techTree = saveData.techTree;
  state.achievements = saveData.achievements;
  state.stats = saveData.stats;
  state.prestige = saveData.prestige;
  state.challenge = saveData.challenge;
  state.settings = saveData.settings;

  const gameLoop = new GL(state);

  // 计算离线收益
  const offlineMs = Date.now() - saveData.timestamp;
  const offlineSeconds = Math.floor(offlineMs / 1000);
  if (offlineSeconds > 10) {
    gameLoop.handleOfflineReturn(offlineSeconds);
  }

  return gameLoop;
}
