// ============================================================
// 车库 UI — 车辆卡片网格 + 车辆详情弹窗（派单/运营操作）
// ============================================================

import { Vehicle, Quality, TraitType, VehicleStats, Specialization } from '../core/types';
import { getVehicleConfig, getUnmetRequirements, VEHICLE_CONFIGS, getParkingSpaces } from '../config/VehicleConfig';
import { GAME_CONSTANTS, statUpgradeCost, getBreakinBonus, getMileageLifespan } from '../config/GameConstants';
import { getState, getSystems, requestRender } from './context';
import { getTraitName, getTraitDesc, getQualityLabel } from './format';
import { getUpgradeMult } from '../systems/UpgradeSystem';
import { getSellPrice } from '../systems/VehicleSystem';
import { showModal, hideModal } from './modal';
import { renderPills, PillOption } from './pills';
import { showToast } from './toast';
import { addLog } from './log';

/** 里程显示：1234km → 1.2k */
function fmtMileage(mileage: number): string {
  return mileage >= 1000 ? `${(mileage / 1000).toFixed(1)}k` : `${Math.floor(mileage)}`;
}

/** 金额短格式：1234 → 1.2k，1234567 → 1.2M（卡片单行放得下） */
function fmtMoney(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return `${Math.floor(n)}`;
}

// ==================== 车库渲染 ====================

/** 车位格列数：每行 6 格（对应初始容量 6，S2a 占格数口径） */
const LOT_COLS = 6;

/** 空车位：喷漆虚线框 + 车位号 */
function createParkingSlot(no: number, col: number): HTMLElement {
  const slot = document.createElement('div');
  slot.className = 'parking-slot';
  slot.style.gridColumn = `${col}`;
  slot.innerHTML = `<span class="slot-no">${no}</span>`;
  return slot;
}

export function renderGarage(): void {
  const s = getState();
  // 车库标题（S2a 占格数口径）：现有车辆 parkingSpaces 之和 / 容量
  const used = s.garage.vehicles.reduce((sum, v) => sum + getParkingSpaces(v.tier), 0);
  document.getElementById('garage-count')!.textContent = used.toString();
  document.getElementById('garage-max')!.textContent = `${s.garage.maxCapacity}格`;

  const grid = document.getElementById('garage-grid')!;
  grid.innerHTML = '';

  const vehicles = s.garage.vehicles;
  let pos = 0; // 全局占位游标（0 起，车位号 = pos+1）

  // 本行剩余列补空车位，让放不下的车换行停放
  const padRow = (): void => {
    while (pos % LOT_COLS !== 0) {
      const col = (pos % LOT_COLS) + 1;
      grid.appendChild(createParkingSlot(pos + 1, col));
      pos++;
    }
  };

  if (vehicles.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'garage-empty';
    msg.innerHTML = '🅿️ 车库是空的<br><span>🏭工厂产⚙️ → 🔧消耗⚙️+🪙造车 → 📮跑单赚🪙</span>';
    grid.appendChild(msg);
  } else {
    for (const v of vehicles) {
      const span = getParkingSpaces(v.tier);
      if (pos % LOT_COLS + span > LOT_COLS) padRow(); // 本行放不下 → 先画满本行空位再换行
      const col = (pos % LOT_COLS) + 1;
      grid.appendChild(createVehicleCard(v, col, span));
      pos += span;
    }
  }

  // 补齐剩余空车位（到容量上限，车位号连续）
  while (pos < s.garage.maxCapacity) {
    const col = (pos % LOT_COLS) + 1;
    grid.appendChild(createParkingSlot(pos + 1, col));
    pos++;
  }
}

