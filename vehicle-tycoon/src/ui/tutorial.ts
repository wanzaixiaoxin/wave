// ============================================================
// 新手引导 — 任务式 5 步：高亮真实按钮，等待玩家真实操作才推进
// 第 1-2 步为上手教学；第 3-5 步为「长期目标」轻量指引（不阻塞、不催玩家）
// localStorage 记录完成状态（key 沿用 v2，已完成教程的老玩家不被打断）
// ============================================================

import { EventBus } from '../core/EventBus';
import { GameEvent, GameState, Quality, qualityRank } from '../core/types';
import { getState } from './context';

interface TutorialStep {
  title: string;
  desc: string;
  /** 需要高亮的元素选择器（null = 不高亮） */
  target: string | null;
  /** 推进到下一步的触发事件（null = 只能手动点按钮） */
  advanceOn: GameEvent | null;
  /** 是否显示「下一步」按钮（用于可选操作步骤） */
  manual: boolean;
  /** 长期目标步骤：轻量样式，弱存在感，不催玩家 */
  longterm?: boolean;
  /** 已达成判定：用于跳过存档中已完成的步骤 + 事件触发时二次确认 */
  doneCheck?: (s: GameState) => boolean;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: '🚗 造你的第一辆车',
    desc: '点击上方高亮的「🔧 制造」按钮，造一辆独轮车！\n\n💡 独轮车只要 10🪙，你正好有 200🪙',
    target: '#btn-build',
    advanceOn: GameEvent.VEHICLE_PRODUCED,
    manual: false,
  },
  {
    title: '📮 派它去跑订单',
    desc: '订单会自动刷新（等几秒）。出现后点击订单上的「🚗 派车」，车就会出去赚钱！\n\n赚到的 🪙 可以造更好的车、研究🔬科技解锁新车型',
    target: '#orders',
    advanceOn: GameEvent.ORDER_ASSIGNED,
    manual: false,
  },
  // ---- 以下为中期长期目标：玩家可能很久才达成，样式弱化、不阻塞游戏 ----
  {
    title: '⬆ 给车升级一次规格',
    desc: '点开车辆详情 →「⬆ 升级规格」（经济型→标准型需要 10 单 + 500🪙 + 20⚙️）\n\n长期目标，跑单攒钱时顺手做就好',
    target: '#garage',
    advanceOn: GameEvent.QUALITY_UPGRADED,
    manual: false,
    longterm: true,
    doneCheck: s => s.garage.vehicles.some(v => qualityRank(v.quality) >= qualityRank(Quality.Blue)),
  },
  {
    title: '🎯 给标准型车选一个运营配置',
    desc: '标准型及以上车辆在详情页可三选一运营配置（⚡快运 / 💪重载 / 🛡️耐用），永久生效\n\n选适合它跑单风格的就好',
    target: '#garage',
    advanceOn: GameEvent.VEHICLE_STATS_CHANGED, // 运营配置/属性升级都会发此事件，靠 doneCheck 二次确认
    manual: false,
    longterm: true,
    doneCheck: s => s.garage.vehicles.some(v => v.specialization !== null),
  },
  {
    title: '🔬 研究一次科技',
    desc: '点底部「🔬 科技」标签，研究主线科技解锁新车型\n\nL2「内燃机」需要先造 5 辆 T3 马车，慢慢攒',
    target: '[data-tab="tech"]',
    advanceOn: GameEvent.TECH_RESEARCHED,
    manual: false,
    longterm: true,
    doneCheck: s => s.techTree.currentLevel >= 2,
  },
];

let tutorialStep = -1; // -1 = completed, 0+ = active step
const TUTORIAL_KEY = 'tutorial_done_v2';
let advanceHandler: (() => void) | null = null;
let advanceEvent: GameEvent | null = null; // 与 advanceHandler 配对记录，保证跳过/结束时能正确 off

export function startTutorial(): void {
  if (localStorage.getItem(TUTORIAL_KEY)) return;
  tutorialStep = 0;
  showTutorialStep(0);
}

export function resetTutorial(): void {
  localStorage.removeItem(TUTORIAL_KEY);
}

/** 教程是否进行中（💡提示条等 UI 用于避让，避免和引导打架） */
export function isTutorialActive(): boolean {
  return tutorialStep >= 0;
}

function showTutorialStep(step: number): void {
  clearStepHooks();

  // 跳过存档中已达成的步骤（如已有标准型车，则「升级规格」步直接跳过）
  while (step < TUTORIAL_STEPS.length) {
    const check = TUTORIAL_STEPS[step].doneCheck;
    if (check && check(getState())) { step++; continue; }
    break;
  }
  if (step >= TUTORIAL_STEPS.length) {
    finishTutorial();
    return;
  }
  tutorialStep = step;

  const overlay = document.getElementById('tutorial-overlay');
  const boxEl = document.getElementById('tutorial-box');
  const stepEl = document.getElementById('tutorial-step');
  const titleEl = document.getElementById('tutorial-title');
  const descEl = document.getElementById('tutorial-desc');
  const nextBtn = document.getElementById('tutorial-next');
  if (!overlay || !boxEl || !stepEl || !titleEl || !descEl || !nextBtn) return;

  const s = TUTORIAL_STEPS[step];
  stepEl.textContent = s.longterm
    ? `🎯 长期目标 · 第 ${step + 1} 步 / 共 ${TUTORIAL_STEPS.length} 步`
    : `第 ${step + 1} 步 / 共 ${TUTORIAL_STEPS.length} 步`;
  titleEl.textContent = s.title;
  descEl.innerHTML = s.desc.replace(/\n/g, '<br>');
  nextBtn.style.display = s.manual ? '' : 'none';
  boxEl.classList.toggle('longterm', !!s.longterm);
  overlay.classList.add('visible');

  // 高亮目标元素
  if (s.target) {
    document.querySelector(s.target)?.classList.add('tutorial-highlight');
  }

  // 等待玩家真实操作推进（用 on/off 而非 once，保证跳过/换步时能正确移除）
  if (s.advanceOn) {
    const event = s.advanceOn;
    advanceEvent = event;
    advanceHandler = () => {
      // 二次确认：事件来源多样（如属性升级与选运营配置同事件），未真正达成则继续等
      if (s.doneCheck && !s.doneCheck(getState())) return;
      EventBus.off(event, advanceHandler!);
      advanceHandler = null;
      advanceEvent = null;
      nextTutorialStep();
    };
    EventBus.on(event, advanceHandler);
  }
}

function nextTutorialStep(): void {
  showTutorialStep(tutorialStep + 1);
}

function finishTutorial(): void {
  tutorialStep = -1;
  clearStepHooks();
  localStorage.setItem(TUTORIAL_KEY, '1');
  document.getElementById('tutorial-overlay')?.classList.remove('visible');
}

/**
 * 清除当前步骤的高亮与事件监听
 */
function clearStepHooks(): void {
  document.querySelectorAll('.tutorial-highlight').forEach(el => {
    el.classList.remove('tutorial-highlight');
  });
  if (advanceHandler && advanceEvent) {
    EventBus.off(advanceEvent, advanceHandler);
  }
  advanceHandler = null;
  advanceEvent = null;
}

/**
 * 绑定引导相关按钮事件（在 init 时调用一次）
 */
export function bindTutorial(): void {
  document.getElementById('tutorial-next')?.addEventListener('click', nextTutorialStep);
  document.getElementById('tutorial-skip')?.addEventListener('click', finishTutorial);
}
