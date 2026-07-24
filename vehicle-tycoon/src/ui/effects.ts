// ============================================================
// 视觉特效 — 金币飘字、暴击特效、金币弹跳
// ============================================================

export function showFloatingGold(amount: number, isCrit = false): void {
  const el = document.createElement('div');
  el.className = 'gold-float';
  el.textContent = `+${amount}🪙`;
  el.style.left = `${40 + Math.random() * 20}%`;
  el.style.top = '45%';
  if (isCrit) {
    el.style.fontSize = '36px';
    el.style.color = '#e94560';
    el.textContent = `💥 +${amount}🪙`;
  }
  document.body.appendChild(el);
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
