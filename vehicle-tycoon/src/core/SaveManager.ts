// ============================================================
// 存档管理器 — 序列化、反序列化、离线计算
// ============================================================

import { EventBus } from './EventBus';
import { GameEvent, SaveData, OfflineResult, GameState, ChallengeRank, OrderType, Vehicle } from './types';
import { GAME_CONSTANTS } from '../config/GameConstants';
import { getVehicleConfig } from '../config/VehicleConfig';
import { EconomySystem, getGlobalIncomeMult } from '../systems/EconomySystem';

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

      if (data.factory?.productionLines?.length > 0 && 'currentOrder' in data.factory.productionLines[0]) {
        data.factory.productionLines = data.factory.productionLines.map((_: unknown, i: number) => ({
          index: i,
          isActive: true,
        }));
      }
      return SaveManager.migrate(data);
    } catch (err) {
      console.error('[SaveManager] Load failed:', err);
      return null;
    }
  }

  /**
   * 存档迁移：旧档缺失的顶层/嵌套字段用初始值补齐
   * （防止版本升级后访问新字段崩溃）
   */
  private static migrate(data: SaveData): SaveData {
    const defaults = SaveManager.createInitialState();
    const merged = { ...defaults, ...data };
    const nestedKeys = [
      'resources', 'factory', 'garage', 'techTree',
      'stats', 'prestige', 'challenge', 'settings',
    ] as const;
    for (const key of nestedKeys) {
      if (data[key] && typeof data[key] === 'object') {
        (merged as Record<string, unknown>)[key] = { ...defaults[key], ...data[key] };
      }
    }
    // 老档车辆补齐新增字段（磨损/疲劳/专精）
    if (merged.garage?.vehicles) {
      merged.garage.vehicles = merged.garage.vehicles.map(v => ({
        specialization: null,
        wear: 0,
        consecutiveOrders: 0,
        lastOrderCompletedAt: 0,
        ...(v as Partial<Vehicle>),
      } as Vehicle));
    }
    return merged;
  }

  /**
   * 计算离线收益
   * 金币：按车库每辆车的期望订单收入折算（期望模式，无随机）
   * 零件：按工厂产线速率折算
   */
  static calculateOfflineEarnings(state: GameState, offlineSeconds: number): OfflineResult {
    const effectiveSeconds = Math.min(offlineSeconds, MAX_OFFLINE_SECONDS);

    // 零件：产线持续产出
    const factory = state.factory;
    const lineCount = factory.productionLines.filter(l => l.isActive).length;
    const level = factory.level;
    const baseRate = GAME_CONSTANTS.FACTORY_BASE_RATE;
    const levelMult = 1 + (level - 1) * GAME_CONSTANTS.FACTORY_RATE_GROWTH;
    const pps = lineCount * baseRate * levelMult;
    const partsEarned = pps * effectiveSeconds * OFFLINE_EFFICIENCY;

    // 金币：车辆持续跑单（按期望收入 / 普通单时长估算 EPS）
    const globalMult = getGlobalIncomeMult(state);
    let eps = 0;
    for (const v of state.garage.vehicles) {
      const config = getVehicleConfig(v.tier);
      if (!config) continue;
      const { income } = EconomySystem.calculateOrderIncome(
        v, config.basePrice, 1.0, globalMult, false, state, OrderType.Normal
      );
      eps += income / GAME_CONSTANTS.ORDER_NORMAL_DURATION;
    }
    const goldEarned = eps * effectiveSeconds * OFFLINE_EFFICIENCY;

    return {
      offlineSeconds: effectiveSeconds,
      carsProduced: 0,
      goldEarned: Math.floor(goldEarned),
      partsEarned: Math.floor(partsEarned),
    };
  }

  /**
   * 应用离线收益到游戏状态
   */
  static applyOfflineEarnings(state: GameState, result: OfflineResult): void {
    state.resources.gold += result.goldEarned;
    state.resources.parts += result.partsEarned;
    state.stats.totalGoldEarned += result.goldEarned;
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
      resources: { gold: 200, parts: 0 },
      garage: {
        maxCapacity: 6,
        vehicles: [],
      },
      factory: {
        level: 1,
        productionLines: [
          { index: 0, isActive: true },
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
