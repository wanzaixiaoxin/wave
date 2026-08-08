// ============================================================
// 面板 UI — 顶栏 HUD、工厂、科技树、成就、造车下拉
// ============================================================

import { getState, getSystems, requestRender } from './context';
import { GameState } from '../core/types';
import { VEHICLE_CONFIGS, getVehicleConfig, getUnmetRequirements, getOccupiedSpaces, getParkingSpaces } from '../config/VehicleConfig';
import { TECH_CONFIGS, SIDE_TECH_CONFIGS } from '../config/TechConfig';
import { getSubTechsOfLevel, RETROFIT_CONFIGS } from '../config/UpgradeConfig';
import { GAME_CONSTANTS, buildEnergyCost } from '../config/GameConstants';
import { getBuildQueueMax } from '../systems/FactorySystem';
import { getUpgradeMult } from '../systems/UpgradeSystem';
import { getEffectivePartsCost } from '../systems/TechSystem';
import { renderPills, PillOption } from './pills';
import { showToast } from './toast';
import { addLog } from './log';

// ==================== 顶栏 ====================

export function renderTopBar(): void {
  const s = getState();
  document.getElementById('gold')!.textContent = s.resources.gold.toLocaleString();
  document.getElementById('parts')!.textContent = Math.floor(s.resources.parts).toLocaleString();

  // 能源（M8）：当前/上限，显示取整
  const fs = getSystems().factorySys;
  document.getElementById('energy')!.textContent =
    `${Math.floor(s.resources.energy)}/${fs.getEnergyCapacity()}`;
  // 声望（M8）：企业品牌
  document.getElementById('reputation')!.textContent =
    Math.floor(s.resources.reputation).toLocaleString();

  // 营销推广按钮（M8）：buff 中 / 冷却中 / 可购买
  const mBtn = document.getElementById('btn-marketing') as HTMLButtonElement | null;
  if (mBtn) {
    const m = getSystems().orderSys.getMarketingState();
    if (m.buff > 0) {
      mBtn.textContent = `📣 营销中 ${Math.ceil(m.buff)}s`;
      mBtn.disabled = true;
    } else if (m.cooldown > 0) {
      mBtn.textContent = `📣 冷却 ${Math.ceil(m.cooldown)}s`;
      mBtn.disabled = true;
    } else {
      mBtn.textContent = `📣 营销推广 (${GAME_CONSTANTS.MARKETING_GOLD_COST.toLocaleString()}🪙)`;
      mBtn.disabled = s.resources.gold < GAME_CONSTANTS.MARKETING_GOLD_COST;
    }
  }

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

// ==================== 造车选择（胶囊直选，非下拉） ====================

let lastBuildTier: string | null = null;

/** 当前是否买得起某 tier（金币/零件/能源全维度，与 createVehicle 同口径：零件走精益制造折后价） */
function canAffordBuild(s: GameState, tier: number): boolean {
  const cfg = getVehicleConfig(tier);
  if (!cfg) return false;
  return s.resources.gold >= Math.floor(cfg.buildCost * getUpgradeMult(s, 'build_cost'))
    && s.resources.parts >= getEffectivePartsCost(s, cfg.partsCost)
    && s.resources.energy >= buildEnergyCost(tier);
}

export function buildTierOptions(): void {
  const container = document.getElementById('build-tier-select');
  if (!container) return;

  const s = getState();
  const entries = VEHICLE_CONFIGS.map(cfg => ({ cfg, unmet: getUnmetRequirements(s, cfg.tier) }));
  const unlocked = entries.filter(e => e.unmet.length === 0);
  const locked = entries.filter(e => e.unmet.length > 0);

  // 未解锁只显示最近的 1-2 个（下一个目标预览），更远的隐藏不露车型，保持胶囊行紧凑
  const shownLocked = locked.slice(0, 2);
  const hiddenLocked = locked.length - shownLocked.length;

  const pills: PillOption[] = [];
  for (const { cfg, unmet } of [...unlocked, ...shownLocked]) {
    if (unmet.length > 0) {
      pills.push({
        value: cfg.tier.toString(),
        emoji: cfg.emoji,
        label: cfg.name,
        badge: '🔒',
        disabled: true,
        lockedHint: unmet.join(' · '),
      });
      continue;
    }
    // 已解锁：悬停显示统一乘区后的实际造价/占格/耗时（批量采购/精益生产）
    const effCost = Math.floor(cfg.buildCost * getUpgradeMult(s, 'build_cost'));
    const effTime = Math.max(1, Math.round(cfg.buildTime * getUpgradeMult(s, 'build_time')));
    const partsStr = cfg.partsCost > 0 ? `${cfg.partsCost}⚙️ ` : '';
    const energyStr = `${buildEnergyCost(cfg.tier)}⚡`;
    pills.push({
      value: cfg.tier.toString(),
      emoji: cfg.emoji,
      label: cfg.name,
      hint: `${effCost.toLocaleString()}🪙 ${partsStr}${energyStr} · 占${cfg.parkingSpaces}格 · ${effTime}s`,
    });
  }
  // 隐藏的未解锁车型：只留一个 🔒+N 占位（不露车型外观）
  if (hiddenLocked > 0) {
    pills.push({
      value: 'hidden-locked',
      emoji: '🔒',
      label: `还有 ${hiddenLocked} 个车型未解锁`,
      badge: `+${hiddenLocked}`,
      disabled: true,
      lockedHint: '继续提升科技 / 工厂 / 电站 / 声望来解锁新车型',
    });
  }

  // 选中恢复：上次选择仍有效则沿用；否则默认「当前买得起的最新车型」，再退到最高已解锁
  let sel = lastBuildTier;
  if (!sel || !pills.some(o => o.value === sel && !o.disabled)) {
    const unlockedPills = pills.filter(o => !o.disabled);
    const affordable = unlockedPills.filter(o => canAffordBuild(s, parseInt(o.value, 10)));
    sel = (affordable[affordable.length - 1] ?? unlockedPills[unlockedPills.length - 1] ?? null)?.value ?? null;
    lastBuildTier = sel; // 默认选中必须回写：制造按钮/信息行/禁用判定都读 lastBuildTier，不回写则点击制造静默无效
  }

  renderPills(container, pills, sel, (v) => { lastBuildTier = v; });

  // 选中车型信息行：大工件 + 成本吊牌（🪙/⚙️/⚡ 各自独立标红，哪样不够一目了然）
  const infoEl = document.getElementById('build-tier-info');
  if (infoEl && sel) {
    const cfg = getVehicleConfig(parseInt(sel, 10));
    if (cfg) {
      const effCost = Math.floor(cfg.buildCost * getUpgradeMult(s, 'build_cost'));
      const effTime = Math.max(1, Math.round(cfg.buildTime * getUpgradeMult(s, 'build_time')));
      const effParts = getEffectivePartsCost(s, cfg.partsCost); // 与 createVehicle 同口径：精益制造折后价
      const effEnergy = buildEnergyCost(cfg.tier);
      const tag = (icon: string, n: number, poor: boolean): string =>
        `<span class="cost-tag${poor ? ' poor' : ''}">${icon} ${n.toLocaleString()}</span>`;
      infoEl.innerHTML =
        `<span class="wb-piece">${cfg.emoji}</span><b class="wb-piece-name">${cfg.name}</b>` +
        tag('🪙', effCost, s.resources.gold < effCost) +
        (effParts > 0 ? tag('⚙️', effParts, s.resources.parts < effParts) : '') +
        tag('⚡', effEnergy, s.resources.energy < effEnergy) +
        `<span class="cost-tag">⏱️ ${effTime}s</span><span class="cost-tag">🅿️ 占${cfg.parkingSpaces}格</span>`;
    }
  }
}

/** 当前选中的造车 tier（main.ts 制造按钮 / renderWorkbench 共用） */
export function getBuildTierSelection(): number {
  return lastBuildTier ? parseInt(lastBuildTier, 10) || 0 : 0;
}

// ==================== 工作台（M7：建造进度条 + 队列 + 按钮禁用） ====================

// 工作台迷你传送带签名缓存：结构常驻（index.html），1Hz 只改 emoji/clipPath/文字，动画不被重建打断
let lastWbWipSig = '';
let lastWbQueueSig = '';

export function renderWorkbench(): void {
  const s = getState();
  const queue = s.garage.buildQueue;
  const box = document.getElementById('build-status');
  const btn = document.getElementById('btn-build') as HTMLButtonElement | null;

  // 建造槽/队列满，或车位（含预留，S2a 占格数口径）满 → 禁用制造按钮；
  // 选中车型未解锁（M9 矩阵）/能源不足（M8）→ 同样置灰并给出原因
  const queueFull = queue.length >= 1 + getBuildQueueMax(s);
  const selectedTier = getBuildTierSelection();
  const selectedSpaces = selectedTier > 0 ? getParkingSpaces(selectedTier) : 0;
  const occupied = getOccupiedSpaces(s);
  const reservedFull = occupied + selectedSpaces > s.garage.maxCapacity;
  const unmet = selectedTier > 0 ? getUnmetRequirements(s, selectedTier) : [];
  const locked = unmet.length > 0;
  const energyShort = selectedTier > 0 && s.resources.energy < buildEnergyCost(selectedTier);
  // 禁用原因：按钮 title（悬停）+ 工作台常驻红字（不悬停也看得见）双通道
  const blockReason = queueFull
    ? '建造队列已满，等造完再来'
    : reservedFull
      ? `车位不足：需要 ${selectedSpaces} 格，仅剩 ${s.garage.maxCapacity - occupied} 格（${occupied}/${s.garage.maxCapacity}，含建造预留），请扩建或拆解`
      : locked
        ? `还未解锁：${unmet.join(' · ')}`
        : energyShort
          ? `能源不足：造车需要 ${buildEnergyCost(selectedTier)}⚡（当前 ${Math.floor(s.resources.energy)}⚡），升级电站或等充电`
          : '';
  if (btn) {
    btn.disabled = blockReason !== '';
    btn.title = blockReason;
  }
  const blockerEl = document.getElementById('build-blocker');
  if (blockerEl) {
    // 槽位常驻（CSS min-height 占位）：只换文字，不切 display，避免顶动下方车库/订单
    blockerEl.textContent = blockReason ? `⛔ ${blockReason}` : '';
    blockerEl.style.display = 'block';
  }

  // 扩建按钮：实时显示费用，满级/金币不足置灰并注明原因（与制造按钮同口径）
  const expandBtn = document.getElementById('btn-expand') as HTMLButtonElement | null;
  if (expandBtn) {
    const nextCost = getSystems().economySys.getNextExpandCost();
    if (nextCost < 0) {
      expandBtn.textContent = `🏠 已满（${s.garage.maxCapacity}格）`;
      expandBtn.disabled = true;
      expandBtn.title = '车库已达最大容量';
    } else {
      expandBtn.textContent = `🏠 扩建 +${GAME_CONSTANTS.GARAGE_EXPAND_SPACES}格 (${nextCost.toLocaleString()}🪙)`;
      expandBtn.disabled = s.resources.gold < nextCost;
      expandBtn.title = expandBtn.disabled ? `金币不足，扩建需要 ${nextCost.toLocaleString()}🪙` : '';
    }
  }

  if (!box) return;
  const wipEl = document.getElementById('wb-wip');
  const wipInfo = document.getElementById('wb-wip-info');
  const queueEl = document.getElementById('wb-queue');
  if (!wipEl || !wipInfo || !queueEl) return;
  box.style.display = 'block';

  if (queue.length === 0) {
    // 空闲：工件灰色待命，槽位常驻高度不变（CSS min-height 保底），版面零跳动
    if (lastWbWipSig !== 'idle') {
      lastWbWipSig = 'idle';
      wipEl.textContent = '🛠️';
      wipEl.classList.add('idle');
      wipEl.style.clipPath = '';
    }
    wipInfo.textContent = '建造槽空闲 · 点击「开工」';
    if (lastWbQueueSig !== '') { lastWbQueueSig = ''; queueEl.innerHTML = ''; }
    return;
  }

  // 建造槽：工件在传送带上自下而上成型（clipPath 进度，finishAt 为真实时间戳，离线也正常走）
  const active = queue[0];
  const activeCfg = getVehicleConfig(active.tier);
  const remain = Math.max(0, Math.ceil((active.finishAt - Date.now()) / 1000));
  const progress = active.totalTime > 0
    ? Math.min(1, Math.max(0, 1 - remain / active.totalTime))
    : 1;

  const sig = String(active.tier);
  if (sig !== lastWbWipSig) {
    lastWbWipSig = sig;
    wipEl.textContent = activeCfg?.emoji ?? '🚗';
    wipEl.classList.remove('idle');
  }
  wipEl.style.clipPath = `inset(${Math.round((1 - progress) * 100)}% 0 0 0)`;
  wipInfo.textContent = `${activeCfg?.name ?? 'T' + active.tier} · 剩余 ${remain}s · ${Math.round(progress * 100)}%`;

  // 排队位：小车在传送带右端等候
  const q = queue.slice(1);
  const qsig = q.map(j => j.tier).join(',');
  if (qsig !== lastWbQueueSig) {
    lastWbQueueSig = qsig;
    queueEl.innerHTML = q.length > 0
      ? '<span class="q-label">队列</span>' +
        q.map(j => `<span class="q-car">${getVehicleConfig(j.tier)?.emoji ?? '🚗'}</span>`).join('')
      : '';
  }
}

// ==================== 工厂 ====================

export function renderFactory(): void {
  const s = getState();
  const fs = getSystems().factorySys;
  document.getElementById('factory-level')!.textContent = s.factory.level.toString();
  // 等级进度可视化：Lv.x/10 + 圆点
  document.getElementById('factory-level-max')!.textContent = fs.getMaxLevel().toString();
  document.getElementById('factory-pips')!.textContent =
    '●'.repeat(s.factory.level) + '○'.repeat(fs.getMaxLevel() - s.factory.level);
  document.getElementById('factory-pps')!.textContent = fs.getPartsPerSecond().toFixed(2);
  document.getElementById('factory-lines-count')!.textContent = fs.getLineCount().toString();
  updateFactoryScene(s, fs);

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

  // 超负荷按钮状态（激活倒计时 / 冷却倒计时 / 可用）；M8：激活需 50⚡
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
      ocBtn.textContent = `⚡ 超负荷 ×${GAME_CONSTANTS.FACTORY_OVERCLOCK_MULT} (${GAME_CONSTANTS.FACTORY_OVERCLOCK_DURATION}s · ${GAME_CONSTANTS.ENERGY_OVERCLOCK}⚡)`;
      ocBtn.disabled = s.resources.energy < GAME_CONSTANTS.ENERGY_OVERCLOCK;
      ocBtn.title = ocBtn.disabled ? `能源不足：超负荷需要 ${GAME_CONSTANTS.ENERGY_OVERCLOCK}⚡` : '';
    }
  }

  // ---------- 电站（M8）：时代名称随科技等级演进 ----------
  const POWER_ERA_NAMES = ['', '燃煤锅炉', '燃油电站', '并网电站', '清洁能源', '聚变堆'];
  const eraName = POWER_ERA_NAMES[Math.min(s.techTree.currentLevel, 5)] ?? POWER_ERA_NAMES[1];
  document.getElementById('power-name')!.textContent = eraName;
  document.getElementById('power-level')!.textContent = s.factory.powerLevel.toString();
  document.getElementById('power-level-max')!.textContent = GAME_CONSTANTS.POWER_MAX_LEVEL.toString();
  document.getElementById('power-pips')!.textContent =
    '●'.repeat(s.factory.powerLevel) + '○'.repeat(GAME_CONSTANTS.POWER_MAX_LEVEL - s.factory.powerLevel);
  document.getElementById('power-rate')!.textContent = fs.getEnergyPerSecond().toFixed(2);

  const cap = fs.getEnergyCapacity();
  document.getElementById('power-stock')!.textContent = `${Math.floor(s.resources.energy)} / ${cap}`;
  (document.getElementById('power-bar') as HTMLElement).style.width =
    `${Math.min(100, (s.resources.energy / cap) * 100)}%`;
  updatePowerScene(s, cap);

  const pCost = fs.getPowerUpgradeCost();
  document.getElementById('power-upgrade-cost')!.textContent = pCost > 0 ? pCost.toLocaleString() : 'MAX';
  const pBtn = document.getElementById('btn-upgrade-power') as HTMLButtonElement | null;
  if (pBtn) {
    pBtn.disabled = pCost < 0 || s.resources.gold < pCost;
    pBtn.title = pCost > 0 && s.resources.gold < pCost ? '金币不足' : '';
  }
  const pNextEl = document.getElementById('power-next-info');
  if (pNextEl) {
    if (pCost > 0) {
      const nextMult = 1 + s.factory.powerLevel * GAME_CONSTANTS.POWER_RATE_GROWTH;
      const techBoost = s.techTree.currentLevel >= 3 ? 1 + GAME_CONSTANTS.TECH_SPEED_BOOST : 1.0;
      const nextRate = GAME_CONSTANTS.POWER_BASE_RATE * nextMult * techBoost;
      pNextEl.textContent = `下一级：${nextRate.toFixed(2)}⚡/秒 · 储备上限 ${GAME_CONSTANTS.POWER_CAPACITY_PER_LEVEL * (s.factory.powerLevel + 1)}`;
    } else {
      pNextEl.textContent = '⚡ 电站已满级';
    }
  }

  // ---------- 工厂/电站改造（v1.3）：即时购买生效，不占研究槽 ----------
  renderRetrofits('factory-retrofits', 'factory');
  renderRetrofits('power-retrofits', 'power');
}

