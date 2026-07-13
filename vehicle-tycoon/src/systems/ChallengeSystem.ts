// ============================================================
// 挑战系统 — 竞速挑战、生存挑战、随机挑战
// ============================================================

import { EventBus } from '../core/EventBus';
import {
  GameEvent, GameState, ChallengeType, ChallengeRank,
  Vehicle, VehicleStatus, Quality, TraitType
} from '../core/types';
import { getVehicleConfig } from '../config/VehicleConfig';
import { GAME_CONSTANTS } from '../config/GameConstants';

const RANK_THRESHOLDS: Record<string, number> = {
  [ChallengeRank.Bronze]: 0,
  [ChallengeRank.Silver]: 5000,
  [ChallengeRank.Gold]: 15000,
  [ChallengeRank.Diamond]: 30000,
  [ChallengeRank.Legend]: 50000,
};

export class ChallengeSystem {
  private state: GameState;
  private challengeState: {
    type: ChallengeType | null;
    timeRemaining: number;
    score: number;
    modifiers: string[];
    initialGarage: Vehicle[];
  } | null = null;

  constructor(state: GameState) {
    this.state = state;
  }

  // ==================== 竞速挑战 ====================

  startSpeedRush(): boolean {
    if (this.challengeState) return false;

    this.challengeState = {
      type: ChallengeType.SpeedRush,
      timeRemaining: 180,
      score: 1000,
      modifiers: [],
      initialGarage: [],
    };

    this.challengeState.initialGarage = this.generateRandomFleet(3);
    this.state.phase = 'challenge';
    return true;
  }

  tickChallenge(deltaSeconds: number): void {
    if (!this.challengeState) return;
    this.challengeState.timeRemaining -= deltaSeconds;
    if (this.challengeState.timeRemaining <= 0) {
      this.endSpeedRush();
    }
  }

  private endSpeedRush(): void {
    if (!this.challengeState) return;

    const score = this.challengeState.score;
    const prevBest = this.state.challenge.speedRush.bestScore;

    if (score > prevBest) {
      this.state.challenge.speedRush.bestScore = score;
      this.state.challenge.speedRush.rank = this.calculateRank(score);
    }

    this.state.challenge.speedRush.dailyAttempts++;

    EventBus.emit(GameEvent.CHALLENGE_COMPLETED, {
      type: ChallengeType.SpeedRush,
      score,
      rank: this.state.challenge.speedRush.rank,
      isNewBest: score > prevBest,
    });

    this.challengeState = null;
    this.state.phase = 'playing';
  }

  private calculateRank(score: number): ChallengeRank {
    if (score >= RANK_THRESHOLDS[ChallengeRank.Legend]) return ChallengeRank.Legend;
    if (score >= RANK_THRESHOLDS[ChallengeRank.Diamond]) return ChallengeRank.Diamond;
    if (score >= RANK_THRESHOLDS[ChallengeRank.Gold]) return ChallengeRank.Gold;
    if (score >= RANK_THRESHOLDS[ChallengeRank.Silver]) return ChallengeRank.Silver;
    return ChallengeRank.Bronze;
  }

  // ==================== 生存挑战 ====================

  startSurvival(): boolean {
    if (!this.state.challenge.survival.isUnlocked) return false;
    if (this.challengeState) return false;

    this.challengeState = {
      type: ChallengeType.Survival,
      timeRemaining: -1,
      score: 5000,
      modifiers: [],
      initialGarage: [],
    };

    this.state.phase = 'challenge';
    return true;
  }

  // ==================== 随机挑战 ====================

  private readonly RANDOM_MODIFIERS = [
    { id: 'inflation', name: '通货膨胀', effect: 'price_x2_cost_x3' },
    { id: 'strike', name: '罢工日', effect: 'speed_half' },
    { id: 'quality_craze', name: '品质狂热', effect: 'gold_quality_x3' },
    { id: 'parts_shortage', name: '零件荒', effect: 'no_parts' },
    { id: 'harvest', name: '丰收季节', effect: 'income_x3' },
    { id: 'time_fly', name: '时光飞逝', effect: 'aging_x3' },
    { id: 'nostalgia', name: '怀旧情怀', effect: 'low_tier_bonus' },
    { id: 'solo', name: '独角戏', effect: 'garage_3' },
    { id: 'blizzard', name: '暴风雪', effect: 'order_slow' },
  ];

  startRandomizer(): boolean {
    if (this.challengeState) return false;

    const modifierCount = 1 + Math.floor(Math.random() * 3);
    const shuffled = [...this.RANDOM_MODIFIERS].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, modifierCount);

    this.challengeState = {
      type: ChallengeType.Randomizer,
      timeRemaining: 300,
      score: 1000,
      modifiers: selected.map(m => m.id),
      initialGarage: this.generateRandomFleet(2),
    };

    this.state.phase = 'challenge';
    return true;
  }

  private endRandomizer(): void {
    if (!this.challengeState) return;

    const score = this.challengeState.score;

    if (score > this.state.challenge.randomizer.bestScore) {
      this.state.challenge.randomizer.bestScore = score;
    }
    this.state.challenge.randomizer.completedRuns++;

    EventBus.emit(GameEvent.CHALLENGE_COMPLETED, {
      type: ChallengeType.Randomizer,
      score,
      modifiers: this.challengeState.modifiers,
    });

    this.challengeState = null;
    this.state.phase = 'playing';
  }

  // ==================== 辅助 ====================

  private generateRandomFleet(count: number): Vehicle[] {
    const fleet: Vehicle[] = [];
    const traits = Object.values(TraitType);

    for (let i = 0; i < count; i++) {
      const tier = 1 + Math.floor(Math.random() * 3);
      const vehicle: Vehicle = {
        id: `challenge_v_${i}`,
        tier,
        name: `挑战者 #${i + 1}`,
        level: 1 + Math.floor(Math.random() * 5),
        exp: 0,
        quality: [Quality.White, Quality.Blue][Math.floor(Math.random() * 2)],
        trait: traits[Math.floor(Math.random() * traits.length)],
        intimacy: 0,
        stats: {
          speed: Math.floor(Math.random() * 3),
          cargo: Math.floor(Math.random() * 3),
          durability: Math.floor(Math.random() * 3),
        },
        isEvolved: false,
        ordersCompleted: 0,
        totalEarnings: 0,
        createdAt: Date.now(),
        status: VehicleStatus.Idle,
        statusEndAt: 0,
      };
      fleet.push(vehicle);
    }

    return fleet;
  }

  // ==================== 查询 ====================

  getChallengeState() {
    return this.challengeState;
  }

  isInChallenge(): boolean {
    return this.challengeState !== null;
  }

  canPlaySpeedRush(): boolean {
    return this.state.challenge.speedRush.dailyAttempts < 3;
  }

  getRankRewards(rank: ChallengeRank): { parts: number; hasSkin: boolean } {
    switch (rank) {
      case ChallengeRank.Bronze: return { parts: 5, hasSkin: false };
      case ChallengeRank.Silver: return { parts: 15, hasSkin: false };
      case ChallengeRank.Gold: return { parts: 30, hasSkin: true };
      case ChallengeRank.Diamond: return { parts: 50, hasSkin: true };
      case ChallengeRank.Legend: return { parts: 100, hasSkin: true };
    }
    return { parts: 0, hasSkin: false };
  }
}
