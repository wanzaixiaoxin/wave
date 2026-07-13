// ============================================================
// 轮回系统 — 重置、声望点、声望商店
// ============================================================

import { EventBus } from '../core/EventBus';
import { GameEvent, GameState, Vehicle, VehicleStatus } from '../core/types';
import { GAME_CONSTANTS } from '../config/GameConstants';

interface PrestigeShopItem {
  id: string;
  name: string;
  description: string;
  cost: number;
  maxPurchases: number;
  effectType: string;
  effectValue: number;
}

const SHOP_ITEMS: PrestigeShopItem[] = [
  {
    id: 'accelerator',
    name: '🚀 加速器',
    description: '全车型生产速度 +10%',
    cost: 5,
    maxPurchases: 5,
    effectType: 'speed_mult',
    effectValue: 0.9,
  },
  {
    id: 'fortuna',
    name: '💰 财神爷',
    description: '全车型收入 +10%',
    cost: 5,
    maxPurchases: 5,
    effectType: 'income_mult',
    effectValue: 1.1,
  },
  {
    id: 'gene_mod',
    name: '🧬 基因改造',
    description: '新车稀有特质概率 +5%',
    cost: 10,
    maxPurchases: 3,
    effectType: 'rare_trait_chance',
    effectValue: 0.05,
  },
  {
    id: 'space_fold',
    name: '🏠 空间折叠',
    description: '车库初始容量 +2',
    cost: 15,
    maxPurchases: 3,
    effectType: 'garage_bonus',
    effectValue: 2,
  },
  {
    id: 'starlight',
    name: '🌟 星光之路',
    description: '全车型暴击率 +5%',
    cost: 20,
    maxPurchases: 3,
    effectType: 'crit_rate',
    effectValue: 0.05,
  },
  {
    id: 'prestige_skin',
    name: '🎨 轮回涂装',
    description: '只有轮回玩家能使用的专属涂装',
    cost: 30,
    maxPurchases: 1,
    effectType: 'skin',
    effectValue: 0,
  },
  {
    id: 'prestige_title',
    name: '🏆 轮回者称号',
    description: '显示在名字前的金色称号',
    cost: 50,
    maxPurchases: 1,
    effectType: 'title',
    effectValue: 0,
  },
  {
    id: 'endless',
    name: '🔄 无尽挑战',
    description: '解锁无尽模式（没有时间限制的挑战）',
    cost: 100,
    maxPurchases: 1,
    effectType: 'unlock_endless',
    effectValue: 0,
  },
];

export class PrestigeSystem {
  private state: GameState;

  constructor(state: GameState) {
    this.state = state;
  }

  // ==================== 轮回 ====================

  /**
   * 执行轮回重置
   */
  prestige(): boolean {
    // 条件检查
    if (this.state.techTree.currentLevel < 5) return false; // 未通关
    if (this.state.stats.totalGoldEarned < GAME_CONSTANTS.PRESTIGE_GOLD_THRESHOLD) return false;
    if (this.state.prestige.count >= GAME_CONSTANTS.PRESTIGE_MAX_COUNT) return false;

    // 计算声望点数
    const pointsEarned = Math.floor(
      this.state.stats.totalGoldEarned / 1000000
    );
    this.state.prestige.points += pointsEarned;
    this.state.prestige.count++;

    // 保存需要保留的数据
    const preservedPurchases = [...this.state.prestige.purchases];
    const preservedPoints = this.state.prestige.points;
    const preservedCount = this.state.prestige.count;
    const preservedAchievements = this.state.achievements
      .filter(a => a.isUnlocked)
      .map(a => ({ id: a.id, unlockedAt: a.unlockedAt }));

    // 获取轮回加成
    const bonuses = this.getPrestigeBonuses(preservedCount);

    // 重置游戏状态（保留声望数据）
    this.state.phase = 'playing';
    this.state.resources = { gold: 500 + bonuses.startingGold, parts: 0 };
    this.state.garage.vehicles = [];
    this.state.garage.maxCapacity = 6 + (bonuses.garageBonus ?? 0);
    this.state.factory.level = 1;
    this.state.factory.productionLines = [
      { index: 0, currentOrder: null, queue: [] },
    ];
    // 加额外产线
    for (let i = 0; i < (bonuses.extraLines ?? 0); i++) {
      this.state.factory.productionLines.push({
        index: this.state.factory.productionLines.length,
        currentOrder: null,
        queue: [],
      });
    }
    this.state.orders = [];
    this.state.techTree = {
      currentLevel: 1,
      isResearched: [false, false, false, false, false],
      producedCount: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    };
    this.state.activeEvents = [];
    this.state.stats = {
      totalGoldEarned: 0,
      totalVehiclesProduced: 0,
      totalOrdersCompleted: 0,
      totalEvolutions: 0,
      totalPlayTime: 0,
      offlineTime: 0,
    };

    // 恢复声望数据
    this.state.prestige.count = preservedCount;
    this.state.prestige.points = preservedPoints;
    this.state.prestige.purchases = preservedPurchases;

    EventBus.emit(GameEvent.PRESTIGE_RESET, {
      count: preservedCount,
      pointsEarned,
      bonuses,
    });

    return true;
  }