/** 改造线区块：等级圆点 + 效果 + 下一级费用 + 购买按钮 */
function renderRetrofits(containerId: string, kind: 'factory' | 'power'): void {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  const s = getState();
  const fs = getSystems().factorySys;
  for (const cfg of RETROFIT_CONFIGS.filter(r => r.kind === kind)) {
    const st = fs.getRetrofitState(cfg.id);
    const pips = '●'.repeat(st.level) + '○'.repeat(st.maxLevel - st.level);
    const maxed = st.cost === null;
    const costText = maxed
      ? 'MAX'
      : st.cost!.parts > 0
        ? `${st.cost!.gold.toLocaleString()}🪙 + ${st.cost!.parts}⚙️`
        : `${st.cost!.gold.toLocaleString()}🪙`;
    const canAfford = !maxed &&
      s.resources.gold >= st.cost!.gold && s.resources.parts >= st.cost!.parts;

    const div = document.createElement('div');
    div.className = 'tech-node';
    div.classList.add(maxed ? 'researched' : canAfford ? 'available' : 'locked');
    div.innerHTML =
      `<span class="name">${cfg.name} <span class="rank-pips">${pips}</span>` +
      `<span style="display:block;font-size:10px;color:var(--text-3);font-weight:600;">${cfg.effectDesc}</span></span>` +
      (maxed
        ? `<span class="cost">✅ 满级</span>`
        : canAfford
          ? `<span class="cost"><button class="research-btn">🛠 改造 ${costText}</button></span>`
          : `<span class="cost" style="color:var(--red);">❌ ${costText}</span>`);

    if (canAfford) {
      div.onclick = () => {
        if (fs.buyRetrofit(cfg.id)) {
          showToast('🛠 改造完成', `${cfg.name} Lv.${st.level + 1}（${cfg.effectDesc}）`);
          addLog(`🛠 ${cfg.name} 改造至 Lv.${st.level + 1}（-${costText}）`);
        }
        requestRender();
      };
    }
    container.appendChild(div);
  }
}

