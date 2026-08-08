// ============================================================
// 园区地图 — 城区街道建筑徽标（实时状态）+ 点阵道路像素小车
// 建筑按钮结构在 index.html 静态声明，这里只更新徽标文本/class，
// 不重建 DOM（1Hz 渲染不打断悬停/点击，小车动画不重启）
// ============================================================

import { getState, getSystems } from './context';
import { showTab } from './tabs';
import { getCityPressureTier } from '../systems/CitySystem';
import { getVehicleConfig } from '../config/VehicleConfig';
import { OrderStatus, VehicleStatus } from '../core/types';

const PRESSURE_NAMES = ['畅通', '紧张', '拥堵', '瘫痪'] as const;

let lastCarSig = '';

/** 建筑点击 → 打开对应面板（tabs.ts 统一导航） */
export function initMap(): void {
  document.querySelectorAll<HTMLButtonElement>('.map-bld').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-map-tab');
      if (tab) showTab(tab);
    });
  });
}

export function renderMap(): void {
  const s = getState();
  const sys = getSystems();

  // 🏭 工厂：等级
  setBadge('map-badge-factory', `Lv.${s.factory.level}`);

  // ⚡ 电站：储能百分比（>90% 红警示 = 产能在浪费，提示去投基建/超负荷）
  const cap = sys.factorySys.getEnergyCapacity();
  const pct = cap > 0 ? Math.round((s.resources.energy / cap) * 100) : 0;
  setBadge('map-badge-power', `${pct}%`, pct >= 90);

  // 🔬 研究院：研究中项目 + 进度 / 空闲
  const techBadge = document.getElementById('map-badge-tech');
  if (techBadge) {
    const r = s.techTree.researching;
    if (r) {
      const label = r.kind === 'main' ? `主线 L${r.level}` : r.kind === 'side' ? '支线' : '子科技';
      const pctDone = Math.min(1, Math.max(0, 1 - (r.finishAt - Date.now()) / (r.totalTime * 1000)));
      techBadge.innerHTML = `${label} <span class="mini-bar"><i style="width:${Math.round(pctDone * 100)}%"></i></span>`;
    } else {
      techBadge.textContent = '空闲';
    }
  }

  // 🏛️ 市政厅：压力等级（徽章文字 + 建筑边框变色）
  const tier = getCityPressureTier(s);
  setBadge('map-badge-city', PRESSURE_NAMES[tier], tier >= 2);
  const cityBld = document.getElementById('map-bld-city');
  if (cityBld) {
    cityBld.classList.toggle('press-p1', tier === 1);
    cityBld.classList.toggle('press-p2', tier === 2);
    cityBld.classList.toggle('press-p3', tier === 3);
  }

  // 🏆 荣誉馆：已解锁/总数
  const unlocked = s.achievements.filter(a => a.isUnlocked).length;
  setBadge('map-badge-achievements', `${unlocked}/${s.achievements.length}`);

  // ---------- 建筑活状态：工厂冒烟=造车中 / 研究院亮灯=研究中 / 电站火花=储能顶格 ----------
  document.getElementById('map-bld-factory')?.classList.toggle('producing', s.garage.buildQueue.length > 0);
  document.getElementById('map-bld-tech')?.classList.toggle('researching', s.techTree.researching !== null);
  document.getElementById('map-bld-power')?.classList.toggle('overcharge', pct >= 90);

  // ---------- 点阵道路：真实运输可视化 ----------
  // 每辆在单车辆 = 道路上一辆车：去程右行(0→50%)、返程掉头(50→100%)，位置=订单进度
  // 元素按车辆 id 签名缓存（进出单才重建）；每次渲染只改 left/方向/进度条（transition 平滑）
  const enRoute = s.garage.vehicles.filter(v => v.status === VehicleStatus.OnOrder);
  const sig = enRoute.map(v => v.id).join('|') || 'ghost';
  const box = document.getElementById('map-cars');
  if (box && sig !== lastCarSig) {
    lastCarSig = sig;
    box.innerHTML = enRoute.length === 0
      ? '<span class="map-car drive-r" style="animation-duration:11s;">🛴</span>'
      : enRoute.map((v, i) => {
        const emoji = getVehicleConfig(v.tier)?.emoji ?? '🚗';
        return `<span class="map-car-live" data-vid="${v.id}" style="top:${i % 2 === 0 ? 1 : 12}px;left:5%;">${emoji}<span class="car-progress"><i style="width:0%"></i></span></span>`;
      }).join('');
  }
  if (box && enRoute.length > 0) {
    for (const v of enRoute) {
      const el = box.querySelector<HTMLElement>(`.map-car-live[data-vid="${v.id}"]`);
      if (!el) continue;
      const order = s.orders.find(o => o.assignedVehicleId === v.id && o.status === OrderStatus.InProgress);
      const start = order?.assignedAt ?? 0;
      const span = v.statusEndAt - start;
      const progress = span > 0 ? Math.min(1, Math.max(0, (Date.now() - start) / span)) : 0;
      const returning = progress >= 0.5;
      // 往返映射：去程 5%→88%，返程 88%→5%
      const pos = returning ? 88 - (progress - 0.5) * 2 * 83 : 5 + progress * 2 * 83;
      el.style.left = `${pos}%`;
      el.classList.toggle('return', returning);
      const bar = el.querySelector<HTMLElement>('.car-progress > i');
      if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
    }
  }
}

function setBadge(id: string, text: string, warn = false): void {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.textContent !== text) el.textContent = text;
  el.classList.toggle('warn', warn);
}
