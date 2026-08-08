// ============================================================
// S4 城市面板 — 需求/积压/繁荣状态卡 + 基建项目（分批捐赠消耗点）
// 结构一次性构建，渲染只更新文本/进度（按钮不重建，1Hz 刷新不打断点击）
// ============================================================

import { getState, getSystems, requestRender } from './context';
import { CITY_PROJECTS } from '../config/CityConfig';
import {
  getNominalDemandRate, getEffectiveDemandRate, getCityPressureTier,
  getCitySoftK, getCityIncomeMult,
} from '../systems/CitySystem';
import { GAME_CONSTANTS } from '../config/GameConstants';
import { showToast } from './toast';
import { addLog } from './log';

const PRESSURE = [
  { label: '畅通', cls: 'p0', desc: '城市运输畅通，繁荣持续累积' },
  { label: '紧张', cls: 'p1', desc: '客户压价：订单单价 ×0.9' },
  { label: '拥堵', cls: 'p2', desc: '堵车：耗时 ×1.2 · 信誉持续流失' },
  { label: '瘫痪边缘', cls: 'p3', desc: '订单槽 -1 · 单价再 ×0.9 · 繁荣倒退' },
] as const;

/** 大数字简写（与城市面板同屏的工厂面板口径一致：1234→1.2k） */
function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return `${Math.floor(n)}`;
}

let built = false;
let lastProjectSig = '';
let lastCrateCount = -1;

function buildSkeleton(): void {
  const panel = document.getElementById('panel-city')!;
  panel.innerHTML = `
    <div class="section-title">🏙️ 城市运输 · <span id="city-pressure-badge" class="pressure-badge p0">畅通</span></div>
    <div class="scene" id="city-scene">
      <span class="scene-label">城市天际线</span>
      <div class="scene-skyline" id="scene-skyline"></div>
      <div class="scene-crates" id="scene-crates"></div>
      <div class="scene-city-info" id="scene-city-info"></div>
    </div>
    <div id="city-status"></div>
    <div class="section-title" style="margin-top:12px;">🏗️ 城市基建 <span style="font-weight:400;font-size:10px;color:var(--text-3);">每批投入存量 25%，投满建成，永久生效</span></div>
    <div id="city-projects"></div>
    <p style="font-size:11px;color:var(--text-3);font-weight:600;margin-top:8px;">
      💡 城市经济持续发展，运输需求不断增长。车队交付跟不上就会积压：紧张压价 → 拥堵耗时 → 瘫痪减单。
      扩车队、升级车型、投基建把积压打下去——保持畅通，城市繁荣会给你稳定的收入加成。
    </p>
  `;
  built = true;
}