// ==================== 场景化面板头（结构一次性构建，1Hz 只改内联样式/class） ====================

type FactorySys = ReturnType<typeof getSystems>['factorySys'];

let lastFloorCount = -1;
let lastWipSig = '';
let lastQueueSig = '';

/** 像素车间：楼层=工厂等级（升级时新楼层落入）、在造车辆自下而上成型、队列等候 */
function updateFactoryScene(s: GameState, _fs: FactorySys): void {
  const floors = document.getElementById('scene-floors');
  if (floors && s.factory.level !== lastFloorCount) {
    const dropping = lastFloorCount >= 0 && s.factory.level > lastFloorCount;
    lastFloorCount = s.factory.level;
    floors.innerHTML = Array.from({ length: s.factory.level }, (_, i) =>
      `<div class="floor${dropping && i === s.factory.level - 1 ? ' drop' : ''}"></div>`).join('');
  }

  const job = s.garage.buildQueue[0];
  const build = document.getElementById('scene-build');
  const wip = document.getElementById('scene-wip');
  const pctEl = document.getElementById('scene-wip-pct');
  if (build && wip && pctEl) {
    if (job && job.finishAt > 0) {
      const sig = String(job.tier);
      if (sig !== lastWipSig) {
        lastWipSig = sig;
        wip.textContent = getVehicleConfig(job.tier)?.emoji ?? '🚗';
      }
      const progress = Math.min(1, Math.max(0, 1 - (job.finishAt - Date.now()) / (job.totalTime * 1000)));
      wip.style.clipPath = `inset(${Math.round((1 - progress) * 100)}% 0 0 0)`;
      pctEl.textContent = `${Math.round(progress * 100)}%`;
      build.classList.remove('idle');
    } else if (lastWipSig !== '' || !build.classList.contains('idle')) {
      lastWipSig = '';
      wip.style.clipPath = '';
      pctEl.textContent = '';
      build.classList.add('idle');
    }
  }

  const queue = document.getElementById('scene-queue');
  if (queue) {
    const q = s.garage.buildQueue.slice(1);
    const qsig = q.map(j => j.tier).join(',');
    if (qsig !== lastQueueSig) {
      lastQueueSig = qsig;
      queue.innerHTML = q.length > 0
        ? '<span class="q-label">队列</span>' +
          q.map(j => `<span class="q-car">${getVehicleConfig(j.tier)?.emoji ?? '🚗'}</span>`).join('')
        : '';
    }
  }
}

