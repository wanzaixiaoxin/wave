// ============================================================
// 事件总线 — 全局解耦通信
// 所有系统通过 EventBus 通信，禁止直接引用其他系统
// ============================================================

import { GameEvent } from './types';

type Callback = (...args: unknown[]) => void;

export class EventBus {
  private static listeners: Map<string, Set<Callback>> = new Map();
  private static history: Array<{ event: string; args: unknown[]; timestamp: number }> = [];
  private static readonly MAX_HISTORY = 100;
  private static enabled = true;

  /**
   * 注册事件监听
   */
  static on(event: GameEvent | string, callback: Callback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  /**
   * 移除事件监听
   */
  static off(event: GameEvent | string, callback: Callback): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(callback);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * 触发事件
   */
  static emit(event: GameEvent | string, ...args: unknown[]): void {
    if (!this.enabled) return;

    // 记录历史（调试用）
    if (this.history.length >= this.MAX_HISTORY) {
      this.history.shift();
    }
    this.history.push({ event, args, timestamp: Date.now() });

    // 通知监听者
    const set = this.listeners.get(event);
    if (set) {
      set.forEach(cb => {
        try {
          cb(...args);
        } catch (err) {
          console.error(`[EventBus] Error in handler for "${event}":`, err);
        }
      });
    }
  }

  /**
   * 一次性监听
   */
  static once(event: GameEvent | string, callback: Callback): void {
    const wrapper = (...args: unknown[]) => {
      this.off(event, wrapper);
      callback(...args);
    };
    this.on(event, wrapper);
  }

  /**
   * 清除指定事件的所有监听
   */
  static clear(event: GameEvent | string): void {
    this.listeners.delete(event);
  }

  /**
   * 清除所有监听（用于场景销毁/重置）
   */
  static clearAll(): void {
    this.listeners.clear();
  }

  /**
   * 启用/禁用事件总线（用于测试或紧急停止）
   */
  static setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 获取事件历史（调试用）
   */
  static getHistory(): Array<{ event: string; args: unknown[]; timestamp: number }> {
    return [...this.history];
  }
}
