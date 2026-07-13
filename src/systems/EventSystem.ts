// ============================================================
// 随机事件系统 — 触发、效果、过期
// ============================================================

import { EventBus } from '../core/EventBus';
import { GameEvent, GameState, ActiveEvent } from '../core/types';

interface EventTemplate {
  id: string;
  name: string;
  probability: number;   // 每次 tick 的触发概率
  effectType: string;
  effectValue: number;
  duration: number;      // 秒
  description: string;
}

const EVENT_TEMPLATES: EventTemplate[] = [
  {
    id: 'big_order',
    name: '大订单',
    probability: 0.003,   // 0.3% per tick ≈ 每5分钟一次
    effectType: 'order_mult',
    effectValue: 3.0,
    duration: 0,          // 单次，不持续
    description: '刷出一个高额订单（收入 ×3）',
  },
  {
    id: 'bull_market',
    name: '牛市',
    probability: 0.002,
    effectType: 'price_mult',
    effectValue: 1.5,
    duration: 30,
    description: '所有车辆售价 +50%',
  },
  {
    id: 'bear_market',
    name: '熊市',
    probability: 0.0015,
    effectType: 'price_mult',
    effectValue: 0.7,
    duration: 30,
    description: '所有车辆售价 -30%',
  },
  {
    id: 'parts_rain',
    name: '零件雨',
    probability: 0.0025,
    effectType: 'parts_mult',
    effectValue: 3.0,
    duration: 0,
    description: '下一次获得零件 ×3',
  },
  {
    id: 'speed_boost',
    name: '加速光环',
    probability: 0.002,
    effectType: 'speed_mult',
    effectValue: 1.5,
    duration: 20,
    description: '所有产线生产速度 +50%',
  },
  {
    id: 'rest_time',
    name: '全员休息',
    probability: 0.001,
    effectType: 'stop_production',
    effectValue: 0,
    duration: 10,
    description: '所有车辆停止工作 10 秒',
  },
  {
    id: 'inspiration',
    name: '灵感闪现',
    probability: 0.0015,
    effectType: 'tech_boost',
    effectValue: 0.2,
    duration: 0,
    description: '当前科技研究进度 +20%',
  },
  {
    id: 'gift_box',
    name: '礼包掉落',
    probability: 0.004,
    effectType: 'gold_bonus',
    effectValue: 30,
    duration: 0,
    description: '随机获得 10-50 金币',
  },
  {
    id: 'double_intimacy',
    name: '双倍亲密度',
    probability: 0.002,
    effectType: 'intimacy_mult',
    effectValue: 2.0,
    duration: 60,
    description: '所有互动亲密度 ×2',
  },
];

export class EventSystem {
  private state: GameState;
  private lastEventTime = 0;
  private minEventInterval = 30; // 最短间隔（秒）

  constructor(state: GameState) {
    this.state = state;
  }

  // ==================== Tick（每秒） ====================

  tick(deltaSeconds: number): void {
    const now = Date.now();
    if ((now - this.lastEventTime) / 1000 < this.minEventInterval) return;

    for (const template of EVENT_TEMPLATES) {
      if (Math.random() < template.probability) {
        this.triggerEvent(template);
        this.lastEventTime = now;
        break; // 每次 tick 最多触发一个事件
      }
    }

    // 检查过期事件
    this.checkExpiredEvents();
  }

  // ==================== 触发事件 ====================

  private triggerEvent(template: EventTemplate): void {
    // 瞬时效果
    switch (template.effectType) {
      case 'gold_bonus': {
        const amount = Math.floor(template.effectValue * (0.5 + Math.random()));
        this.state.resources.gold += amount;
        break;
      }
      case 'parts_mult': {
        // 在下一次零件获取时应用（需在 OrderSystem 中检查 activeEvents）
        break;
      }
      case 'order_mult': {
        // 在下一次生成订单时应用
        break;
      }
      case 'tech_boost': {
        // 简化为金币奖励
        this.state.resources.gold += 50;
        break;
      }
    }

    // 持续效果
    if (template.duration > 0) {
      this.state.activeEvents.push({
        id: template.id,
        effectType: template.effectType,
        value: template.effectValue,
        remainingTime: template.duration,
        totalDuration: template.duration,
      });
    }

    EventBus.emit(GameEvent.RANDOM_EVENT_TRIGGERED, {
      id: template.id,
      name: template.name,
      description: template.description,
      duration: template.duration,
    });
  }

  // ==================== 过期检查 ====================

  private checkExpiredEvents(): void {
    for (let i = this.state.activeEvents.length - 1; i >= 0; i--) {
      this.state.activeEvents[i].remainingTime--;
      if (this.state.activeEvents[i].remainingTime <= 0) {
        const expired = this.state.activeEvents.splice(i, 1)[0];
        EventBus.emit(GameEvent.RANDOM_EVENT_EXPIRED, expired.id);
      }
    }
  }

  // ==================== 查询 ====================

  /**
   * 获取当前活跃事件的倍率
   */
  getActiveMultiplier(effectType: string): number {
    let mult = 1.0;
    for (const event of this.state.activeEvents) {
      if (event.effectType === effectType) {
        mult *= event.value;
      }
    }
    return mult;
  }

  getActiveEvents(): ActiveEvent[] {
    return [...this.state.activeEvents];
  }

  /**
   * 检查是否有特定类型的事件活跃
   */
  hasActiveEvent(effectType: string): boolean {
    return this.state.activeEvents.some(e => e.effectType === effectType);
  }
}
