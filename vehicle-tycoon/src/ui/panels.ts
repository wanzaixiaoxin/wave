// ============================================================
// 面板 UI — 顶栏 HUD、工厂、科技树、成就、造车下拉
// ============================================================

import { getState, getSystems, requestRender } from './context';
import { getUnlockedConfigs } from '../config/VehicleConfig';
import { TECH_CONFIGS, SIDE_TECH_CONFIGS } from '../config/TechConfig';
import { GAME_CONSTANTS } from '../config/GameConstants';
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

  const poolEl = document.getElementById('inherit-pool');
  if (poolEl) poolEl.textContent = Math.floor(s.garage.inheritanceExp).toLocaleString();
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

  // 下一级收益预览（不含事件/超负荷临时加成）
  const nextEl = document.getElementById('factory-next-info');
  if (nextEl) {
    if (cost > 0) {
      const lines = GAME_CONSTANTS.FACTORY_LINES_AT_LEVEL;
      const nextLines = lines[Math.min(s.factory.level, lines.length - 1)];
      const nextMult = 1 + s.factory.level * GAME_CONSTANTS.FACTORY_RATE_GROWTH;
      const techBoost = s.techTree.currentLevel >= 3 ? 1 + GAME_CONSTANTS.TECH_SPEED_BOOST : 1.0;
      const nextPps = nextLines * GAME_CONSTANTS.FACTORY_BASE_RATE * nextMult * techBoost;
      nextEl.textContent = `下一级：${nextLines} 条产线 · ${nextPps.toFixed(2)}⚙️/秒`;
    } else {
      nextEl.textContent = '🏭 工厂已满级';
    }
  }

  // 超负荷按钮状态（激活倒计时 / 冷却倒计时 / 可用）
  const ocBtn = document.getElementById('btn-overclock') as HTMLButtonElement | null;
  if (ocBtn) {
    const oc = fs.getOverclockState();
    if (oc.active > 0) {
      ocBtn.textContent = `⚡ 超负荷中 ${Math.ceil(oc.active)}s`;
      ocBtn.disabled = true;
    } else if (oc.cooldown > 0) {
      ocBtn.textContent = `⏳ 冷却 ${Math.ceil(oc.cooldown)}s`;
      ocBtn.disabled = true;
    } else {
      ocBtn.textContent = `⚡ 超负荷 ×${GAME_CONSTANTS.FACTORY_OVERCLOCK_MULT} (${GAME_CONSTANTS.FACTORY_OVERCLOCK_DURATION}s)`;
      ocBtn.disabled = false;
    }
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
        rightContent = `<span style="font-size:11px;color:var(--red);">❌ ${reasons.join(' ')}</span>`;
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

  // ---------- 辅助科技（支线，独立研究，永久被动） ----------
  const sideContainer = document.getElementById('side-tech-tree');
  if (sideContainer) {
    sideContainer.innerHTML = '';
    for (const cfg of SIDE_TECH_CONFIGS) {
      const st = sys.getSideTechState(cfg.id);
      const costText = `${cfg.goldCost.toLocaleString()}🪙 + ${cfg.partsCost}⚙️`;

      const div = document.createElement('div');
      div.className = 'tech-node';
      div.classList.add(st.researched ? 'researched' : st.levelMet && st.canAfford ? 'available' : 'locked');

      let right = '';
      if (st.researched) {
        right = '✅ 已完成';
      } else if (!st.levelMet) {
        right = `<span style="font-size:11px;color:var(--text-3);">🔒 需要科技 Lv.${cfg.requiredLevel}</span>`;
      } else if (st.canAfford) {
        right = `<button class="research-btn">🧪 研究</button>`;
      } else {
        right = `<span style="font-size:11px;color:var(--red);">❌ ${costText}</span>`;
      }

      div.innerHTML = `<span class="name">${cfg.name}<span style="display:block;font-size:10px;color:var(--text-3);font-weight:600;">${cfg.description}</span></span><span class="cost">${right}</span>`;

      if (!st.researched && st.levelMet && st.canAfford) {
        div.onclick = () => {
          if (sys.researchSideTech(cfg.id)) {
            showToast('🧪 辅助科技完成', `${cfg.name} — ${cfg.effect}`);
            addLog(`🧪 辅助科技「${cfg.name}」研究完成（${cfg.effect}）`);
          }
          requestRender();
        };
      }

      sideContainer.appendChild(div);
    }
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
    div.className = 'achieve-item';
    const progress = Math.floor(sys.getProgress(a.id) * 100);
    const rewardText = [
      a.reward.gold ? `${a.reward.gold.toLocaleString()}🪙` : '',
      a.reward.parts ? `${a.reward.parts}⚙️` : '',
      a.reward.title ? `称号「${a.reward.title}」` : '',
      a.reward.skin ? `皮肤「${a.reward.skin}」` : '',
    ].filter(Boolean).join(' ');
    div.innerHTML = `
      <div>
        <div style="font-weight:800;">${a.isUnlocked ? '✅' : '⬜'} ${a.name}</div>
        <div style="font-size:10px;color:var(--text-3);font-weight:600;margin-top:2px;">${a.description}${rewardText ? ` · 🎁 ${rewardText}` : ''}</div>
      </div>
      <span style="font-size:11px;color:var(--text-3);white-space:nowrap;margin-left:8px;">${a.isUnlocked ? '✅' : `${progress}%`}</span>
    `;
    container.appendChild(div);
  });
}
