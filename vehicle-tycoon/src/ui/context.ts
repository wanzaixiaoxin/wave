// ============================================================
// UI 上下文 — 持有 GameLoop 引用与渲染调度，供各 UI 模块共享
// ============================================================

import type { GameLoop } from '../core/GameLoop';
import type { GameState } from '../core/types';

let gameLoop: GameLoop | null = null;
let renderFn: () => void = () => {};
let renderScheduled = false;

export function setGameLoop(gl: GameLoop): void {
  gameLoop = gl;
}

export function getGameLoop(): GameLoop {
  if (!gameLoop) throw new Error('[ui/context] GameLoop 尚未初始化');
  return gameLoop;
}

export function getState(): GameState {
  return getGameLoop().getState();
}

export function getSystems(): ReturnType<GameLoop['getSystems']> {
  return getGameLoop().getSystems();
}

/**
 * 注册全局渲染函数（由 main.ts 注入）
 */
export function setRenderFn(fn: () => void): void {
  renderFn = fn;
}

/**
 * 请求渲染：同一帧内多次调用只渲染一次（rAF 合并）
 */
export function requestRender(): void {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    renderFn();
  });
}
