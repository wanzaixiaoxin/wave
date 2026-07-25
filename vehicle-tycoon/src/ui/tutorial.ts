// ============================================================
// 新手引导 — 任务式 3 步：高亮真实按钮，等待玩家真实操作才推进
// localStorage 记录完成状态
// ============================================================

import { EventBus } from '../core/EventBus';
import { GameEvent } from '../core/types';

interface TutorialStep {
  title: string;
  desc: string;
  /** 需要高亮的元素选择器（null = 不高亮） */
  target: string | null;
  /** 推进到下一步的触发事件（null = 只能手动点按钮） */
  advanceOn: GameEvent | null;
  /** 是否显示「下一步」按钮（用于可选操作步骤） */
  manual: boolean;
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
];

let tutorialStep = -1; // -1 = completed, 0+ = active step
const TUTORIAL_KEY = 'tutorial_done_v2';
let advanceHandler: (() => void) | null = null;

export function startTutorial(): void {
  if (localStorage.getItem(TUTORIAL_KEY)) return;
  tutorialStep = 0;
  showTutorialStep(0);
}

export function resetTutorial(): void {
  localStorage.removeItem(TUTORIAL_KEY);
}

function showTutorialStep(step: number): void {
  clearStepHooks();

  const overlay = document.getElementById('tutorial-overlay');
  const stepEl = document.getElementById('tutorial-step');
  const titleEl = document.getElementById('tutorial-title');
  const descEl = document.getElementById('tutorial-desc');
  const nextBtn = document.getElementById('tutorial-next');
  if (!overlay || !stepEl || !titleEl || !descEl || !nextBtn) return;

  const s = TUTORIAL_STEPS[step];
  stepEl.textContent = `第 ${step + 1} 步 / 共 ${TUTORIAL_STEPS.length} 步`;
  titleEl.textContent = s.title;
  descEl.innerHTML = s.desc.replace(/\n/g, '<br>');
  nextBtn.style.display = s.manual ? '' : 'none';
  overlay.classList.add('visible');

  // 高亮目标元素
  if (s.target) {
    document.querySelector(s.target)?.classList.add('tutorial-highlight');
  }

  // 等待玩家真实操作推进（用 on/off 而非 once，保证跳过/换步时能正确移除）
  if (s.advanceOn) {
    const event = s.advanceOn;
    advanceHandler = () => {
      EventBus.off(event, advanceHandler!);
      advanceHandler = null;
      nextTutorialStep();
    };
    EventBus.on(event, advanceHandler);
  }
}

function nextTutorialStep(): void {
  tutorialStep++;
  if (tutorialStep >= TUTORIAL_STEPS.length) {
    finishTutorial();
  } else {
    showTutorialStep(tutorialStep);
  }
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
  if (advanceHandler) {
    const s = TUTORIAL_STEPS[tutorialStep];
    if (s?.advanceOn) EventBus.off(s.advanceOn, advanceHandler);
    advanceHandler = null;
  }
}

/**
 * 绑定引导相关按钮事件（在 init 时调用一次）
 */
export function bindTutorial(): void {
  document.getElementById('tutorial-next')?.addEventListener('click', nextTutorialStep);
  document.getElementById('tutorial-skip')?.addEventListener('click', finishTutorial);
}
