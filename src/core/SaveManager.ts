// ============================================================
// 存档管理器 — 序列化、反序列化、离线计算
// ============================================================

import { EventBus } from './EventBus';
import { GameEvent, SaveData, OfflineResult, GameState, VehicleConfigEntry, ChallengeRank } from './types';
import { VEHICLE_CONFIGS } from '../config/VehicleConfig';

const SAVE_KEY = 'tycoon_save_v1';
const SAVE_VERSION = '1.0';
const MAX_OFFLINE_SECONDS = 2 * 3600; // 2 hours
const OFFLINE_EFFICIENCY = 0.4;

export class SaveManager {
  private static autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private static lastSaveTime = Date.now();

  /**
   * 保存游戏
   */
  static save(state: GameState): void {
    try {
      const data: SaveData = {
        version: SAVE_VERSION,
        timestamp: Date.now(),
        resources: state.resources,
        factory: state.factory,
        garage: state.garage,
        techTree: state.techTree,
        achievements: state.achievements,
        stats: state.stats,
        prestige: state.prestige,
        challenge: state.challenge,
        settings: state.settings,
      };
      const json = JSON.stringify(data);
      localStorage.setItem(SAVE_KEY, json);
      SaveManager.lastSaveTime = Date.now();
      EventBus.emit(GameEvent.GAME_SAVED, data.timestamp);
    } catch (err) {
      console.error('[SaveManager] Save failed:', err);
    }
  }

  /**
   * 读取存档
   */
  static load(): SaveData | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;

      const data = JSON.parse(raw) as SaveData;

      // 版本兼容检查
      if (!data.version) {
        console.warn('[SaveManager] Unknown save version, attempting migration');
      }

      return data;
    } catch (err) {
      console.error('[SaveManager] Load failed:', err);
      return null;
    }
  }

  /**
   * 计算离线收益
   */
  static calculateOfflineEarnings(factory: GameState['factory'], offlineSeconds: number): OfflineResult {
    const effectiveSeconds = Math.min(offlineSeconds, MAX_OFFLINE_SECONDS);
    const effectiveTicks = Math.floor(effectiveSeconds * OFFLINE_EFFICIENCY);

    let totalGold = 0;
    let totalParts = 0;
    let totalCars = 0;

    for (const line of factory.productionLines) {
      if (line.currentOrder) {
        const tier = line.currentOrder.tier;
        const config = VEHICLE_CONFIGS.find(c => c.tier === tier);
        if (config) {
          const carsProduced = Math.floor(effectiveTicks / config.buildTime);
          totalCars += carsProduced;
          totalGold += carsProduced * config.basePrice;
          totalParts += Math.floor(carsProduced * config.partsCost * 0.1);
        }
      }
    }

    return {
      offlineSeconds: effectiveSeconds,
      carsProduced: totalCars,
      goldEarned: Math.floor(totalGold),
      partsEarned: Math.floor(totalParts),
    };
  }

  /**
   * 应用离线收益到游戏状态
   */
  static applyOfflineEarnings(state: GameState, result: OfflineResult): void {
    state.resources.gold += result.goldEarned;
    state.resources.parts += result.partsEarned;
    state.stats.totalVehiclesProduced += result.carsProduced;
    state.stats.offlineTime += result.offlineSeconds;

    EventBus.emit(GameEvent.OFFLINE_EARNINGS, result);
  }

  /**
   * 自动存档（每 N 秒）
   */
  static startAutoSave(state: () => GameState, intervalSeconds = 30): void {
    if (SaveManager.autoSaveTimer) return;

    SaveManager.autoSaveTimer = setInterval(() => {
      SaveManager.save(state());
    }, intervalSeconds * 1000);
  }

  /**
   * 停止自动存档
   */
  static stopAutoSave(): void {
    if (SaveManager.autoSaveTimer) {
      clearInterval(SaveManager.autoSaveTimer);
      SaveManager.autoSaveTimer = null;
    }
  }

  /**
   * 获取最后一次存档时间
   */
  static getLastSaveTime(): number {
    return SaveManager.lastSaveTime;
  }

  /**
   * 删除存档（用于轮回重置）
   */
  static deleteSave(): void {
    localStorage.removeItem(SAVE_KEY);
    SaveManager.lastSaveTime = Date.now();
  }

  /**
   * 创建初始游戏状态
   */
  static createInitialState(): GameState {
    return {
      phase: 'playing',
      resources: { gold: 100, parts: 0 },
      garage: {
        maxCapacity: 6,
        vehicles: [],
      },
      factory: {
        level: 1,
        productionLines: [
          { index: 0, currentOrder: null, queue: [] },
        ],
      },
      orders: [],
      techTree: {
        currentLevel: 1,
        isResearched: [false, false, false, false, false],
        producedCount: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
      activeEvents: [],
      achievements: [],
      stats: {
        totalGoldEarned: 0,
        totalVehiclesProduced: 0,
        totalOrdersCompleted: 0,
        totalEvolutions: 0,
        totalPlayTime: 0,
        offlineTime: 0,
      },
      prestige: {
        count: 0,
        points: 0,
        purchases: [],
      },
      challenge: {
        speedRush: { bestScore: 0, rank: ChallengeRank.Bronze, dailyAttempts: 0 },
        survival: { isUnlocked: false, bestProgress: 0 },
        randomizer: { bestScore: 0, completedRuns: 0 },
      },
      settings: {
        soundEnabled: true,
        musicEnabled: true,
        autoCollectOrders: false,
      },
    };
  }
}