/** 车辆迷你卡片：大图标 + 名称 + 单行摘要（里程/残值）+ 状态圆点；详情进弹窗 */
function createVehicleCard(v: Vehicle, col: number, span: number): HTMLElement {
  const s = getState();
  const vehicleSys = getSystems().vehicleSys;
  const config = getVehicleConfig(v.tier);
  const card = document.createElement('div');
  card.className = `vehicle-card quality-${v.quality} span-${span}`;
  card.style.gridColumn = `${col} / ${col + span}`;

  // 规格角标
  const badge = v.quality === 'gold' ? '<span class="quality-badge gold-badge">工业</span>'
    : v.quality === 'blue' ? '<span class="quality-badge blue-badge">标准</span>' : '';

  // 状态圆点：空闲绿 / 派单橙 / 升级中紫
  const dotClass = v.status === 'idle' ? 'idle' : v.status === 'maintenance' ? 'maintenance' : 'busy';
  const statusText = v.status === 'idle'
    ? '✅ 空闲'
    : v.status === 'maintenance'
      ? `⬆ 规格升级中 ${Math.max(0, Math.ceil(((v.qualityUpgrade?.finishAt ?? 0) - Date.now()) / 1000))}s`
      : '🚚 派单中';

  // 单行摘要：里程 + 残值（低残值红色警示）
  const residual = vehicleSys.getResidual(v.id);
  const paidCost = Math.floor((config?.buildCost ?? 0) * getUpgradeMult(s, 'build_cost'));
  const lowResidual = paidCost > 0 && residual < paidCost * 0.2;

  card.innerHTML = `
    <span class="tier-badge">T${v.tier}</span>
    ${badge}
    <div class="emoji">${config?.emoji || '🚗'}</div>
    <div class="name">${v.name}</div>
    <div class="card-line ${lowResidual ? 'residual-low' : ''}" title="里程 / 当前残值">🛞 ${fmtMileage(v.mileage)} · 💰 ${fmtMoney(residual)}</div>
    <span class="status-dot ${dotClass}" title="${statusText}"></span>
  `;
  card.onclick = () => showVehicleDetail(v);
  return card;
}

// ==================== 车辆详情弹窗 ====================