/** 电站储罐：液位=储能%，超负荷罐体震动 */
function updatePowerScene(s: GameState, cap: number): void {
  const liquid = document.getElementById('tank-liquid');
  if (liquid) liquid.style.height = `${Math.min(100, (s.resources.energy / cap) * 100)}%`;
  const ocActive = s.factory.overclockUntil > Date.now();
  document.getElementById('scene-tank')?.classList.toggle('overclock', ocActive);
  const info = document.getElementById('tank-info');
  if (info) {
    info.textContent = ocActive
      ? `⚡ 超负荷 ×${GAME_CONSTANTS.FACTORY_OVERCLOCK_MULT} 运转中`
      : `储备 ${Math.floor(s.resources.energy)} / ${cap}⚡`;
  }
}

/** 实验室烧瓶：液位=研究进度（颜色区分主线/支线/子科技），空闲灰暗 */
function updateTechScene(s: GameState): void {
  const flask = document.getElementById('scene-flask');
  const liquid = document.getElementById('flask-liquid');
  const info = document.getElementById('flask-info');
  if (!flask || !liquid || !info) return;
  const r = s.techTree.researching;
  if (r) {
    const label = r.kind === 'main' ? `主线 L${r.level}` : r.kind === 'side' ? '辅助科技' : '子科技';
    const progress = Math.min(1, Math.max(0, 1 - (r.finishAt - Date.now()) / (r.totalTime * 1000)));
    liquid.style.height = `${Math.round(progress * 82)}%`;
    liquid.style.background = r.kind === 'main' ? 'var(--blue)' : r.kind === 'side' ? 'var(--teal)' : 'var(--gold-deep)';
    info.textContent = `${label} 研究中 · ${Math.round(progress * 100)}%`;
    flask.classList.add('active');
  } else {
    liquid.style.height = '0%';
    info.textContent = '研究槽空闲';
    flask.classList.remove('active');
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
  updateTechScene(s);

  // 当前科技等级总览：Lv.x/5 + 等级名 + 圆点
  const summaryEl = document.getElementById('tech-summary');
  if (summaryEl) {
    const cur = s.techTree.currentLevel;
    const curName = TECH_CONFIGS.find(c => c.level === cur)?.name ?? '';
    summaryEl.innerHTML =
      `当前等级：<strong>Lv.${cur}/${TECH_CONFIGS.length}</strong>（${curName}）` +
      ` <span class="rank-pips">${'●'.repeat(cur) + '○'.repeat(TECH_CONFIGS.length - cur)}</span>`;
  }

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

    // ---------- 子科技（v1.3）：主线每级下挂 2 项 × 3 阶，共享研究槽 ----------
    for (const sub of getSubTechsOfLevel(i)) {
      const st = sys.getSubTechState(sub.id);
      const isResearchingThis = researching?.kind === 'sub' && researching.subId === sub.id;
      const pips = '●'.repeat(st.rank) + '○'.repeat(3 - st.rank);
      const subCostText = st.partsCost > 0
        ? `${st.goldCost.toLocaleString()}🪙 + ${st.partsCost}⚙️ · ${st.researchTime}s`
        : `${st.goldCost.toLocaleString()}🪙 · ${st.researchTime}s`;

      const subDiv = document.createElement('div');
      subDiv.className = 'tech-node sub';
      const maxed = st.rank >= 3;
      subDiv.classList.add(
        maxed ? 'researched'
          : isResearchingThis || (st.unlocked && st.canAfford) ? 'available'
            : 'locked'
      );

      let subRight = '';
      if (maxed) {
        subRight = '✅ 满阶';
      } else if (isResearchingThis) {
        subRight = `<span style="font-size:11px;color:var(--teal);font-weight:800;">⏳ 研究中 ${researchRemain}s</span>`;
      } else if (!st.unlocked) {
        subRight = `<span style="font-size:11px;color:var(--text-3);">🔒 需研究「${cfg.name}」</span>`;
      } else if (researching) {
        subRight = `<span style="font-size:11px;color:var(--text-3);">⏳ 等待当前研究完成</span>`;
      } else if (st.canAfford) {
        subRight = `<button class="research-btn">🔬 研究 ${st.researchTime}s</button>`;
      } else {
        subRight = `<span style="font-size:11px;color:var(--red);">❌ ${subCostText}</span>`;
      }

      subDiv.innerHTML =
        `<span class="name" style="font-size:11px;">├ ${sub.name} <span class="rank-pips">${pips}</span>` +
        `<span style="display:block;font-size:10px;color:var(--text-3);font-weight:600;">${sub.effectDesc}</span></span>` +
        `<span class="cost">${subRight}</span>`;

      if (!maxed && !researching && st.unlocked && st.canAfford) {
        subDiv.onclick = () => {
          if (sys.researchSubTech(sub.id)) {
            showToast('🔬 开始研究', `${sub.name} ${st.rank + 1} 阶 — 预计 ${st.researchTime} 秒完成`);
            addLog(`🔬 子科技「${sub.name}」${st.rank + 1} 阶开始研究（${st.researchTime}s）`);
          }
          requestRender();
        };
      }

      container.appendChild(subDiv);
    }
  }

  // ---------- 辅助科技（支线，与主线共享研究槽，v1.3：3 阶制，永久被动） ----------
  const sideContainer = document.getElementById('side-tech-tree');
  if (sideContainer) {
    sideContainer.innerHTML = '';
    for (const cfg of SIDE_TECH_CONFIGS) {
      const st = sys.getSideTechState(cfg.id);
      const isResearchingThis = researching?.kind === 'side' && researching.sideId === cfg.id;
      const researchTime = GAME_CONSTANTS.RESEARCH_TIME_SIDE;
      const maxed = st.rank >= st.maxRank;
      const pips = '●'.repeat(st.rank) + '○'.repeat(st.maxRank - st.rank);
      const costText = `${st.goldCost.toLocaleString()}🪙 + ${st.partsCost}⚙️ · ${researchTime}s`;

      const div = document.createElement('div');
      div.className = 'tech-node';
      div.classList.add(maxed ? 'researched' : isResearchingThis || (st.levelMet && st.canAfford) ? 'available' : 'locked');

      let right = '';
      if (maxed) {
        right = '✅ 满阶';
      } else if (isResearchingThis) {
        right = `<span style="font-size:11px;color:var(--teal);font-weight:800;">⏳ 研究中 ${researchRemain}s</span>`;
      } else if (!st.levelMet) {
        right = `<span style="font-size:11px;color:var(--text-3);">🔒 需要科技 Lv.${cfg.requiredLevel}</span>`;
      } else if (researching) {
        right = `<span style="font-size:11px;color:var(--text-3);">⏳ 等待当前研究完成</span>`;
      } else if (st.canAfford) {
        right = `<button class="research-btn">🧪 研究 ${st.rank + 1} 阶 ${researchTime}s</button>`;
      } else {
        right = `<span style="font-size:11px;color:var(--red);">❌ ${costText}</span>`;
      }

      div.innerHTML = `<span class="name">${cfg.name} <span class="rank-pips">${pips}</span><span style="display:block;font-size:10px;color:var(--text-3);font-weight:600;">${cfg.description}</span></span><span class="cost">${right}</span>`;

      if (!maxed && !researching && st.levelMet && st.canAfford) {
        div.onclick = () => {
          if (sys.researchSideTech(cfg.id)) {
            showToast('🧪 开始研究', `${cfg.name} ${st.rank + 1} 阶 — 预计 ${researchTime} 秒完成`);
            addLog(`🧪 辅助科技「${cfg.name}」${st.rank + 1} 阶开始研究（${researchTime}s）`);
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
