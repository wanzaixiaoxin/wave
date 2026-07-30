// ============================================================
// 成就系统 — 条件检查、解锁、奖励
// ============================================================

import { EventBus } from '../core/EventBus';
import { GameEvent, GameState, Achievement, AchievementCondition, AchievementReward } from '../core/types';
import { GAME_CONSTANTS } from '../config/GameConstants';

export class AchievementSystem {
  private state: GameState;
  private static readonly ACHIEVEMENT_DEFS: Array<{
    id: string;
    name: string;
    description: string;
    condition: AchievementCondition;
    reward: AchievementReward;
  }> = [
    {
      id: 'first_vehicle',
      name: '第一声啼哭',
      description: '造出你的第一辆车',
      condition: { type: 'produce_count', target: 1 },
      reward: { gold: 50 },
    },
    {
      id: 'fleet_commander',
      name: '飞驰人生',
      description: '同一辆车完成 100 单',
      condition: { type: 'order_count', target: 100 },
      reward: { title: '老司机' },
    },
    {
      id: 'all_rounder',
      name: '五维全能',
      description: '同一辆车的速度/载货/耐久全部升到 5 级',
      condition: { type: 'stats_max', target: 15 },
      reward: { title: '全能选手' },
    },
    {
      id: 'big_family',
      name: '大家族',
      description: '同时拥有 10 辆工业型规格车',
      condition: { type: 'quality_count', target: 10 },
      reward: { gold: 20000, parts: 2000 },
    },
    {
      id: 'tradein_master',
      name: '更新换代',
      description: '累计以旧换新 5 次',
      condition: { type: 'tradein_count', target: 5 },
      reward: { gold: 1000, parts: 100 },
    },
    {
      id: 'produce_10',
      name: '十辆下线',
      description: '累计造出 10 辆车',
      condition: { type: 'produce_count', target: 10 },
      reward: { gold: 300 },
    },
    {
      id: 'produce_50',
      name: '量产达人',
      description: '累计造出 50 辆车',
      condition: { type: 'produce_count', target: 50 },
      reward: { gold: 3000, parts: 300 },
    },
    {
      id: 'profit_10k',
      name: '第一桶金',
      description: '累计收入 10,000🪙',
      condition: { type: 'profit_total', target: 10000 },
      reward: { gold: 1000 },
    },
    {
      id: 'profit_1m',
      name: '百万富翁',
      description: '累计收入 1,000,000🪙',
      condition: { type: 'profit_total', target: 1000000 },
      reward: { gold: 20000, parts: 1000 },
    },
    {
      id: 'orders_50',
      name: '使命必达',
      description: '全车队累计完成 50 单',
      condition: { type: 'total_orders', target: 50 },
      reward: { gold: 1500, parts: 150 },
    },
    {
      id: 'refurbish_2',
      name: '焕然一新',
      description: '累计翻新 2 次（折旧回春，老车第二春）',
      condition: { type: 'refurbish_count', target: 2 },
      reward: { gold: 2000, parts: 200 },
    },
    {
      id: 'tech_max',
      name: '科技巅峰',
      description: '主线科技研究到 Lv.5',
      condition: { type: 'tech_level', target: 5 },
      reward: { gold: 10000, parts: 1000 },
    },
    {
      id: 'factory_max',
      name: '工业巨擘',
      description: '工厂升到 Lv.10',
      condition: { type: 'factory_level', target: 10 },
      reward: { gold: 20000, parts: 2000 },
    },
    {
      id: 'side_tech_2',
      name: '博采众长',
      description: '研究 2 项辅助科技',
      condition: { type: 'side_tech_count', target: 2 },
      reward: { gold: 3000, parts: 300 },
    },
  ];

  constructor(state: GameState) {
    this.state = state;

    // 初始化成就列表；旧存档缺少的新增成就按 id 补齐（保留已有解锁状态）
    const existing = new Map(state.achievements.map(a => [a.id, a]));
    state.achievements = AchievementSystem.ACHIEVEMENT_DEFS.map(def => {
      const old = existing.get(def.id);
      return old ?? { ...def, isUnlocked: false, unlockedAt: null };
    });
  }

