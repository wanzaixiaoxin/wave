// ============================================================
// 视觉特效 — 金币飘字、暴击特效、金币弹跳
// ============================================================

export function showFloatingGold(amount: number, isCrit = false, x?: number, y?: number): void {
  const el = document.createElement('div');
  el.className = 'gold-float';
  el.textContent = `+${amount}🪙`;
  if (isCrit) {
    el.style.fontSize = '36px';
    el.style.color = 'var(--orange)';
    el.textContent = `💥 +${amount}🪙`;
  }
  if (x !== undefined && y !== undefined) {
    // 指定坐标（如车辆卡片中心）：收益在「车身」上跳，强化「这台车赚的」的感知
    // 动画 transform 会覆盖内联 transform，故先挂上再按实际尺寸反推 left/top 居中
    el.style.visibility = 'hidden';
    document.body.appendChild(el);
    el.style.left = `${x - el.offsetWidth / 2}px`;
    el.style.top = `${y - el.offsetHeight / 2}px`;
    el.style.visibility = '';
  } else {
    el.style.left = `${40 + Math.random() * 20}%`;
    el.style.top = '45%';
    document.body.appendChild(el);
  }
  setTimeout(() => el.remove(), 1300);
}

export function showCritEffect(mult: number): void {
  const el = document.createElement('div');
  el.className = 'crit-effect';
  el.textContent = `💥 暴击！×${mult}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

export function goldBounce(): void {
  const el = document.getElementById('gold');
  if (!el) return;
  el.classList.remove('gold-bounce');
  void el.offsetWidth; // 触发 reflow
  el.classList.add('gold-bounce');
}
