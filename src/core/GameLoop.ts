// ============================================================
// 游戏主循环 — 驱动所有系统的 tick
// ============================================================

import { EventBus } from './EventBus';
import { GameEvent, GameState } from './types';
import { VehicleSystem } from '../systems/VehicleSystem';
import { OrderSystem } from '../systems/OrderSystem';
import { FactorySystem } from '../systems/FactorySystem';
import { TechSystem } from '../systems/TechSystem';
import { EconomySystem } from '../systems/EconomySystem';
import { IntimacySystem } from '../systems/IntimacySystem';
import { AchievementSystem } from '../systems/AchievementSystem';
import { EventSystem } from '../systems/EventSystem';
import { SaveManager } from './SaveManager';

export class GameLoop {
  private economyTickInterval: ReturnType<typeof setInterval> | null = null;
  private renderLoopId: number | null = null;
  private state: GameState;
  private isRunning = false;
  private lastTickTime = 0;
  private accumulatedTime = 0;

  // 系统引用
  private vehicleSys!: VehicleSystem;
  private orderSys!: OrderSystem;
  private factorySys!: FactorySystem;
  private techSys!: TechSystem;
  private economySys!: EconomySystem;
  private intimacySys!: IntimacySystem;
  private achievementSys!: AchievementSystem;
  private eventSys!: EventSystem;

  constructor(state: GameState) {
    this.state = state;
    this.initSystems();
  }

  private initSystems(): void {
    this.vehicleSys = new VehicleSystem(this.state);
    this.orderSys = new OrderSystem(this.state);
    this.factorySys = new FactorySystem(this.state);
    this.techSys = new TechSystem(this.state);
    this.economySys = new EconomySystem(this.state);
    this.intimacySys = new IntimacySystem(this.state);
    this.achievementSys = new AchievementSystem(this.state);
    this.eventSys = new EventSystem(this.state);
  }

  // ==================== 启动/停止 ====================

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTickTime = Date.now();

    // 经济 tick：每秒一次
    this.economyTickInterval = setInterval(() => this.economyTick(), 1000);

    // 渲染循环：60fps
    this.renderLoop();

    // 自动存档
    SaveManager.startAutoSave(() => this.state, 30);

    console.log('[GameLoop] Started');
  }

  stop(): void {
    this.isRunning = false;

    if (this.economyTickInterval) {
      clearInterval(this.economyTickInterval);
      this.economyTickInterval = null;
    }
    if (this.renderLoopId) {
      cancelAnimationFrame(this.renderLoopId);
      this.renderLoopId = null;
    }

    SaveManager.stopAutoSave();
    // 停止时保存
    SaveManager.save(this.state);

    console.log('[GameLoop] Stopped');
  }

  // ==================== Economy Tick (1Hz) ====================

  private economyTick(): void {
    if (!this.isRunning) return;
    const now = Date.now();
    const deltaMs = now - this.lastTickTime;
    this.lastTickTime = now;

    // 累加总游戏时间
    this.state.stats.totalPlayTime += 1;

    // 按顺序执行各系统 tick
    this.factorySys.tick(1);           // 产线生产
    this.orderSys.tick(1);             // 订单倒计时
    this.vehicleSys.tick(1);           // 车辆状态更新
    this.eventSys.tick(1);             // 随机事件判定
    this.achievementSys.tick();        // 成就判定

    // 发射全局 tick 事件（给 UI 层更新用）
    EventBus.emit(GameEvent.GAME_TICK, deltaMs);
  }

  // ==================== Render Loop (60fps) ====================

  private renderLoop(): void {
    if (!this.isRunning) return;

    // 这里在实际 Cocos Creator 中由引擎驱动
    // 当前架构预留渲染循环入口
    // UIManager.update(deltaTime);

    this.renderLoopId = requestAnimationFrame(() => this.renderLoop());
  }

  // ==================== 离线处理 ====================

  handleOfflineReturn(offlineSeconds: number): void {
    const result = SaveManager.calculateOfflineEarnings(this.state.factory, offlineSeconds);
    SaveManager.applyOfflineEarnings(this.state, result);
  }

  // ==================== 状态访问 ====================

  getState(): GameState {
    return this.state;
  }

  getSystems(): {
    vehicleSys: VehicleSystem;
    orderSys: OrderSystem;
    factorySys: FactorySystem;
    techSys: TechSystem;
    economySys: EconomySystem;
    intimacySys: IntimacySystem;
    achievementSys: AchievementSystem;
    eventSys: EventSystem;
  } {
    return {
      vehicleSys: this.vehicleSys,
      orderSys: this.orderSys,
      factorySys: this.factorySys,
      techSys: this.techSys,
      economySys: this.economySys,
      intimacySys: this.intimacySys,
      achievementSys: this.achievementSys,
      eventSys: this.eventSys,
    };
  }
}