  // ==================== Tick（每秒检查） ====================

  tick(): void {
    for (const achievement of this.state.achievements) {
      if (achievement.isUnlocked) continue;

      if (this.checkCondition(achievement)) {
        this.unlock(achievement);
      }
    }
  }

  // ==================== 条件检查 ====================

  private checkCondition(achievement: Achievement): boolean {
    const { condition } = achievement;

    switch (condition.type) {
      case 'produce_count':
        return this.state.stats.totalVehiclesProduced >= condition.target;

      case 'quality_count':
        return this.state.garage.vehicles.filter(v => v.quality === 'gold').length >= condition.target;

      case 'stats_max':
        return this.state.garage.vehicles.some(
          v => v.stats.speed + v.stats.cargo + v.stats.durability >= condition.target
        );

      case 'profit_total':
        return this.state.stats.totalGoldEarned >= condition.target;

      case 'order_count':
        return this.state.garage.vehicles.some(v => v.ordersCompleted >= condition.target);

      case 'tradein_count':
        return this.state.stats.totalTradeIns >= condition.target;

      case 'total_orders':
        return this.state.stats.totalOrdersCompleted >= condition.target;

      case 'tech_level':
        return this.state.techTree.currentLevel >= condition.target;

      case 'factory_level':
        return this.state.factory.level >= condition.target;

      case 'refurbish_count':
        return this.state.stats.totalRefurbishes >= condition.target;

      case 'side_tech_count':
        return Object.values(this.state.techTree.sideTechs).filter(n => n > 0).length >= condition.target;

      default:
        return false;
    }
  }

  // ==================== 解锁 ====================

  private unlock(achievement: Achievement): void {
    achievement.isUnlocked = true;
    achievement.unlockedAt = Date.now();

    // 发放奖励
    if (achievement.reward.gold) {
      this.state.resources.gold += achievement.reward.gold;
    }
    if (achievement.reward.parts) {
      this.state.resources.parts += achievement.reward.parts;
    }

    EventBus.emit(GameEvent.ACHIEVEMENT_UNLOCKED, achievement);
  }

  // ==================== 查询 ====================

  getProgress(achievementId: string): number {
    const achievement = this.state.achievements.find(a => a.id === achievementId);
    if (!achievement) return 0;
    if (achievement.isUnlocked) return 1;

    const condition = achievement.condition;
    let current = 0;

    switch (condition.type) {
      case 'produce_count': current = this.state.stats.totalVehiclesProduced; break;
      case 'quality_count':
        current = this.state.garage.vehicles.filter(v => v.quality === 'gold').length;
        break;
      case 'stats_max':
        current = Math.max(
          ...this.state.garage.vehicles.map(v => v.stats.speed + v.stats.cargo + v.stats.durability),
          0
        );
        break;
      case 'profit_total': current = this.state.stats.totalGoldEarned; break;
      case 'order_count':
        current = Math.max(...this.state.garage.vehicles.map(v => v.ordersCompleted), 0);
        break;
      case 'tradein_count': current = this.state.stats.totalTradeIns; break;
      case 'total_orders': current = this.state.stats.totalOrdersCompleted; break;
      case 'tech_level': current = this.state.techTree.currentLevel; break;
      case 'factory_level': current = this.state.factory.level; break;
      case 'refurbish_count': current = this.state.stats.totalRefurbishes; break;
      case 'side_tech_count':
        current = Object.values(this.state.techTree.sideTechs).filter(n => n > 0).length;
        break;
    }

    return Math.min(1, current / condition.target);
  }

  getUnlockedCount(): number {
    return this.state.achievements.filter(a => a.isUnlocked).length;
  }

  getTotalCount(): number {
    return this.state.achievements.length;
  }
}
