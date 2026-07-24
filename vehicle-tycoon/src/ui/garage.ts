// ============================================================
// 车库 UI — 车辆卡片网格 + 车辆详情弹窗（派单/养成操作）
// ============================================================

import { Vehicle, Quality, TraitType, VehicleStats } from '../core/types';
import { getVehicleConfig } from '../config/VehicleConfig';
import { GAME_CONSTANTS, statUpgradeCost } from '../config/GameConstants';
import { getState, getSystems, requestRender } from './context';
import { getTraitName, getQualityLabel } from './format';
import { showModal, hideModal } from './modal';
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
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#555;padding:30px;font-size:14px;">🅿️ 车库是空的<br><span style="font-size:12px;">🏭工厂产⚙️ → 🔧消耗⚙️+🪙造车 → 📮跑单赚🪙</span></div>';
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

    card.innerHTML = `
      ${badge}
      <div class="emoji">${config?.emoji || '🚗'}</div>
      <div class="name">${v.name}</div>
      <div style="text-align:center;margin:4px 0;">
        Lv.${v.level}/${maxLv} ${v.isEvolved ? '🌟' : ''}
      </div>
      <div class="info">${traitName} ${v.trait === TraitType.Lucky ? '<span class="badge rare">稀有</span>' : ''}</div>
      <div class="info">💖${v.intimacy} · 📦${v.ordersCompleted}单</div>
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

  const detail = `
    <p>${config?.emoji} <strong>${v.name}</strong> · ${config?.name || 'T' + v.tier}</p>
    <p>📊 Lv.${v.level}/${maxLv} | 品质: ${getQualityLabel(v.quality)}</p>
    <p>🧬 特质: ${getTraitName(v.trait)} ${v.trait === TraitType.Lucky ? '🔥稀有' : ''}</p>
    <p>💖 亲密度 ${v.intimacy}/100</p>
    <p>🏎️速度 ${v.stats.speed}/5 · 📦载货 ${v.stats.cargo}/5 · 🔩耐久 ${v.stats.durability}/5</p>
    <p>📦 ${v.ordersCompleted}单 · 🪙 ${v.totalEarnings.toLocaleString()}</p>
    <p>${v.status === 'idle' ? '✅ 空闲' : '🚚 执行订单中'}</p>
    ${v.isEvolved ? '<p style="color:#f1c40f;">🌟 已进化 — 获得专属天赋：' + (config?.talentDesc || '') + '</p>' : v.quality === Quality.Gold && v.level >= GAME_CONSTANTS.MAX_VEHICLE_LEVEL && v.intimacy >= GAME_CONSTANTS.INTIMACY_EVOLVE_REQUIREMENT ? '<p style="color:#f1c40f;font-weight:600;">✨ 可以进化！</p>' : ''}
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
  buttons.push(repairCd > 0 ? `🔧 保养(${Math.ceil(repairCd / 60)}分钟)` : `🔧 保养 +${GAME_CONSTANTS.INTIMACY_REPAIR_AMOUNT}💖(2⚙️)`, () => {
    if (intimacy.repair(v.id)) {
      addLog(`🔧 保养了 ${v.name}，亲密度 +${GAME_CONSTANTS.INTIMACY_REPAIR_AMOUNT}（-2⚙️）`);
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
    addLog(`🔧 ${v.name} 已拆解，回收 ${result.parts}⚙️${result.inheritedTrait ? ' + 特质传承' : ''}`);
    hideModal();
    requestRender();
  });

  showModal(`${config?.emoji} ${v.name}`, [detail], ...buttons);
}