export function showVehicleDetail(v: Vehicle): void {
  const sys = getSystems();
  const config = getVehicleConfig(v.tier);

  const SPEC_INFO: Record<string, { icon: string; name: string; desc: string }> = {
    express: { icon: '⚡', name: '快运', desc: '耗时 -25%，收入 -10%' },
    heavy: { icon: '💪', name: '重载', desc: '收入 +25%，耗时 +15%' },
    steady: { icon: '🛡️', name: '耐用', desc: '磨损减半，磨合增速 +15%' },
  };
  const specLine = v.specialization
    ? `<p>🎯 运营配置: ${SPEC_INFO[v.specialization].icon}${SPEC_INFO[v.specialization].name}（${SPEC_INFO[v.specialization].desc}）</p>`
    : '';
  const wearColor = v.wear >= GAME_CONSTANTS.WEAR_PENALTY_THRESHOLD ? 'var(--red)' : 'var(--text-2)';
  const wearLine = `<p style="color:${wearColor};">🔧 磨损 ${Math.floor(v.wear)}/100${v.wear >= GAME_CONSTANTS.WEAR_PENALTY_THRESHOLD ? '（收入-30% 耗时+20%，快检修！）' : ''} · 😮‍💨 连单 ${v.consecutiveOrders}（越多收入越低，空闲30秒恢复）</p>`;

  // S2a 资产档案：里程 / 车龄 / 磨合 / 残值 / 翻新次数
  const lifespan = getMileageLifespan(v.tier);
  const breakinPct = Math.round(getBreakinBonus(v.mileage) * 100);
  const ageMin = Math.max(0, Math.floor((Date.now() - v.createdAt) / 60000));
  const residual = sys.vehicleSys.getResidual(v.id);
  const paidCost = Math.floor((config?.buildCost ?? 0) * getUpgradeMult(getState(), 'build_cost'));
  const lowResidual = paidCost > 0 && residual < paidCost * 0.2;
  const residualLine = `<p style="${lowResidual ? 'color:var(--red);font-weight:700;' : ''}">💰 当前残值 ${residual.toLocaleString()}🪙（实付 ${paidCost.toLocaleString()}🪙）${lowResidual ? ' ⬇ 高折旧，考虑出售/置换' : ''}</p>`;

  const detail = `
    <p>${config?.emoji} <strong>${v.name}</strong> · T${v.tier} ${config?.name || ''} · 占${getParkingSpaces(v.tier)}格</p>
    <p>📊 规格: ${getQualityLabel(v.quality)}</p>
    <p>🛞 里程 ${fmtMileage(v.mileage)}/${fmtMileage(lifespan)} km（寿命 ${fmtMileage(lifespan)}km）· 磨合 +${breakinPct}%（上限 +40%）</p>
    <p>⏱️ 车龄：运行 ${ageMin} 分钟 · 🔁 翻新 ${v.refurbishCount}/${GAME_CONSTANTS.REFURBISH_MAX_COUNT} 次</p>
    ${residualLine}
    <p>🧬 出厂参数: ${getTraitName(v.trait)}${getTraitDesc(v.trait) ? `（${getTraitDesc(v.trait)}）` : ''} ${v.trait === TraitType.Lucky ? '🔥稀有' : ''}</p>
    ${specLine}
    ${wearLine}
    <p>🏎️速度 ${v.stats.speed}/5（耗时-4%/级）· 📦载货 ${v.stats.cargo}/5（收入+4%/级）· 🔩耐久 ${v.stats.durability}/5（≥3 可接🏔️长途单 · 每单磨损-8%/级）</p>
    <p>📦 ${v.ordersCompleted}单 · 🪙 ${v.totalEarnings.toLocaleString()}</p>
    <p>${v.status === 'idle' ? '✅ 空闲' : v.status === 'maintenance' ? `⬆ 规格升级中，剩余 ${Math.max(0, Math.ceil(((v.qualityUpgrade?.finishAt ?? 0) - Date.now()) / 1000))}s` : '🚚 执行订单中'}</p>
  `;

  const buttons: (string | (() => void))[] = [];

  // ---------- 派单 ----------
  if (v.status === 'idle') {
    buttons.push('📮 派单', () => {
      const orders = sys.orderSys.getAvailableOrders();
      const match = orders.find(o => sys.orderSys.canVehicleTakeOrder(v.id, o));
      if (match) {
        sys.orderSys.assignVehicle(match.id, v.id);
        addLog(`📮 ${v.name} 出发接单！`);
        hideModal();
      } else {
        addLog('⚠️ 暂时没有适合该车的订单，等一会刷新');
      }
      requestRender();
    });
  }

  // ---------- 检修（消耗零件，只清磨损，有冷却；S2a 成本随里程浮动） ----------
  const overhaulCd = sys.vehicleSys.getOverhaulCooldownRemaining(v.id);
  const overhaulCost = sys.vehicleSys.getOverhaulCost(v.id);
  buttons.push(overhaulCd > 0 ? `🔧 检修(${Math.ceil(overhaulCd / 60)}分钟)` : `🔧 检修·清磨损(${overhaulCost}⚙️)`, () => {
    if (sys.vehicleSys.overhaul(v.id)) {
      addLog(`🔧 检修了 ${v.name}，磨损已清零（-${overhaulCost}⚙️）`);
    } else {
      addLog(`🔧 检修冷却中或零件不足（需要 ${overhaulCost}⚙️）`);
    }
    showVehicleDetail(v); // 重开弹窗刷新冷却/数值
    requestRender();
  });

  // ---------- 翻新（S2a：磨损清零 + 里程×0.4 折旧回春，每车限 2 次） ----------
  if (v.status === 'idle' && v.refurbishCount < GAME_CONSTANTS.REFURBISH_MAX_COUNT) {
    const rc = sys.vehicleSys.getRefurbishCost(v.id);
    if (rc) {
      buttons.push(`✨ 翻新 (${rc.gold.toLocaleString()}🪙+${rc.parts}⚙️ · ${v.refurbishCount}/${GAME_CONSTANTS.REFURBISH_MAX_COUNT})`, () => {
        if (sys.vehicleSys.refurbish(v.id)) {
          addLog(`✨ 翻新了 ${v.name}：磨损清零，里程回春（-${rc.gold.toLocaleString()}🪙 -${rc.parts}⚙️）`);
          showToast('✨ 翻新完成', `${v.name} 折旧回春，残值回升`);
        } else {
          addLog(`❌ 翻新条件不足（需空闲 + ${rc.gold.toLocaleString()}🪙 + ${rc.parts}⚙️）`);
        }
        showVehicleDetail(v);
        requestRender();
      });
    }
  }

  // ---------- 出售（S2a：残值金币，无零件；与拆解二选一） ----------
  if (v.status === 'idle') {
    const sellPrice = getSellPrice(getState(), v);
    buttons.push(`💰 出售 (+${sellPrice.toLocaleString()}🪙)`, () => {
      const got = sys.vehicleSys.sellVehicle(v.id);
      if (got > 0) {
        addLog(`💰 出售了 ${v.name}，回收残值 +${got.toLocaleString()}🪙`);
        hideModal();
      } else {
        addLog(`❌ 出售失败（车辆不存在或正在派单）`);
      }
      requestRender();
    });
  }

  // ---------- 属性升级（速度/载货/耐久） ----------
  const statDefs: Array<{ key: keyof VehicleStats; emoji: string; name: string }> = [
    { key: 'speed', emoji: '🏎️', name: '速度' },
    { key: 'cargo', emoji: '📦', name: '载货' },
    { key: 'durability', emoji: '🔩', name: '耐久' },
  ];
  for (const sd of statDefs) {
    const cur = v.stats[sd.key];
    if (cur >= GAME_CONSTANTS.STAT_MAX_LEVEL) {
      continue; // 已满级的不显示按钮
    }
    const cost = statUpgradeCost(cur);
    buttons.push(`${sd.emoji} ${sd.name}↑ (${cost}🪙)`, () => {
      if (sys.vehicleSys.upgradeStat(v.id, sd.key)) {
        addLog(`${sd.emoji} ${v.name} ${sd.name}升到 ${cur + 1} 级（-${cost}🪙）`);
      } else {
        addLog(`❌ 金币不足，升级需要 ${cost}🪙`);
      }
      showVehicleDetail(v);
      requestRender();
    });
  }

  // ---------- 运营配置选择（蓝规格解锁，三选一，永久） ----------
  if (!v.specialization && (v.quality === Quality.Blue || v.quality === Quality.Gold)) {
    for (const [key, info] of Object.entries(SPEC_INFO)) {
      buttons.push(`${info.icon} 配置·${info.name}`, () => {
        if (sys.vehicleSys.specialize(v.id, key as Specialization)) {
          showToast(`${info.icon} 运营配置确立！`, `${v.name} 成为「${info.name}」— ${info.desc}`);
          addLog(`🎯 ${v.name} 选择了${info.name}运营配置（${info.desc}）`);
        }
        showVehicleDetail(v);
        requestRender();
      });
    }
  }

  // ---------- 升级规格（M7：耗时化，升级中锁车不显示按钮；M8：耗电） ----------
  if (v.quality !== Quality.Gold && !v.qualityUpgrade) {
    const upgradeTime = v.quality === Quality.White
      ? GAME_CONSTANTS.QUALITY_UPGRADE_TIME_BLUE
      : GAME_CONSTANTS.QUALITY_UPGRADE_TIME_GOLD;
    const energyCost = v.quality === Quality.White
      ? GAME_CONSTANTS.ENERGY_QUALITY_BLUE
      : GAME_CONSTANTS.ENERGY_QUALITY_GOLD;
    buttons.push(`⬆ 升级规格 (${upgradeTime}s · ${energyCost}⚡)`, () => {
      if (sys.vehicleSys.upgradeQuality(v.id)) {
        showToast('⬆ 开始升级', `${v.name} 进场升级规格，${upgradeTime} 秒后完成（期间不可派单）`);
        addLog(`⬆ ${v.name} 开始升级规格（${upgradeTime}s · -${energyCost}⚡），期间锁定不可派单`);
        hideModal();
      } else {
        addLog(`❌ 规格升级条件不足（需要空闲 + 完成订单数/金币/零件/${energyCost}⚡能源）`);
      }
      requestRender();
    });
  }

  // ---------- 以旧换新（Idle 可用：拆解回收 + 新车入队一次完成） ----------
  if (v.status === 'idle') {
    buttons.push('🔁 以旧换新', () => {
      showTradeInModal(v);
    });
  }

  // ---------- 拆解 ----------
  buttons.push('🔧 拆解', () => {
    const result = sys.vehicleSys.scrapVehicle(v.id);
    addLog(`🔧 ${v.name} 已拆解，回收 ${result.parts}⚙️ + ${result.gold.toLocaleString()}🪙（残值口径）`);
    hideModal();
    requestRender();
  });

  showModal(`${config?.emoji} ${v.name}`, [detail], ...buttons);
}

