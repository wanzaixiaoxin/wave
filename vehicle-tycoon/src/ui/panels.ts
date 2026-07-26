// ============================================================
// 面板 UI — 顶栏 HUD、工厂、科技树、成就、造车下拉
// ============================================================

import { getState, getSystems, requestRender } from './context';
import { getUnlockedConfigs, getVehicleConfig } from '../config/VehicleConfig';
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

// ==================== 工作台（M7：建造进度条 + 队列 + 按钮禁用） ====================

export function renderWorkbench(): void {
  const s = getState();
  const queue = s.garage.buildQueue;
  const box = document.getElementById('build-status');
  const btn = document.getElementById('btn-build') as HTMLButtonElement | null;

  // 建造槽/队列满，或车位（含预留）满 → 禁用制造按钮
  const queueFull = queue.length >= 1 + GAME_CONSTANTS.BUILD_QUEUE_MAX;
  const reservedFull = s.garage.vehicles.length + queue.length >= s.garage.maxCapacity;
  if (btn) {
    btn.disabled = queueFull || reservedFull;
    btn.title = queueFull
      ? '建造队列已满，等造完再来'
      : reservedFull
        ? '车库已满（含建造中的车），请扩建或拆解'
        : '';
  }

  if (!box) return;
  if (queue.length === 0) {
    box.innerHTML = '';
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';

  // 建造槽：进度条 + 剩余秒数（finishAt 为真实时间戳，离线也正常走）
  const active = queue[0];
  const activeCfg = getVehicleConfig(active.tier);
  const remain = Math.max(0, Math.ceil((active.finishAt - Date.now()) / 1000));
  const pct = active.totalTime > 0
    ? Math.min(100, Math.round((1 - remain / active.totalTime) * 100))
    : 100;

  // 排队位：emoji + 各自耗时
  const waiting = queue.slice(1).map(j => {
    const c = getVehicleConfig(j.tier);
    return `<span class="build-queue-item">${c?.emoji ?? '🚗'} ${j.totalTime}s</span>`;
  }).join('');

  box.innerHTML = `
    <div class="build-active">
      <span>🔨 建造中 ${activeCfg?.emoji ?? ''} ${activeCfg?.name ?? 'T' + active.tier} · 剩余 ${remain}s</span>
      <span class="build-queue">${waiting ? `📋 排队 ${waiting}` : ''}</span>
    </div>
    <div class="build-progress"><div class="build-progress-bar" style="width:${pct}%"></div></div>
  `;
}

// ==================== 工厂 ====================

export function renderFactory(): void {
  const s = getState();
  const fs = getSystems().factorySys;
  document.getElementById('factory-level')!.textContent = s.factory.level.toString();
  document.getElementById('factory-pps')!.textContent = fs.getPartsPerSecond().toFixed(2);
  document.getElementById('factory-lines-count')!.textContent = fs.getLineCount().toString();

  // 进度系数（M7）：让玩家感知工厂随最高车型变强
  const tierEl = document.getElementById('factory-tier-bonus');
  if (tierEl) {
    tierEl.textContent = `🚀 进度加成 ×${fs.getTierScaling().toFixed(1)}（车库最高 T${fs.getTopTier()} · 每 tier +${GAME_CONSTANTS.FACTORY_TIER_SCALING * 100}%）`;
  }

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
      const nextPps = nextLines * GAME_CONSTANTS.FACTORY_BASE_RATE * nextMult * techBoost * fs.getTierScaling();
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
  const researching = s.techTree.researching;
  const researchRemain = researching
    ? Math.max(0, Math.ceil((researching.finishAt - Date.now()) / 1000))
    : 0;

  for (const cfg of TECH_CONFIGS) {
    const i = cfg.level;
    const researched = s.techTree.isResearched[i - 1];
    const isCurrent = i === s.techTree.currentLevel + 1;
    const isResearchingThis = researching?.kind === 'main' && researching.level === i;
    const name = `${TECH_EMOJIS[i] || '🔬'} ${cfg.name}`;
    const researchTime = GAME_CONSTANTS.RESEARCH_TIME_MAIN[i] ?? 60;
    const costText = cfg.partsCost > 0
      ? `${cfg.goldCost.toLocaleString()}🪙 + ${cfg.partsCost}⚙️ · ${researchTime}s`
      : `${cfg.goldCost.toLocaleString()}🪙 · ${researchTime}s`;

    const div = document.createElement('div');
    div.className = 'tech-node';
    div.classList.add(
      researched ? 'researched'
        : isResearchingThis || (isCurrent && next?.canAfford && next?.conditionMet) ? 'available'
          : 'locked'
    );

    let rightContent = '';
    if (researched) {
      rightContent = '✅ 已完成';
    } else if (isResearchingThis) {
      rightContent = `<span style="font-size:11px;color:var(--teal);font-weight:800;">⏳ 研究中 ${researchRemain}s</span>`;
    } else if (researching) {
      // 研究槽被占用：其他研究全部等待
      rightContent = `<span style="font-size:11px;color:var(--text-3);">⏳ 等待当前研究完成</span>`;
    } else if (isCurrent && next) {
      if (next.canAfford && next.conditionMet) {
        rightContent = `<button class="research-btn">🔬 研究 ${researchTime}s</button>`;
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

    if (!researching && isCurrent && next?.canAfford && next?.conditionMet) {
      div.onclick = () => {
        if (sys.researchNext()) {
          showToast('🔬 开始研究', `${name} — 预计 ${researchTime} 秒完成`);
          addLog(`🔬 ${name} 开始研究（${researchTime}s）`);
        }
        requestRender();
      };
    }

    container.appendChild(div);
  }

  // ---------- 辅助科技（支线，与主线共享研究槽，永久被动） ----------
  const sideContainer = document.getElementById('side-tech-tree');
  if (sideContainer) {
    sideContainer.innerHTML = '';
    for (const cfg of SIDE_TECH_CONFIGS) {
      const st = sys.getSideTechState(cfg.id);
      const isResearchingThis = researching?.kind === 'side' && researching.sideId === cfg.id;
      const researchTime = GAME_CONSTANTS.RESEARCH_TIME_SIDE;
      const costText = `${cfg.goldCost.toLocaleString()}🪙 + ${cfg.partsCost}⚙️ · ${researchTime}s`;

      const div = document.createElement('div');
      div.className = 'tech-node';
      div.classList.add(st.researched ? 'researched' : isResearchingThis || (st.levelMet && st.canAfford) ? 'available' : 'locked');

      let right = '';
      if (st.researched) {
        right = '✅ 已完成';
      } else if (isResearchingThis) {
        right = `<span style="font-size:11px;color:var(--teal);font-weight:800;">⏳ 研究中 ${researchRemain}s</span>`;
      } else if (!st.levelMet) {
        right = `<span style="font-size:11px;color:var(--text-3);">🔒 需要科技 Lv.${cfg.requiredLevel}</span>`;
      } else if (researching) {
        right = `<span style="font-size:11px;color:var(--text-3);">⏳ 等待当前研究完成</span>`;
      } else if (st.canAfford) {
        right = `<button class="research-btn">🧪 研究 ${researchTime}s</button>`;
      } else {
        right = `<span style="font-size:11px;color:var(--red);">❌ ${costText}</span>`;
      }

      div.innerHTML = `<span class="name">${cfg.name}<span style="display:block;font-size:10px;color:var(--text-3);font-weight:600;">${cfg.description}</span></span><span class="cost">${right}</span>`;

      if (!st.researched && !researching && st.levelMet && st.canAfford) {
        div.onclick = () => {
          if (sys.researchSideTech(cfg.id)) {
            showToast('🧪 开始研究', `${cfg.name} — 预计 ${researchTime} 秒完成`);
            addLog(`🧪 辅助科技「${cfg.name}」开始研究（${researchTime}s）`);
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