  /**
   * 获取轮回加成
   */
  private getPrestigeBonuses(count: number): {
    startingGold: number;
    extraLines: number;
    garageBonus: number;
    qualityChance: number;
  } {
    switch (count) {
      case 1:
        return { startingGold: 500, extraLines: 0, garageBonus: 0, qualityChance: 0 };
      case 2:
        return { startingGold: 1000, extraLines: 1, garageBonus: 0, qualityChance: 0 };
      case 3:
        return { startingGold: 2000, extraLines: 2, garageBonus: 0, qualityChance: 0.2 };
      default:
        return {
          startingGold: 500 + (count - 1) * 500,
          extraLines: Math.min(count - 1, 3),
          garageBonus: Math.floor((count - 1) / 2) * 1,
          qualityChance: Math.min((count - 1) * 0.1, 0.5),
        };
    }
  }

  // ==================== 声望商店 ====================

  purchase(itemId: string): boolean {
    const item = SHOP_ITEMS.find(i => i.id === itemId);
    if (!item) return false;

    const purchasedCount = this.state.prestige.purchases.filter(id => id === itemId).length;
    if (purchasedCount >= item.maxPurchases) return false;
    if (this.state.prestige.points < item.cost) return false;

    this.state.prestige.points -= item.cost;
    this.state.prestige.purchases.push(itemId);

    // 应用效果
    if (item.effectType === 'garage_bonus') {
      this.state.garage.maxCapacity += item.effectValue;
    }

    return true;
  }

  getShopItems() {
    return SHOP_ITEMS.map(item => {
      const purchasedCount = this.state.prestige.purchases.filter(id => id === item.id).length;
      return {
        ...item,
        purchasedCount,
        canPurchase: purchasedCount < item.maxPurchases
          && this.state.prestige.points >= item.cost,
      };
    });
  }

  // ==================== 查询 ====================

  canPrestige(): boolean {
    if (this.state.prestige.count >= GAME_CONSTANTS.PRESTIGE_MAX_COUNT) return false;
    if (this.state.techTree.currentLevel < 5) return false;
    if (this.state.stats.totalGoldEarned < GAME_CONSTANTS.PRESTIGE_GOLD_THRESHOLD) return false;
    return true;
  }

  getPrestigeCount(): number {
    return this.state.prestige.count;
  }

  getPrestigePoints(): number {
    return this.state.prestige.points;
  }

  /**
   * 获取全局倍率（轮回难度）
   */
  getGlobalDifficultyMultiplier(): { income: number; cost: number; tech: number } {
    const count = this.state.prestige.count;
    if (count <= 0) return { income: 1.0, cost: 1.0, tech: 1.0 };
    if (count <= 2) return { income: 1.0, cost: 1.1, tech: 1.0 };
    if (count <= 4) return { income: 1.1, cost: 1.3, tech: 1.1 };
    return { income: 1.2, cost: 1.5, tech: 1.2 };
  }
}