// ==================== 以旧换新弹窗 ====================

/**
 * 置换窗口：目标车型下拉（只列已解锁且 tier 更高的车型，默认 tier+1）+ 实时清单。
 * 数值统一走 vehicleSys.getTradeInQuote（与 tradeIn 校验同一口径）。
 */
function showTradeInModal(v: Vehicle): void {
  const sys = getSystems();
  const state = getState();
  const oldConfig = getVehicleConfig(v.tier);

  // 目标车型：已解锁且 tier 更高（同/低 tier 没有经营意义，直接拆解即可）
  const targets = VEHICLE_CONFIGS.filter(c =>
    c.tier > v.tier && getUnmetRequirements(state, c.tier).length === 0
  );

  const overlay = document.getElementById('modal-overlay')!;
  const content = document.getElementById('modal-content')!;
  content.innerHTML = `<h2>🔁 以旧换新：${v.name}</h2>`;

  if (targets.length === 0) {
    content.innerHTML += '<p>暂无可置换的更高 tier 车型（先解锁新车型再来吧）</p>';
    const btnRow = document.createElement('div');
    btnRow.className = 'btn-row';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.onclick = (e) => { e.stopPropagation(); hideModal(); };
    btnRow.appendChild(closeBtn);
    content.appendChild(btnRow);
    overlay.classList.add('visible');
    return;
  }

  // 目标车型胶囊：默认选中 tier+1（否则列表第一项），点击即选即刷新报价
  let selTier: string = (targets.find(c => c.tier === v.tier + 1) ?? targets[0]).tier.toString();
  const pillRow = document.createElement('div');
  const pillOpts: PillOption[] = targets.map(c => ({
    value: c.tier.toString(),
    emoji: c.emoji,
    label: `${c.name} · T${c.tier}`,
  }));
  renderPills(pillRow, pillOpts, selTier, (val) => { selTier = val; renderQuote(); });
  content.appendChild(pillRow);

  const quoteBox = document.createElement('div');
  content.appendChild(quoteBox);

  const btnRow = document.createElement('div');
  btnRow.className = 'btn-row';
  const confirmBtn = document.createElement('button');
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '取消';
  cancelBtn.onclick = (e) => { e.stopPropagation(); hideModal(); };
  btnRow.appendChild(confirmBtn);
  btnRow.appendChild(cancelBtn);
  content.appendChild(btnRow);

  // 实时清单：旧车回收 / 新车成本 / 实际需补 / 建造耗时
  const renderQuote = (): void => {
    const newTier = parseInt(selTier, 10);
    const newConfig = getVehicleConfig(newTier);
    if (!newConfig) {
      quoteBox.innerHTML = '<p style="color:var(--red);font-weight:700;">❌ 请选择目标车型</p>';
      confirmBtn.textContent = '🔁 确认置换';
      confirmBtn.disabled = true;
      return;
    }
    const q = sys.vehicleSys.getTradeInQuote(v.id, newTier);

    if (!q.ok) {
      quoteBox.innerHTML = `<p style="color:var(--red);font-weight:700;">❌ ${q.reason}</p>`;
      confirmBtn.textContent = '🔁 确认置换';
      confirmBtn.disabled = true;
      return;
    }

    const diffShort = q.goldDiff - state.resources.gold; // 还差多少（正数=不够）
    const diffLine = diffShort > 0
      ? `<p style="color:var(--red);font-weight:700;">💰 实际需补：-${q.goldDiff.toLocaleString()}🪙（还差 ${diffShort.toLocaleString()}🪙）</p>`
      : `<p>💰 实际需补：-${q.goldDiff.toLocaleString()}🪙</p>`;
    quoteBox.innerHTML = `
      <p>♻️ 旧车回收（${oldConfig?.emoji}${oldConfig?.name}，残值 ${q.residual.toLocaleString()}🪙）：+${q.scrapParts.toLocaleString()}⚙️ +${q.scrapGold.toLocaleString()}🪙</p>
      <p>🏭 新车成本（${newConfig.emoji}${newConfig.name}）：-${q.buildGold.toLocaleString()}🪙 -${q.buildParts.toLocaleString()}⚙️ -${q.buildEnergy.toLocaleString()}⚡</p>
      ${diffLine}
      <p>⏱️ 建造耗时：${q.buildTime}s（建完自动进车库）</p>
    `;
    confirmBtn.textContent = diffShort > 0 ? '🔁 金币不足' : '🔁 确认置换';
    confirmBtn.disabled = diffShort > 0;
  };

  renderQuote();

  confirmBtn.onclick = (e) => {
    e.stopPropagation();
    const newTier = parseInt(selTier, 10);
    const newConfig = getVehicleConfig(newTier);
    if (!newConfig) return;
    const q = sys.vehicleSys.getTradeInQuote(v.id, newTier);
    const res = sys.vehicleSys.tradeIn(v.id, newTier);
    overlay.classList.remove('visible');
    if (res.ok) {
      showToast('🔁 置换成功', `${oldConfig?.emoji}${v.name} → ${newConfig.emoji}${newConfig.name}，补差价 ${q.goldDiff.toLocaleString()}🪙`);
      addLog(`🔁 ${oldConfig?.emoji} ${v.name} 置换了 ${newConfig.emoji} ${newConfig.name}，补差价 ${q.goldDiff.toLocaleString()}🪙`);
    } else {
      addLog(`❌ 置换失败：${res.reason}`);
    }
    requestRender();
  };

  overlay.classList.add('visible');
}
