// ============================================================
// 新手引导 — 4 步遮罩教程，localStorage 记录完成状态
// ============================================================

const TUTORIAL_STEPS = [
  {
    title: '🚗 造你的第一辆车',
    desc: '点击下方「🔧 制造」按钮，从独轮车开始你的运输帝国！\n\n💡 造车需要消耗金币，独轮车只要 5🪙，你正好有 200🪙',
  },
  {
    title: '✏️ 给它起个名字',
    desc: '新车出厂后，给它起个名字吧！这是属于你的第一辆车 ❤️',
  },
  {
    title: '📮 派它去跑订单',
    desc: '订单会自动刷新。点击订单上的「🚗 派车」，车就会出去赚钱！\n\n赚到的 🪙 可以用来造更好的车、研究科技',
  },
  {
    title: '🔬 升级解锁新车',
    desc: '赚够钱后去「🔬 科技」标签页研究内燃机，解锁小汽车！\n\n💡 科技的关联：车库≠工厂≠科技≠订单 四个模块协同运转',
  },
];

let tutorialStep = -1; // -1 = completed, 0+ = active step
const TUTORIAL_KEY = 'tutorial_done_v2';

export function startTutorial(): void {
  if (localStorage.getItem(TUTORIAL_KEY)) return;
  tutorialStep = 0;
  showTutorialStep(0);
}

export function resetTutorial(): void {
  localStorage.removeItem(TUTORIAL_KEY);
}

function showTutorialStep(step: number): void {
  if (step >= TUTORIAL_STEPS.length) {
    finishTutorial();
    return;
  }

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
  nextBtn.textContent = step < TUTORIAL_STEPS.length - 1 ? '下一步 →' : '开始游戏 🎮';
  overlay.classList.add('visible');
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
  localStorage.setItem(TUTORIAL_KEY, '1');
  document.getElementById('tutorial-overlay')?.classList.remove('visible');
}

/**
 * 绑定引导相关按钮/遮罩事件（在 init 时调用一次）
 */
export function bindTutorial(): void {
  document.getElementById('tutorial-next')?.addEventListener('click', nextTutorialStep);
  document.getElementById('tutorial-skip')?.addEventListener('click', finishTutorial);
  document.getElementById('tutorial-overlay')!.addEventListener('click', (e) => {
    if (e.target === e.currentTarget && tutorialStep >= 0) nextTutorialStep();
  });
}
