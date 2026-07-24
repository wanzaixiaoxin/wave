// ============================================================
// 面板 UI — 顶栏 HUD、工厂、科技树、成就、造车下拉
// ============================================================

import { getState, getSystems, requestRender } from './context';
import { getUnlockedConfigs } from '../config/VehicleConfig';
import { TECH_CONFIGS } from '../config/TechConfig';
import { showToast } from './toast';
import { addLog } from './log';

// ==================== 顶栏 ====================

export function renderTopBar(): void {
  const s = getState();
  document.getElementById('gold')!.textContent = s.resources.gold.toLocaleString();
  document.getElementById('parts')!.textContent = Math.floor(s.resources.parts).toLocaleString();
  document.getElementById('intimacy-sum')!.textContent =
    s.garage.vehicles.reduce((sum, v) => sum + v.intimacy, 0).toString();

  const highestTier = s.garage.vehicles.length > 0
    ? Math.max(...s.garage.vehicles.map(v => v.tier)) : 1;
  const emojis = ['', '🛴', '🚲', '🐴', '🚗', '🚛', '🚂', '🚢', '✈️', '🚀', '🛸'];
  document.getElementById('tier-label')!.textContent = `${emojis[highestTier] || '🛴'} T${highestTier}`;

  const ec = getSystems().economySys;
  document.getElementById('eps')!.textContent = `${ec.getEstimatedEPS()}/s`;
}

export function updateStatusIcons(): void {
  const s = getState();
  const idle = s.garage.vehicles.filter(v => v.status === 'idle').length;
  const busy = s.garage.vehicles.filter(v => v.status === 'on_order').length;
  const container = document.getElementById('vehicle-status-icons');
  if (container) {
    container.innerHTML =
      `<span class="status-icon" title="空闲车辆">🟢${idle}</span>` +
      `<span class="status-icon" title="派单中">🚚${busy}</span>`;
  }
}

// ==================== 造车下拉 ====================

export function buildTierOptions(): void {
  const select = document.getElementById('build-tier-select') as HTMLSelectElement;
  if (!select) return;

  const prevValue = select.value; // 重建后恢复选中项，避免刷新把选择冲掉
  select.innerHTML = '';

  const s = getState();
  const unlocked = getUnlockedConfigs(s.techTree.currentLevel, s.techTree.producedCount);
  unlocked.forEach(cfg => {
    const opt = document.createElement('option');
    opt.value = cfg.tier.toString();
    const partsStr = cfg.partsCost > 0 ? ` + ${cfg.partsCost}⚙️` : '';
    opt.textContent = `${cfg.emoji} ${cfg.name} (${cfg.buildCost.toLocaleString()}🪙${partsStr})`;
    select.appendChild(opt);
  });

  if (prevValue && Array.from(select.options).some(o => o.value === prevValue)) {
    select.value = prevValue;
  }
}

// ==================== 工厂 ====================

export function renderFactory(): void {
  const s = getState();
  const fs = getSystems().factorySys;
  document.getElementById('factory-level')!.textContent = s.factory.level.toString();
  document.getElementById('factory-pps')!.textContent = fs.getPartsPerSecond().toFixed(2);
  document.getElementById('factory-lines-count')!.textContent = fs.getLineCount().toString();
  const cost = fs.getUpgradeCost();
  const costEl = document.getElementById('factory-upgrade-cost');
  if (costEl) {
    costEl.textContent = cost > 0 ? cost.toLocaleString() : 'MAX';
  }
}

// ==================== 科技树（从 TechConfig 读取，不再硬编码） ====================

const TECH_EMOJIS = ['', '🔧', '🔥', '⚡', '🌍', '🚀'];

export function renderTech(): void {
  const container = document.getElementById('tech-tree')!;
  container.innerHTML = '';

  const s = getState();
  const sys = getSystems().techSys;
  const next = sys.getNextResearchable();

  for (const cfg of TECH_CONFIGS) {
    const i = cfg.level;
    const researched = s.techTree.isResearched[i - 1];
    const isCurrent = i === s.techTree.currentLevel + 1;
    const name = `${TECH_EMOJIS[i] || '🔬'} ${cfg.name}`;
    const costText = cfg.partsCost > 0
      ? `${cfg.goldCost.toLocaleString()}🪙 + ${cfg.partsCost}⚙️`
      : `${cfg.goldCost.toLocaleString()}🪙`;

    const div = document.createElement('div');
    div.className = 'tech-node';
    div.classList.add(researched ? 'researched' : isCurrent && next?.canAfford && next?.conditionMet ? 'available' : 'locked');

    let rightContent = '';
    if (researched) {
      rightContent = '✅ 已完成';
    } else if (isCurrent && next) {
      if (next.canAfford && next.conditionMet) {
        rightContent = `<button class="research-btn">🔬 研究</button>`;
      } else {
        const reasons: string[] = [];
        if (!next.conditionMet) reasons.push(cfg.unlockCondition);
        if (!next.canAfford) reasons.push(costText);
        rightContent = `<span style="font-size:11px;color:#e94560;">❌ ${reasons.join(' ')}</span>`;
      }
    } else {
      rightContent = '🔒 未解锁';
    }

    div.innerHTML = `<span class="name">${name}</span><span class="cost">${rightContent}</span>`;

    if (isCurrent && next?.canAfford && next?.conditionMet) {
      div.onclick = () => {
        if (sys.researchNext()) {
          showToast('🔬 研究完成', `${name} — 新车型已解锁！`);
          addLog(`🔬 ${name} 研究完成！`);
        }
        requestRender();
      };
    }

    container.appendChild(div);
  }
}

// ==================== 成就 ====================

export function renderAchievements(): void {
  const s = getState();
  const unlocked = s.achievements.filter(a => a.isUnlocked).length;
  document.getElementById('achieve-count')!.textContent = unlocked.toString();
  document.getElementById('achieve-total')!.textContent = s.achievements.length.toString();

  const container = document.getElementById('achieve-list')!;
  container.innerHTML = '';
  const sys = getSystems().achievementSys;
  s.achievements.forEach(a => {
    const div = document.createElement('div');
    div.style.cssText = 'padding:6px 10px;margin:4px 0;background:#0f3460;border-radius:6px;display:flex;justify-content:space-between;align-items:center;';
    const progress = Math.floor(sys.getProgress(a.id) * 100);
    div.innerHTML = `
      <span>${a.isUnlocked ? '✅' : '⬜'} ${a.name}</span>
      <span style="font-size:11px;color:#888;">${a.isUnlocked ? '✅ 已完成' : `${progress}%`}</span>
    `;
    container.appendChild(div);
  });
}
