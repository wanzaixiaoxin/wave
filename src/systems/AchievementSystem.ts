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
      description: '同一辆车集满 5 级全属性',
      condition: { type: 'produce_count', target: 5 }, // special check in tick()
      reward: { title: '全能选手' },
    },
    {
      id: 'soulmate',
      name: '至死不渝',
      description: '与同一辆车亲密度达到 100',
      condition: { type: 'intimacy_max', target: 100 },
      reward: { title: '最好的伙伴' },
    },
    {
      id: 'big_family',
      name: '大家族',
      description: '同时拥有 10 辆传说品质车',
      condition: { type: 'quality_count', target: 10 },
      reward: { skin: '星光大道' },
    },
    {
      id: 'evolution_master',
      name: '进化狂人',
      description: '完成第一次进化',
      condition: { type: 'evolve_count', target: 1 },
      reward: { gold: 1000, parts: 100 },
    },
    {
      id: 'rainbow_team',
      name: '彩虹战队',
      description: '集齐 7 种不同性格特质的传说车',
      condition: { type: 'trait_collect', target: 6 },
      reward: { skin: '彩虹战队' },
    },
  ];

  constructor(state: GameState) {
    this.state = state;

    // 初始化成就列表
    if (state.achievements.length === 0) {
      state.achievements = AchievementSystem.ACHIEVEMENT_DEFS.map(def => ({
        ...def,
        isUnlocked: false,
        unlockedAt: null,
      }));
    }
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

      case 'evolve_count':
        return this.state.stats.totalEvolutions >= condition.target;

      case 'intimacy_max':
        return this.state.garage.vehicles.some(v => v.intimacy >= condition.target);

      case 'quality_count':
        return this.state.garage.vehicles.filter(v => v.quality === 'gold').length >= condition.target;

      case 'trait_collect': {
        const traits = new Set(this.state.garage.vehicles.map(v => v.trait).filter(Boolean));
        return traits.size >= condition.target;
      }

      case 'profit_total':
        return this.state.stats.totalGoldEarned >= condition.target;

      case 'order_count':
        return this.state.garage.vehicles.some(v => v.ordersCompleted >= condition.target);

      case 'prestige_count':
        return this.state.prestige.count >= condition.target;

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
      case 'evolve_count': current = this.state.stats.totalEvolutions; break;
      case 'intimacy_max':
        current = Math.max(...this.state.garage.vehicles.map(v => v.intimacy), 0);
        break;
      case 'quality_count':
        current = this.state.garage.vehicles.filter(v => v.quality === 'gold').length;
        break;
      case 'trait_collect': {
        const traits = new Set(this.state.garage.vehicles.map(v => v.trait).filter(Boolean));
        current = traits.size;
        break;
      }
      case 'profit_total': current = this.state.stats.totalGoldEarned; break;
      case 'order_count':
        current = Math.max(...this.state.garage.vehicles.map(v => v.ordersCompleted), 0);
        break;
      case 'prestige_count': current = this.state.prestige.count; break;
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
