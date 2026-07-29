// ============================================================
// 存档管理器 — 序列化、反序列化、离线计算
// ============================================================

import { EventBus } from './EventBus';
import { GameEvent, SaveData, OfflineResult, GameState, OrderType } from './types';
import { GAME_CONSTANTS } from '../config/GameConstants';
import { getVehicleConfig } from '../config/VehicleConfig';
import { EconomySystem, getGlobalIncomeMult } from '../systems/EconomySystem';
import { getUpgradeMult } from '../systems/UpgradeSystem';

const SAVE_KEY = 'tycoon_save_v1';
const SAVE_VERSION = '2.0'; // 2.0：纯经营转型 S0（删命名/亲密度/进化/Prestige/Challenge）；老档不迁移，版本不匹配直接开新局
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

      // 版本检查（M8 起老档不迁移）：版本不匹配直接开新局
      if (data.version !== SAVE_VERSION) {
        console.warn(`[SaveManager] 存档版本不匹配（存档 ${data.version ?? '未知'} / 当前 ${SAVE_VERSION}），已作废开新局`);
        return null;
      }
      return data;
    } catch (err) {
      console.error('[SaveManager] Load failed:', err);
      return null;
    }
  }

  /**
   * 计算离线收益
   * 金币：按车库每辆车的期望订单收入折算（期望模式，无随机）
   * 零件：按工厂产线速率折算
   */
  static calculateOfflineEarnings(state: GameState, offlineSeconds: number): OfflineResult {
    const effectiveSeconds = Math.min(offlineSeconds, MAX_OFFLINE_SECONDS);

    // 零件：产线持续产出（含产线自动化改造倍率，v1.3 统一乘区）
    const factory = state.factory;
    const lineCount = factory.productionLines.filter(l => l.isActive).length;
    const level = factory.level;
    const baseRate = GAME_CONSTANTS.FACTORY_BASE_RATE;
    const levelMult = 1 + (level - 1) * GAME_CONSTANTS.FACTORY_RATE_GROWTH;
    const pps = lineCount * baseRate * levelMult * getUpgradeMult(state, 'parts_rate');
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
    // 离线期间电站按真实时间持续产电（M8），到储存上限停产（含能效/储能改造倍率，v1.3）
    const powerMult = 1 + (state.factory.powerLevel - 1) * GAME_CONSTANTS.POWER_RATE_GROWTH;
    const techBoost = state.techTree.currentLevel >= 3 ? 1 + GAME_CONSTANTS.TECH_SPEED_BOOST : 1.0;
    const cap = Math.floor(
      GAME_CONSTANTS.POWER_CAPACITY_PER_LEVEL * state.factory.powerLevel *
      getUpgradeMult(state, 'power_cap')
    );
    state.resources.energy = Math.min(
      cap,
      state.resources.energy + GAME_CONSTANTS.POWER_BASE_RATE * powerMult * techBoost *
        getUpgradeMult(state, 'power_rate') * result.offlineSeconds
    );
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
   * 删除存档（用于重置游戏）
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
      resources: { gold: 200, parts: 0, energy: GAME_CONSTANTS.INITIAL_ENERGY, reputation: 0 },
      garage: {
        maxCapacity: 6,
        vehicles: [],
        inheritanceExp: 0,
        buildQueue: [],
      },
      factory: {
        level: 1,
        productionLines: [
          { index: 0, isActive: true },
        ],
        overclockUntil: 0,
        overclockCooldownUntil: 0,
        powerLevel: 1,   // 新开局送 1 级电站（M8）
        retrofits: {},   // 改造线等级（v1.3）
      },
      orders: [],
      techTree: {
        currentLevel: 1,
        isResearched: [false, false, false, false, false],
        producedCount: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        sideTechs: {},
        subTechs: {},
        researching: null,
      },
      activeEvents: [],
      achievements: [],
      stats: {
        totalGoldEarned: 0,
        totalVehiclesProduced: 0,
        totalOrdersCompleted: 0,
        totalTradeIns: 0,
        totalVehiclesInherited: 0,
        totalPlayTime: 0,
        offlineTime: 0,
      },
      settings: {
        soundEnabled: true,
        musicEnabled: true,
        autoCollectOrders: false,
      },
    };
  }
}
