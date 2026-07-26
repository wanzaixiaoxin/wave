// ============================================================
// 路上事件浮动卡片（M1）— 非模态：固定在右下角，无遮罩、不抢焦点
// 玩家可完全无视它继续操作；超时由 OrderSystem 走默认项兜底
// ============================================================

import { Order, Vehicle, EnRouteEventConfigEntry } from '../core/types';
import { GAME_CONSTANTS } from '../config/GameConstants';
import { getSystems } from './context';

// 同屏最多一张卡片（OrderSystem 已保证事件顺延，新事件到达时直接替换内容）
let cardEl: HTMLElement | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;

function clearCountdown(): void {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

/**
 * 滑出并移除当前卡片（决策完成 / 倒计时结束 / 被新事件替换时调用）
 */
export function dismissEnRouteCard(): void {
  clearCountdown();
  if (!cardEl) return;
  const el = cardEl;
  cardEl = null;
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 300);
}

/**
 * 显示路上事件浮动卡片：emoji+标题、一行描述、紧凑选项按钮、10s 倒计时细条
 * 倒计时结束卡片静默滑出（事件本体由 tick 超时兜底按默认项结算）
 */
export function showEnRouteEventCard(
  order: Order,
  vehicle: Vehicle,
  eventConfig: EnRouteEventConfigEntry
): void {
  // 新事件到达时旧卡片还在 → 直接替换（OrderSystem 保证同屏最多 1 个待决策事件）
  if (cardEl) {
    clearCountdown();
    cardEl.remove();
    cardEl = null;
  }
  const orderSys = getSystems().orderSys;

  const card = document.createElement('div');
  card.className = 'enroute-card';

  const title = document.createElement('div');
  title.className = 'enroute-card-title';
  title.textContent = `${eventConfig.emoji} ${eventConfig.name}`;
  card.appendChild(title);

  const desc = document.createElement('div');
  desc.className = 'enroute-card-desc';
  desc.textContent = `${vehicle.name} —— ${eventConfig.description}`;
  card.appendChild(desc);

  // 10 秒决策倒计时细条
  const countdown = document.createElement('div');
  countdown.className = 'enroute-card-countdown';
  const bar = document.createElement('div');
  bar.className = 'enroute-card-countdown-bar';
  countdown.appendChild(bar);
  card.appendChild(countdown);

  // 选项按钮（小号横排；不可选的置灰并注明原因，默认项保留标注）
  const choices = document.createElement('div');
  choices.className = 'enroute-card-choices';
  eventConfig.choices.forEach((choice, idx) => {
    const btn = document.createElement('button');
    btn.innerHTML =
      `<span class="enroute-card-choice-label">${choice.label}${choice.isDefault ? '（默认）' : ''}</span>` +
      `<span class="enroute-card-choice-summary">${choice.summary}</span>`;
    if (!orderSys.isEnRouteChoiceAvailable(choice, vehicle)) {
      btn.disabled = true;
      btn.title = choice.partsCost ? '零件不足' : `需耐久≥${choice.requiredDurability}`;
    }
    btn.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      // resolve 成功后由 EN_ROUTE_EVENT_RESOLVED 事件统一滑出卡片 + toast
      orderSys.resolveEnRouteEvent(order.id, idx);
    };
    choices.appendChild(btn);
  });
  card.appendChild(choices);

  document.body.appendChild(card);
  cardEl = card;

  // 倒计时驱动细条；结束静默滑出（默认项结算交给 OrderSystem tick 兜底）
  const windowMs = GAME_CONSTANTS.EN_ROUTE_DECISION_WINDOW * 1000;
  const startAt = Date.now();
  countdownTimer = setInterval(() => {
    const remain = windowMs - (Date.now() - startAt);
    if (remain <= 0) {
      dismissEnRouteCard();
      return;
    }
    bar.style.width = `${(remain / windowMs) * 100}%`;
  }, 100);
}
