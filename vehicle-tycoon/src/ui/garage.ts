// ============================================================
// 车库 UI — 车辆卡片网格 + 车辆详情弹窗（派单/养成操作）
// ============================================================

import { Vehicle, Quality, TraitType, VehicleStats, Specialization } from '../core/types';
import { getVehicleConfig, getUnmetRequirements, VEHICLE_CONFIGS } from '../config/VehicleConfig';
import { GAME_CONSTANTS, statUpgradeCost } from '../config/GameConstants';
import { getState, getSystems, requestRender } from './context';
import { getTraitName, getTraitDesc, getQualityLabel, pickRandomNames } from './format';
import { showModal, hideModal, showNamingModal } from './modal';
import { showToast } from './toast';
import { addLog } from './log';

// ==================== 车库渲染 ====================

export function renderGarage(): void {
  const s = getState();
  document.getElementById('garage-count')!.textContent = s.garage.vehicles.length.toString();
  document.getElementById('garage-max')!.textContent = s.garage.maxCapacity.toString();

  const grid = document.getElementById('garage-grid')!;
  grid.innerHTML = '';

  if (s.garage.vehicles.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-3);padding:30px;font-size:14px;">🅿️ 车库是空的<br><span style="font-size:12px;">🏭工厂产⚙️ → 🔧消耗⚙️+🪙造车 → 📮跑单赚🪙</span></div>';
    return;
  }

  const vehicleSys = getSystems().vehicleSys;

  s.garage.vehicles.forEach(v => {
    const config = getVehicleConfig(v.tier);
    const card = document.createElement('div');
    card.className = `vehicle-card quality-${v.quality}`;

    // 品质标签
    const badge = v.quality === 'gold' ? '<span class="quality-badge gold-badge">传说</span>'
      : v.quality === 'blue' ? '<span class="quality-badge blue-badge">精良</span>' : '';

    const statusClass = v.status === 'idle' ? 'idle' : 'busy';
    const upgradeRemain = v.qualityUpgrade
      ? Math.max(0, Math.ceil((v.qualityUpgrade.finishAt - Date.now()) / 1000))
      : 0;
    const statusText = v.status === 'idle'
      ? '✅ 空闲'
      : v.status === 'maintenance'
        ? `⬆ 升级中 ${upgradeRemain}s`
        : '🚚 派单中';
    const traitName = getTraitName(v.trait);
    const maxLv = vehicleSys.getMaxLevel(v.quality, v.isEvolved);
    const SPEC_ICONS: Record<string, string> = { express: '⚡快车', heavy: '💪重载', steady: '🛡️稳健' };
    const specText = v.specialization ? ` · ${SPEC_ICONS[v.specialization]}` : '';
    const wearWarning = v.wear >= GAME_CONSTANTS.WEAR_PENALTY_THRESHOLD
      ? '<div style="text-align:center;color:var(--red);font-size:11px;font-weight:700;">🔧 磨损严重，收入-30%</div>'
      : '';

    card.innerHTML = `
      <span class="tier-badge">T${v.tier}</span>
      ${badge}
      <div class="emoji">${config?.emoji || '🚗'}</div>
      <div class="name">${v.name}</div>
      <div style="text-align:center;font-size:10px;color:var(--text-3);font-weight:700;">${config?.name || ''}</div>
      <div style="text-align:center;margin:4px 0;">
        Lv.${v.level}/${maxLv} ${v.isEvolved ? '🌟' : ''}
      </div>
      <div class="info">${traitName}${specText} ${v.trait === TraitType.Lucky ? '<span class="badge rare">稀有</span>' : ''}</div>
      <div class="info">💖${v.intimacy} · 📦${v.ordersCompleted}单</div>
      ${wearWarning}
      <div style="text-align:center;margin-top:4px;"><span class="status-badge ${statusClass}">${statusText}</span></div>
    `;
    card.onclick = () => showVehicleDetail(v);
    grid.appendChild(card);
  });
}

// ==================== 车辆详情弹窗 ====================

