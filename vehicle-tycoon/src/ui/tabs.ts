// ============================================================
// 页签导航 — 底栏已移除，统一入口：园区建筑 / 提示条 / 返回园区按钮
// 切 Tab = 面板占据主区域；'garage' = 恢复园区主页（地图+停车场+货运站同屏）
// ============================================================

import { requestRender } from './context';

let currentTab = 'garage';

export function getCurrentTab(): string {
  return currentTab;
}

export function showTab(tab: string): void {
  currentTab = tab;
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('visible'));
  const home = document.getElementById('main-home');
  const panel = document.getElementById('panel-' + tab);
  const isPanel = !!panel;
  if (home) home.classList.toggle('hidden', isPanel);
  if (panel) panel.classList.add('visible');
  // 返回园区浮钮 + 园区建筑激活态（工厂/电站同开工厂面板，两栋都亮）
  const back = document.getElementById('btn-back-home');
  if (back) back.style.display = isPanel ? 'block' : 'none';
  document.querySelectorAll('.map-bld').forEach(b =>
    b.classList.toggle('active', isPanel && b.getAttribute('data-map-tab') === tab));
  requestRender();
}

/** 绑定「返回园区」浮钮（建筑点击在 map.ts initMap） */
export function initTabs(): void {
  document.getElementById('btn-back-home')?.addEventListener('click', () => showTab('garage'));
}