export function renderCity(): void {
  if (!built) buildSkeleton();
  const s = getState();
  const citySys = getSystems().citySys;
  const city = s.city;
  const tier = getCityPressureTier(s);
  const p = PRESSURE[tier];

  // ---------- 状态卡 ----------
  const nominal = getNominalDemandRate(s);
  const effective = getEffectiveDemandRate(s);
  const softK = getCitySoftK(s);
  const incomeMult = getCityIncomeMult(s);
  const backlogPct = Math.min(100, (city.backlog / (GAME_CONSTANTS.CITY_PRESSURE_L3_K * softK)) * 100);
  const prosperPct = city.prosperity >= GAME_CONSTANTS.CITY_PROSPERITY_MAX_LEVEL
    ? 100 : (city.prosperityProgress / GAME_CONSTANTS.CITY_PROSPERITY_PROGRESS_NEED) * 100;

  const badge = document.getElementById('city-pressure-badge')!;
  badge.textContent = p.label;
  badge.className = `pressure-badge ${p.cls}`;

  // ---------- 天际线场景：楼宇高度=需求增速，亮灯楼=繁荣等级，货箱=积压 ----------
  const skyline = document.getElementById('scene-skyline');
  if (skyline && skyline.children.length === 0) {
    skyline.innerHTML = Array.from({ length: 5 }, () => '<div class="tower"></div>').join('');
  }
  if (skyline) {
    const litTowers = Math.round((city.prosperity / GAME_CONSTANTS.CITY_PROSPERITY_MAX_LEVEL) * 5);
    Array.from(skyline.children).forEach((t, i) => {
      const el = t as HTMLElement;
      // 每栋楼高度随名义需求增长（i 错层），12-52px
      el.style.height = `${Math.min(52, 12 + nominal / 5 + i * 4)}px`;
      el.classList.toggle('lit', i < litTowers);
    });
  }
  const crateCount = Math.min(8, Math.round((city.backlog / softK) * 4));
  if (crateCount !== lastCrateCount) {
    lastCrateCount = crateCount;
    const crates = document.getElementById('scene-crates');
    if (crates) crates.innerHTML = crateCount > 0 ? '<span class="crate">📦</span>'.repeat(crateCount) : '';
  }
  const cityInfo = document.getElementById('scene-city-info');
  if (cityInfo) cityInfo.innerHTML = `繁荣 Lv.${city.prosperity}<br>积压 ${fmt(city.backlog)}`;

  document.getElementById('city-status')!.innerHTML = `
    <div class="vd-row"><span>📦 运输需求（名义 / 有效）</span><b>${nominal.toFixed(1)} / ${effective.toFixed(1)} 单位/分</b></div>
    <div class="vd-row"><span>🚚 积压需求</span><b class="${tier >= 2 ? 'warn' : ''}">${fmt(city.backlog)} 单位（容忍度 ${fmt(softK)}）</b></div>
    <div class="vd-bar"><div class="${tier >= 2 ? 'city-bar-warn' : ''}" style="width:${backlogPct}%"></div></div>
    <div class="vd-row"><span>⚠️ 当前影响</span><b>${tier === 0 ? '无惩罚 · 繁荣累积中' : p.desc}</b></div>
    <div class="vd-row"><span>🌆 城市繁荣 Lv.${city.prosperity}${city.prosperity >= GAME_CONSTANTS.CITY_PROSPERITY_MAX_LEVEL ? '（满级）' : ''}</span><b class="${incomeMult >= 1 ? '' : 'warn'}">收入 ${incomeMult >= 1 ? '+' : ''}${Math.round((incomeMult - 1) * 100)}%</b></div>
    <div class="vd-bar"><div style="width:${prosperPct}%;background:var(--gold);"></div></div>
    <div class="vd-row"><span>🚛 累计交付</span><b>${fmt(city.deliveredTotal)} 单位</b></div>
  `;

  // ---------- 基建项目（签名缓存：只有投入/建成才重建，1Hz 刷新不打断点击） ----------
  const sig = JSON.stringify(s.city.projects);
  if (sig !== lastProjectSig) {
    lastProjectSig = sig;
    const box = document.getElementById('city-projects')!;
    box.innerHTML = '';
    for (const cfg of CITY_PROJECTS) {
    const prog = citySys.getProjectProgress(cfg.id);
    const node = document.createElement('div');
    node.className = `tech-node${prog.done ? ' researched' : ' available'}`;

    const costs: string[] = [];
    if (cfg.cost.gold) costs.push(`${fmt(prog.gold)}/${fmt(cfg.cost.gold)}🪙`);
    if (cfg.cost.parts) costs.push(`${fmt(prog.parts)}/${fmt(cfg.cost.parts)}⚙️`);
    if (cfg.cost.energy) costs.push(`${fmt(prog.energy)}/${fmt(cfg.cost.energy)}⚡`);
    if (cfg.cost.rep) costs.push(`${fmt(prog.rep)}/${fmt(cfg.cost.rep)}📈`);

    node.innerHTML = `
      <div style="flex:1;min-width:0;">
        <div class="name">${cfg.emoji} ${cfg.name}${prog.done ? ' ✅' : ''}</div>
        <div style="font-size:10px;color:var(--teal);font-weight:700;margin-top:1px;">${cfg.effectDesc}</div>
        <div style="font-size:10px;color:var(--text-3);font-weight:700;margin-top:1px;">${prog.done ? '已建成' : costs.join(' · ')}</div>
      </div>
    `;
    if (!prog.done) {
      const btn = document.createElement('button');
      btn.className = 'research-btn';
      btn.textContent = '投入一批';
      btn.title = '投入当前存量的 25%（不会掏空经营周转）';
      btn.style.animation = 'none';
      btn.onclick = () => {
        const r = getSystems().citySys.investProject(cfg.id);
        if (r.ok) {
          const after = getSystems().citySys.getProjectProgress(cfg.id);
          if (after.done) {
            showToast(`🏗️ ${cfg.name} 建成！`, cfg.effectDesc);
            addLog(`🏗️ ${cfg.emoji}${cfg.name} 建成：${cfg.effectDesc}`);
          } else {
            addLog(`🏗️ 向 ${cfg.emoji}${cfg.name} 投入了一批资源`);
          }
        } else {
          addLog(`❌ ${r.reason}`);
        }
        requestRender();
      };
      node.appendChild(btn);
    }
    box.appendChild(node);
    }
  }
}