export function showVehicleDetail(v: Vehicle): void {
  const sys = getSystems();
  const config = getVehicleConfig(v.tier);
  const maxLv = sys.vehicleSys.getMaxLevel(v.quality, v.isEvolved);

  const SPEC_INFO: Record<string, { icon: string; name: string; desc: string }> = {
    express: { icon: '⚡', name: '快车', desc: '耗时 -25%，收入 -10%' },
    heavy: { icon: '💪', name: '重载', desc: '收入 +25%，耗时 +15%' },
    steady: { icon: '🛡️', name: '稳健', desc: '磨损减半，经验 +15%' },
  };
  const specLine = v.specialization
    ? `<p>🎯 专精: ${SPEC_INFO[v.specialization].icon}${SPEC_INFO[v.specialization].name}（${SPEC_INFO[v.specialization].desc}）</p>`
    : '';
  const wearColor = v.wear >= GAME_CONSTANTS.WEAR_PENALTY_THRESHOLD ? 'var(--red)' : 'var(--text-2)';
  const wearLine = `<p style="color:${wearColor};">🔧 磨损 ${Math.floor(v.wear)}/100${v.wear >= GAME_CONSTANTS.WEAR_PENALTY_THRESHOLD ? '（收入-30% 耗时+20%，快保养！）' : ''} · 😮‍💨 连单 ${v.consecutiveOrders}（越多收入越低，空闲30秒恢复）</p>`;

  const detail = `
    <p>${config?.emoji} <strong>${v.name}</strong> · T${v.tier} ${config?.name || ''}</p>
    <p>📊 Lv.${v.level}/${maxLv} | 品质: ${getQualityLabel(v.quality)}</p>
    <p>🧬 特质: ${getTraitName(v.trait)}${getTraitDesc(v.trait) ? `（${getTraitDesc(v.trait)}）` : ''} ${v.trait === TraitType.Lucky ? '🔥稀有' : ''}</p>
    ${specLine}
    <p>💖 亲密度 ${v.intimacy}/100</p>
    ${wearLine}
    <p>🏎️速度 ${v.stats.speed}/5（耗时-4%/级）· 📦载货 ${v.stats.cargo}/5（收入+4%/级）· 🔩耐久 ${v.stats.durability}/5（≥3 可接🏔️长途单）</p>
    <p>📦 ${v.ordersCompleted}单 · 🪙 ${v.totalEarnings.toLocaleString()}</p>
    <p>${v.status === 'idle' ? '✅ 空闲' : v.status === 'maintenance' ? `⬆ 品质升级中，剩余 ${Math.max(0, Math.ceil(((v.qualityUpgrade?.finishAt ?? 0) - Date.now()) / 1000))}s` : '🚚 执行订单中'}</p>
    ${v.isEvolved ? '<p style="color:var(--gold-strong);">🌟 已进化 — 获得专属天赋：' + (config?.talentDesc || '') + '</p>' : v.quality === Quality.Gold && v.level >= GAME_CONSTANTS.MAX_VEHICLE_LEVEL && v.intimacy >= GAME_CONSTANTS.INTIMACY_EVOLVE_REQUIREMENT ? '<p style="color:var(--gold-strong);font-weight:600;">✨ 可以进化！</p>' : ''}
  `;

  const buttons: (string | (() => void))[] = [];

  // ---------- 改名（随时可改，非必要流程） ----------
  buttons.push('✏️ 改名', () => {
    const taken = getState().garage.vehicles.filter(x => x.id !== v.id).map(x => x.name);
    showNamingModal(
      `✏️ 给 ${v.name} 改名`,
      v.name,
      pickRandomNames(3, taken),
      (name) => {
        sys.vehicleSys.nameVehicle(v.id, name);
        addLog(`✏️ 车辆改名为「${name}」`);
        showVehicleDetail(v);
        requestRender();
      }
    );
  });

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

  // ---------- 亲密度互动（清洗/保养/抚摸，各有冷却） ----------
  const intimacy = sys.intimacySys;
  const washCd = intimacy.getWashCooldownRemaining(v.id);
  buttons.push(washCd > 0 ? `🛁 清洗(${Math.ceil(washCd / 60)}分钟)` : `🛁 清洗 +${GAME_CONSTANTS.INTIMACY_WASH_AMOUNT}💖`, () => {
    if (intimacy.wash(v.id)) {
      addLog(`🛁 清洗了 ${v.name}，亲密度 +${GAME_CONSTANTS.INTIMACY_WASH_AMOUNT}`);
    } else {
      addLog('🛁 清洗还在冷却中');
    }
    showVehicleDetail(v); // 重开弹窗刷新冷却/数值
    requestRender();
  });

  const repairCd = intimacy.getRepairCooldownRemaining(v.id);
  buttons.push(repairCd > 0 ? `🔧 保养(${Math.ceil(repairCd / 60)}分钟)` : `🔧 保养 +${GAME_CONSTANTS.INTIMACY_REPAIR_AMOUNT}💖·修磨损(2⚙️)`, () => {
    if (intimacy.repair(v.id)) {
      addLog(`🔧 保养了 ${v.name}，亲密度提升，磨损已修复（-2⚙️）`);
    } else {
      addLog('🔧 保养冷却中或零件不足（需要 2⚙️）');
    }
    showVehicleDetail(v);
    requestRender();
  });

  const tapCd = intimacy.getTapCooldownRemaining(v.id);
  buttons.push(tapCd > 0 ? `👆 抚摸(${tapCd}秒)` : `👆 抚摸 +${GAME_CONSTANTS.INTIMACY_TAP_AMOUNT}💖`, () => {
    if (intimacy.tap(v.id)) {
      addLog(`👆 摸了摸 ${v.name}，亲密度 +${GAME_CONSTANTS.INTIMACY_TAP_AMOUNT}`);
    }
    showVehicleDetail(v);
    requestRender();
  });

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

  // ---------- 专精选择（蓝品质解锁，三选一，永久） ----------
  if (!v.specialization && (v.quality === Quality.Blue || v.quality === Quality.Gold)) {
    for (const [key, info] of Object.entries(SPEC_INFO)) {
      buttons.push(`${info.icon} 专精·${info.name}`, () => {
        if (sys.vehicleSys.specialize(v.id, key as Specialization)) {
          showToast(`${info.icon} 专精确立！`, `${v.name} 成为「${info.name}」— ${info.desc}`);
          addLog(`🎯 ${v.name} 选择了${info.name}专精（${info.desc}）`);
        }
        showVehicleDetail(v);
        requestRender();
      });
    }
  }

  // ---------- 提升品质（M7：耗时化，升级中锁车不显示按钮；M8：耗电） ----------
  if (v.quality !== Quality.Gold && !v.qualityUpgrade) {
    const upgradeTime = v.quality === Quality.White
      ? GAME_CONSTANTS.QUALITY_UPGRADE_TIME_BLUE
      : GAME_CONSTANTS.QUALITY_UPGRADE_TIME_GOLD;
    const energyCost = v.quality === Quality.White
      ? GAME_CONSTANTS.ENERGY_QUALITY_BLUE
      : GAME_CONSTANTS.ENERGY_QUALITY_GOLD;
    buttons.push(`⬆ 提升品质 (${upgradeTime}s · ${energyCost}⚡)`, () => {
      if (sys.vehicleSys.upgradeQuality(v.id)) {
        showToast('⬆ 开始升级', `${v.name} 进场升级品质，${upgradeTime} 秒后完成（期间不可派单）`);
        addLog(`⬆ ${v.name} 开始升级品质（${upgradeTime}s · -${energyCost}⚡），期间锁定不可派单`);
        hideModal();
      } else {
        addLog(`❌ 品质升级条件不足（需要空闲 + 完成订单数/金币/零件/${energyCost}⚡能源）`);
      }
      requestRender();
    });
  }

  // ---------- 进化（M8：耗 200⚡，品牌声望 +100） ----------
  if (!v.isEvolved && v.quality === Quality.Gold && v.level >= GAME_CONSTANTS.MAX_VEHICLE_LEVEL && v.intimacy >= GAME_CONSTANTS.INTIMACY_EVOLVE_REQUIREMENT) {
    buttons.push(`🌟 进化 (${GAME_CONSTANTS.ENERGY_EVOLVE}⚡)`, () => {
      if (sys.vehicleSys.evolve(v.id)) { hideModal(); }
      else { addLog(`❌ 进化失败（需要 ${GAME_CONSTANTS.ENERGY_EVOLVE}⚡能源）`); }
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
    addLog(`🔧 ${v.name} 已拆解，回收 ${result.parts}⚙️ · 🧬传承经验 +${result.inheritedExp}（下一辆新车继承）`);
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

  // 目标车型下拉：默认选中 tier+1（否则列表第一项）
  const select = document.createElement('select');
  select.className = 'dispatch-select';
  for (const c of targets) {
    const opt = document.createElement('option');
    opt.value = c.tier.toString();
    opt.textContent = `${c.emoji} T${c.tier} ${c.name}`;
    select.appendChild(opt);
  }
  select.value = (targets.find(c => c.tier === v.tier + 1) ?? targets[0]).tier.toString();
  content.appendChild(select);

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
    const newTier = parseInt(select.value, 10);
    const newConfig = getVehicleConfig(newTier)!;
    const q = sys.vehicleSys.getTradeInQuote(v.id, newTier);

    if (!q.ok) {
      quoteBox.innerHTML = `<p style="color:var(--red);font-weight:700;">❌ ${q.reason}</p>`;
      confirmBtn.textContent = '🔁 确认置换';
      confirmBtn.disabled = true;
      return;
    }

    const inheritLine = q.inheritedExp > 0 ? `（传承池 +${q.inheritedExp.toLocaleString()} 经验）` : '';
    const diffShort = q.goldDiff - state.resources.gold; // 还差多少（正数=不够）
    const diffLine = diffShort > 0
      ? `<p style="color:var(--red);font-weight:700;">💰 实际需补：-${q.goldDiff.toLocaleString()}🪙（还差 ${diffShort.toLocaleString()}🪙）</p>`
      : `<p>💰 实际需补：-${q.goldDiff.toLocaleString()}🪙</p>`;
    quoteBox.innerHTML = `
      <p>♻️ 旧车回收（${oldConfig?.emoji}${oldConfig?.name}）：+${q.scrapParts.toLocaleString()}⚙️ +${q.scrapGold.toLocaleString()}🪙${inheritLine}</p>
      <p>🏭 新车成本（${newConfig.emoji}${newConfig.name}）：-${q.buildGold.toLocaleString()}🪙 -${q.buildParts.toLocaleString()}⚙️ -${q.buildEnergy.toLocaleString()}⚡</p>
      ${diffLine}
      <p>⏱️ 建造耗时：${q.buildTime}s（建完自动进车库）</p>
    `;
    confirmBtn.textContent = diffShort > 0 ? '🔁 金币不足' : '🔁 确认置换';
    confirmBtn.disabled = diffShort > 0;
  };
  select.onchange = renderQuote;
  renderQuote();

  confirmBtn.onclick = (e) => {
    e.stopPropagation();
    const newTier = parseInt(select.value, 10);
    const newConfig = getVehicleConfig(newTier)!;
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
