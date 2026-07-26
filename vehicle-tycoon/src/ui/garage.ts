// ============================================================
// 车库 UI — 车辆卡片网格 + 车辆详情弹窗（派单/养成操作）
// ============================================================

import { Vehicle, Quality, TraitType, VehicleStats, Specialization } from '../core/types';
import { getVehicleConfig } from '../config/VehicleConfig';
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
    const statusText = v.status === 'idle' ? '✅ 空闲' : '🚚 派单中';
    const traitName = getTraitName(v.trait);
    const maxLv = vehicleSys.getMaxLevel(v.quality, v.isEvolved);
    const SPEC_ICONS: Record<string, string> = { express: '⚡快车', heavy: '💪重载', steady: '🛡️稳健' };
    const specText = v.specialization ? ` · ${SPEC_ICONS[v.specialization]}` : '';
    const wearWarning = v.wear >= GAME_CONSTANTS.WEAR_PENALTY_THRESHOLD
      ? '<div style="text-align:center;color:var(--red);font-size:11px;font-weight:700;">🔧 磨损严重，收入-30%</div>'
      : '';

    card.innerHTML = `
      ${badge}
      <div class="emoji">${config?.emoji || '🚗'}</div>
      <div class="name">${v.name}</div>
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
    <p>${config?.emoji} <strong>${v.name}</strong> · ${config?.name || 'T' + v.tier}</p>
    <p>📊 Lv.${v.level}/${maxLv} | 品质: ${getQualityLabel(v.quality)}</p>
    <p>🧬 特质: ${getTraitName(v.trait)}${getTraitDesc(v.trait) ? `（${getTraitDesc(v.trait)}）` : ''} ${v.trait === TraitType.Lucky ? '🔥稀有' : ''}</p>
    ${specLine}
    <p>💖 亲密度 ${v.intimacy}/100</p>
    ${wearLine}
    <p>🏎️速度 ${v.stats.speed}/5（耗时-4%/级）· 📦载货 ${v.stats.cargo}/5（收入+4%/级）· 🔩耐久 ${v.stats.durability}/5（≥3 可接🏔️长途单）</p>
    <p>📦 ${v.ordersCompleted}单 · 🪙 ${v.totalEarnings.toLocaleString()}</p>
    <p>${v.status === 'idle' ? '✅ 空闲' : '🚚 执行订单中'}</p>
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

  // ---------- 提升品质 ----------
  if (v.quality !== Quality.Gold) {
    buttons.push('⬆ 提升品质', () => {
      if (sys.vehicleSys.upgradeQuality(v.id)) {
        showToast('⬆ 品质提升！', `${v.name}: ${v.quality === 'blue' ? '⚪→🔵' : '🔵→🟡'}`);
        hideModal();
      } else {
        addLog('❌ 品质升级条件不足（需要完成订单数/金币/零件）');
      }
      requestRender();
    });
  }

  // ---------- 进化 ----------
  if (!v.isEvolved && v.quality === Quality.Gold && v.level >= GAME_CONSTANTS.MAX_VEHICLE_LEVEL && v.intimacy >= GAME_CONSTANTS.INTIMACY_EVOLVE_REQUIREMENT) {
    buttons.push('🌟 进化', () => {
      if (sys.vehicleSys.evolve(v.id)) { hideModal(); }
      else { addLog('❌ 进化失败'); }
      requestRender();
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
