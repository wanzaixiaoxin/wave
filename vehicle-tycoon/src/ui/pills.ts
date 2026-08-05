// ============================================================
// 胶囊选择器 — 直接点击选择的紧凑控件（造车 / 派车 / 置换共用）
// 相比下拉列表：零展开步骤、不占用额外区域、移动端触控友好
// 点击后自动重绘刷新选中态；禁用项点击弹 toast 说明原因
// ============================================================

import { showToast } from './toast';

export interface PillOption {
  value: string;
  emoji: string;        // 主图标（车型 / 车辆 + 规格色点）
  label: string;        // 名称（悬停提示主标题）
  hint?: string;        // 附加详情（悬停提示，成本/耗时等）
  badge?: string;       // 右上角小角标（🔒 / ×N）
  disabled?: boolean;
  lockedHint?: string;  // 点击禁用项时的 toast 原因
  customClick?: () => void; // 覆盖默认点击行为（自行负责重绘，如组内循环切换）
}

/**
 * 渲染胶囊行；点击选中项自动重绘以刷新高亮，并回调 onSelect
 */
export function renderPills(
  container: HTMLElement,
  options: PillOption[],
  selected: string | null,
  onSelect: (value: string) => void,
): void {
  container.innerHTML = '';
  container.className = 'pill-row';

  for (const o of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill'
      + (o.disabled ? ' disabled' : '')
      + (o.value === selected ? ' selected' : '');
    btn.textContent = o.emoji;
    btn.title = o.disabled && o.lockedHint
      ? `${o.label} · ${o.lockedHint}`
      : `${o.label}${o.hint ? ' · ' + o.hint : ''}`;
    if (o.badge) {
      const b = document.createElement('span');
      b.className = 'pill-badge';
      b.textContent = o.badge;
      btn.appendChild(b);
    }
    btn.addEventListener('click', () => {
      if (o.disabled) {
        if (o.lockedHint) showToast('🔒 未解锁', o.lockedHint);
        return;
      }
      if (o.customClick) {
        o.customClick();
        return;
      }
      if (o.value !== selected) {
        onSelect(o.value);
        renderPills(container, options, o.value, onSelect);
      }
    });
    container.appendChild(btn);
  }
}
