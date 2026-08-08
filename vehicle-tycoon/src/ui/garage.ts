// ============================================================
// 车库 UI — 车辆卡片网格 + 车辆详情弹窗（派单/运营操作）
// ============================================================

import { Vehicle, Quality, TraitType, VehicleStats, Specialization, BuildJob } from '../core/types';
import { getVehicleConfig, getUnmetRequirements, VEHICLE_CONFIGS, getParkingSpaces, getOccupiedSpaces } from '../config/VehicleConfig';
import { GAME_CONSTANTS, statUpgradeCost, getBreakinBonus, getMileageLifespan,
  cargoIncomeMult, speedDurationMult, durabilityWearReduction } from '../config/GameConstants';
import { getState, getSystems, requestRender } from './context';
import { getTraitName, getTraitDesc, getQualityLabel } from './format';
import { getUpgradeMult } from '../systems/UpgradeSystem';
import { getSellPrice } from '../systems/VehicleSystem';
import { hideModal } from './modal';
import { renderPills, PillOption } from './pills';import { showToast } from './toast';
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

/** 车位格列数：与容量设计同源（容量 = 行数 × 列数，5 列 × 4 行 = 20 格上限），CSS 列数由 renderGarage 同步 */
const LOT_COLS = GAME_CONSTANTS.GARAGE_LOT_COLS;

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
  // 车库标题（S2a 占格数口径）：现有车辆 + 建造队列预留 / 容量（与容量判定同一数据源）
  const used = getOccupiedSpaces(s);
  document.getElementById('garage-count')!.textContent = used.toString();
  document.getElementById('garage-max')!.textContent = `${s.garage.maxCapacity}格`;

  const grid = document.getElementById('garage-grid')!;
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = `repeat(${LOT_COLS}, minmax(0, var(--slot-w)))`;

  const vehicles = s.garage.vehicles;
  const queue = s.garage.buildQueue;

  // 行打包（first-fit）：每辆车/每个空位放进最早能容纳它的行。
  // 大车顶出的零碎位置留空背景，不画空位框——虚线框只代表真实可用容量，绝不虚报。
  const rowsRemaining: number[] = [];
  const place = (span: number): { row: number; col: number } => {
    for (let r = 0; r < rowsRemaining.length; r++) {
      if (rowsRemaining[r] >= span) {
        const col = LOT_COLS - rowsRemaining[r] + 1;
        rowsRemaining[r] -= span;
        return { row: r + 1, col };
      }
    }
    rowsRemaining.push(LOT_COLS - span);
    return { row: rowsRemaining.length, col: 1 };
  };

  if (vehicles.length === 0 && queue.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'garage-empty';
    msg.style.gridRow = '1';
    msg.innerHTML = '🅿️ 车库是空的<br><span>🏭工厂产⚙️ → 🔧消耗⚙️+🪙造车 → 📮跑单赚🪙</span>';
    grid.appendChild(msg);
    rowsRemaining.push(0); // 第 1 行被提示语占满，空位从第 2 行开始
  } else {
    for (const v of vehicles) {
      const span = getParkingSpaces(v.tier);
      const { row, col } = place(span);
      const card = createVehicleCard(v, col, span);
      card.style.gridRow = `${row}`;
      grid.appendChild(card);
    }

    // 建造队列占位（预留未来车位，与容量判定同口径）：施工中/排队中卡片直接可见
    for (let i = 0; i < queue.length; i++) {
      const j = queue[i];
      const span = getParkingSpaces(j.tier);
      const { row, col } = place(span);
      const card = createBuildingCard(j, i === 0, col, span);
      card.style.gridRow = `${row}`;
      grid.appendChild(card);
    }
  }

  // 真实空车位 = 容量 - 已占用（含建造队列预留），编号与标题计数同一口径
  const free = s.garage.maxCapacity - used;
  for (let i = 0; i < free; i++) {
    const { row, col } = place(1);
    const slot = createParkingSlot(used + 1 + i, col);
    slot.style.gridRow = `${row}`;
    grid.appendChild(slot);
  }
}

/** 建造队列占位卡：虚线施工中样式，占格与容量判定同口径；竣工后自动换成实车 */
function createBuildingCard(j: BuildJob, isActive: boolean, col: number, span: number): HTMLElement {
  const cfg = getVehicleConfig(j.tier);
  const card = document.createElement('div');
  card.className = `vehicle-card building span-${span}`;
  card.style.gridColumn = `${col} / ${col + span}`;
  const remain = Math.max(0, Math.ceil((j.finishAt - Date.now()) / 1000));
  card.innerHTML = `
    <div class="emoji">${cfg?.emoji || '🚗'}</div>
    <div class="name">${cfg?.name ?? 'T' + j.tier}</div>
    <div class="card-line">${isActive ? `🔨 建造中 ${remain}s` : '📋 排队中'}</div>
  `;
  card.title = '已预留车位，竣工后自动入库';
  return card;
}

/** 车辆迷你卡片：大图标 + 名称 + 单行摘要（里程/残值）+ 属性芯片 + 状态圆点；详情进弹窗 */
function createVehicleCard(v: Vehicle, col: number, span: number): HTMLElement {
  const s = getState();
  const vehicleSys = getSystems().vehicleSys;
  const config = getVehicleConfig(v.tier);
  const card = document.createElement('div');
  card.className = `vehicle-card quality-${v.quality} span-${span}`;
  card.style.gridColumn = `${col} / ${col + span}`;
  card.dataset.vid = v.id; // 跳金币定位用（订单完成时在卡片上飘收益）

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

  // 属性芯片：养成结果直接可见（0 级灰显，满级金色）；有运营配置追加图标
  const MAXLV = GAME_CONSTANTS.STAT_MAX_LEVEL;
  const chip = (emoji: string, lv: number, title: string): string =>
    `<span class="chip${lv >= MAXLV ? ' max' : lv === 0 ? ' zero' : ''}" title="${title}">${emoji}${lv}</span>`;
  const SPEC_ICONS: Record<string, string> = { express: '⚡', heavy: '💪', steady: '🛡️' };
  const specChip = v.specialization
    ? `<span class="chip spec" title="运营配置">${SPEC_ICONS[v.specialization] ?? ''}</span>` : '';
  const statChips = `<div class="stat-chips">${
    chip('🏎️', v.stats.speed, '速度：耗时减免')}${
    chip('📦', v.stats.cargo, '载货：收入加成')}${
    chip('🔩', v.stats.durability, '耐久：磨损减免')}${specChip}</div>`;

  card.innerHTML = `
    <span class="tier-badge">T${v.tier}</span>
    ${badge}
    <div class="emoji">${config?.emoji || '🚗'}</div>
    <div class="name">${v.name}</div>
    <div class="card-line ${lowResidual ? 'residual-low' : ''}" title="里程 / 当前残值">🛞 ${fmtMileage(v.mileage)} · 💰 ${fmtMoney(residual)}</div>
    ${statChips}
    <span class="status-dot ${dotClass}" title="${statusText}"></span>
  `;
  card.onclick = () => showVehicleDetail(v);
  return card;
}

// ==================== 车辆详情弹窗 ====================

interface VdAction { label: string; cb: () => void; cls?: string }

export function showVehicleDetail(v: Vehicle): void {
  const sys = getSystems();
  const s = getState();
  const config = getVehicleConfig(v.tier);

  const SPEC_INFO: Record<string, { icon: string; name: string; desc: string }> = {
    express: { icon: '⚡', name: '快运', desc: '耗时 -25%，收入 -10%' },
    heavy: { icon: '💪', name: '重载', desc: '收入 +25%，耗时 +15%' },
    steady: { icon: '🛡️', name: '耐用', desc: '磨损减半，磨合增速 +15%' },
  };

  // ---------- 数据 ----------
  const lifespan = getMileageLifespan(v.tier, v.stats.durability);
  const mileagePct = Math.min(100, Math.round((v.mileage / lifespan) * 100));
  const breakinPct = Math.round(getBreakinBonus(v.mileage) * 100);
  const ageMin = Math.max(0, Math.floor((Date.now() - v.createdAt) / 60000));
  const residual = sys.vehicleSys.getResidual(v.id);
  const paidCost = Math.floor((config?.buildCost ?? 0) * getUpgradeMult(s, 'build_cost'));
  const lowResidual = paidCost > 0 && residual < paidCost * 0.2;
  const wearHigh = v.wear >= GAME_CONSTANTS.WEAR_PENALTY_THRESHOLD;
  const traitDesc = getTraitDesc(v.trait);
  const spec = v.specialization ? SPEC_INFO[v.specialization] : undefined;

  const statusText = v.status === 'idle'
    ? '✅ 空闲'
    : v.status === 'maintenance'
      ? `⬆ 升级中 ${Math.max(0, Math.ceil(((v.qualityUpgrade?.finishAt ?? 0) - Date.now()) / 1000))}s`
      : '🚚 派单中';
  const statusCls = v.status === 'idle' ? 'idle' : v.status === 'maintenance' ? 'maintenance' : 'busy';

  // ---------- 结构：车辆展台 + 属性强化/规格晋升/运营配置（参考无尽冬日养成：行内升级） ----------
  const overlay = document.getElementById('modal-overlay')!;
  const content = document.getElementById('modal-content')!;
  content.classList.add('modal-vd');

  // 规格 → 星级（WOS 稀有度语言：⚪★ / 🔵★★ / 🟡★★★）
  const qualityStars = (q: Quality): string => {
    const n = q === Quality.Gold ? 3 : q === Quality.Blue ? 2 : 1;
    return '★'.repeat(n) + `<span class="off">${'★'.repeat(3 - n)}</span>`;
  };

  content.innerHTML = `
    <div class="vd-stage">
      <div class="vd-vehicle">${config?.emoji ?? '🚗'}</div>
      <div class="vd-lift"></div>
      <div class="vd-nameplate">
        <div class="vd-name">${v.name}</div>
        <div class="vd-meta">T${v.tier} ${config?.name ?? ''} · ${getQualityLabel(v.quality)} · 占${getParkingSpaces(v.tier)}格 · <span class="status-badge ${statusCls}">${statusText}</span></div>
        <div class="vd-stars">${qualityStars(v.quality)}</div>
        <div class="vd-chips">
          <span class="chip${v.trait === TraitType.Lucky ? ' lucky' : ''}" title="${traitDesc ?? ''}">🧬 ${getTraitName(v.trait)}${v.trait === TraitType.Lucky ? ' 🔥' : ''}</span>
          ${spec ? `<span class="chip spec">${spec.icon} ${spec.name}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="vd-sec">
      <div class="vd-sec-title">💪 属性强化</div>
      <div id="vd-stat-rows"></div>
    </div>
    <div class="vd-sec">
      <div class="vd-sec-title">⭐ 规格晋升</div>
      <div id="vd-quality-box"></div>
    </div>
    <div class="vd-sec">
      <div class="vd-sec-title">🎯 运营配置${spec ? '（已确立，永久生效）' : v.quality === Quality.White ? '（🔵 标准型解锁）' : '（三选一，永久）'}</div>
      <div class="vd-spec-slots" id="vd-spec-slots"></div>
    </div>
    <div class="vd-sec">
      <div class="vd-sec-title">📁 资产档案</div>
      <div class="vd-row"><span>🛞 里程 / 寿命</span><b>${fmtMileage(v.mileage)} / ${fmtMileage(lifespan)} km</b></div>
      <div class="vd-bar"><div style="width:${mileagePct}%"></div></div>
      <div class="vd-row"><span>💰 当前残值${lowResidual ? ' ⬇高折旧' : ''}</span><b class="${lowResidual ? 'warn' : ''}">${residual.toLocaleString()}🪙 / 实付 ${paidCost.toLocaleString()}</b></div>
      <div class="vd-row"><span>⏱️ 车龄 · 磨合 · 翻新</span><b>${ageMin}分钟 · +${breakinPct}% · ${v.refurbishCount}/${GAME_CONSTANTS.REFURBISH_MAX_COUNT}次</b></div>
      <div class="vd-row"><span>🔧 磨损${wearHigh ? '（收入-30% 耗时+20%）' : ''}</span><b class="${wearHigh ? 'warn' : ''}">${Math.floor(v.wear)}/100</b></div>
      <div class="vd-row"><span>😮‍💨 连单 · 战绩</span><b>${v.consecutiveOrders}连单 · ${v.ordersCompleted}单 · ${v.totalEarnings.toLocaleString()}🪙</b></div>
    </div>
  `;

  // ---------- 属性强化行：pips（L3/L5 断点高亮）+ 当前效果 → 下一级预览 + 行内升级按钮 ----------
  const pipsOf = (lv: number): string =>
    Array.from({ length: GAME_CONSTANTS.STAT_MAX_LEVEL }, (_, i) =>
      `<span class="${i + 1 === 3 || i + 1 === 5 ? 'bp' : ''}">${i < lv ? '●' : '○'}</span>`).join('');
  const statRows: Array<{
    key: keyof VehicleStats; emoji: string; name: string;
    effect: (lv: number) => string; marks: string;
  }> = [
    { key: 'speed', emoji: '🏎️', name: '速度',
      effect: lv => `耗时 -${Math.round((1 - speedDurationMult(lv)) * 100)}%`,
      marks: 'L3 疲劳减半 · L5 免速度电费' },
    { key: 'cargo', emoji: '📦', name: '载货',
      effect: lv => `收入 +${Math.round((cargoIncomeMult(lv) - 1) * 100)}%`,
      marks: 'L3 贵重单+15% · L5 暴击+5%' },
    { key: 'durability', emoji: '🔩', name: '耐久',
      effect: lv => `磨损 -${Math.round(durabilityWearReduction(lv) * 100)}%`,
      marks: 'L3 可接🏔️长途单 · L5 寿命+25%' },
  ];
  const rowsBox = content.querySelector('#vd-stat-rows')!;
  for (const sd of statRows) {
    const lv = v.stats[sd.key];
    const maxed = lv >= GAME_CONSTANTS.STAT_MAX_LEVEL;
    const row = document.createElement('div');
    row.className = 'vd-stat-row';
    row.innerHTML = `
      <span class="sr-icon">${sd.emoji}</span>
      <div class="sr-mid">
        <div class="sr-name">${sd.name}<span class="sr-pips">${pipsOf(lv)}</span></div>
        <div class="sr-effect">${sd.effect(lv)}${maxed ? '' : ` <span class="vd-next">→ ${sd.effect(lv + 1)}</span>`}</div>
        <div class="sr-marks">${sd.marks}</div>
      </div>
    `;
    const btn = document.createElement('button');
    if (maxed) {
      btn.className = 'up-btn max';
      btn.innerHTML = 'MAX';
    } else {
      const cost = statUpgradeCost(lv);
      const cant = s.resources.gold < cost;
      btn.className = `up-btn${cant ? ' cant' : ''}`;
      btn.innerHTML = `⬆ 升级<span class="cost">${cost.toLocaleString()}🪙</span>`;
      btn.onclick = (e) => {
        e.stopPropagation();
        if (sys.vehicleSys.upgradeStat(v.id, sd.key)) {
          addLog(`${sd.emoji} ${v.name} ${sd.name}升到 ${lv + 1} 级（-${cost}🪙）`);
        } else {
          addLog(`❌ 金币不足，升级需要 ${cost}🪙`);
        }
        showVehicleDetail(v);
        requestRender();
      };
    }
    row.appendChild(btn);
    rowsBox.appendChild(row);
  }

  // ---------- 规格晋升（WOS 升星面板：当前星级 → 下一星级 + 消耗；升级中显示进度条） ----------
  const qBox = content.querySelector('#vd-quality-box')!;
  if (v.qualityUpgrade) {
    const q = v.qualityUpgrade;
    const progress = Math.min(1, Math.max(0, 1 - (q.finishAt - Date.now()) / (q.totalTime * 1000)));
    qBox.innerHTML = `
      <div class="vd-quality-row"><span class="upgrading">⬆ 升级中… ${Math.round(progress * 100)}%（期间锁定不可派单）</span></div>
      <div class="vd-bar" style="margin-top:4px;"><div style="width:${Math.round(progress * 100)}%;background:var(--purple);"></div></div>
    `;
  } else if (v.quality === Quality.Gold) {
    qBox.innerHTML = `<div class="vd-quality-row">🟡 工业型 <span class="vd-stars">★★★</span> 已达最高规格</div>`;
  } else {
    const nextLabel = v.quality === Quality.White ? '🔵 标准型 ★★' : '🟡 工业型 ★★★';
    const upgradeTime = v.quality === Quality.White
      ? GAME_CONSTANTS.QUALITY_UPGRADE_TIME_BLUE : GAME_CONSTANTS.QUALITY_UPGRADE_TIME_GOLD;
    const energyCost = v.quality === Quality.White
      ? GAME_CONSTANTS.ENERGY_QUALITY_BLUE : GAME_CONSTANTS.ENERGY_QUALITY_GOLD;
    qBox.innerHTML = `
      <div class="vd-quality-row">${getQualityLabel(v.quality)} <span class="arrow">→</span> ${nextLabel}</div>
    `;
    const btn = document.createElement('button');
    btn.className = 'up-btn';
    btn.style.cssText = 'width:100%;margin-top:5px;flex-direction:row;justify-content:center;gap:6px;';
    btn.innerHTML = `⬆ 升级规格<span class="cost">${upgradeTime}s · ${energyCost}⚡</span>`;
    btn.onclick = (e) => {
      e.stopPropagation();
      if (sys.vehicleSys.upgradeQuality(v.id)) {
        showToast('⬆ 开始升级', `${v.name} 进场升级规格，${upgradeTime} 秒后完成（期间不可派单）`);
        addLog(`⬆ ${v.name} 开始升级规格（${upgradeTime}s · -${energyCost}⚡），期间锁定不可派单`);
        hideModal();
      } else {
        addLog(`❌ 规格升级条件不足（需要空闲 + 完成订单数/金币/零件/${energyCost}⚡能源）`);
      }
      requestRender();
    };
    qBox.appendChild(btn);
  }

  // ---------- 运营配置槽（技能槽三选一；已确立的置灰锁定） ----------
  const slotsBox = content.querySelector('#vd-spec-slots')!;
  const specPickable = !v.specialization && (v.quality === Quality.Blue || v.quality === Quality.Gold);
  for (const [key, info] of Object.entries(SPEC_INFO)) {
    const slot = document.createElement('button');
    const selected = v.specialization === key;
    slot.className = `spec-slot${selected ? ' selected' : specPickable ? '' : ' locked'}`;
    slot.innerHTML = `<span class="ss-icon">${info.icon}</span><b>${info.name}</b><i>${info.desc}</i>`;
    if (specPickable && !selected) {
      slot.onclick = (e) => {
        e.stopPropagation();
        if (sys.vehicleSys.specialize(v.id, key as Specialization)) {
          showToast(`${info.icon} 运营配置确立！`, `${v.name} 成为「${info.name}」— ${info.desc}`);
          addLog(`🎯 ${v.name} 选择了${info.name}运营配置（${info.desc}）`);
        }
        showVehicleDetail(v);
        requestRender();
      };
    }
    slotsBox.appendChild(slot);
  }

  // ---------- 操作按钮（按用途分组：运营操作 / 资产处置） ----------
  const ops: VdAction[] = [];
  const assets: VdAction[] = [];

  // 派单
  if (v.status === 'idle') {
    ops.push({ label: '📮 派单', cls: 'primary', cb: () => {
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
    } });
  }

  // 检修（消耗零件，只清磨损，有冷却；S2a 成本随里程浮动）
  const overhaulCd = sys.vehicleSys.getOverhaulCooldownRemaining(v.id);
  const overhaulCost = sys.vehicleSys.getOverhaulCost(v.id);
  ops.push({
    label: overhaulCd > 0 ? `🔧 检修(${Math.ceil(overhaulCd / 60)}分钟)` : `🔧 检修·清磨损(${overhaulCost}⚙️)`,
    cb: () => {
      if (sys.vehicleSys.overhaul(v.id)) {
        addLog(`🔧 检修了 ${v.name}，磨损已清零（-${overhaulCost}⚙️）`);
      } else {
        addLog(`🔧 检修冷却中或零件不足（需要 ${overhaulCost}⚙️）`);
      }
      showVehicleDetail(v); // 重开弹窗刷新冷却/数值
      requestRender();
    },
  });

  // 翻新（S2a：磨损清零 + 里程×0.4 折旧回春，每车限 2 次）
  if (v.status === 'idle' && v.refurbishCount < GAME_CONSTANTS.REFURBISH_MAX_COUNT) {
    const rc = sys.vehicleSys.getRefurbishCost(v.id);
    if (rc) {
      ops.push({ label: `✨ 翻新 (${rc.gold.toLocaleString()}🪙+${rc.parts}⚙️ · ${v.refurbishCount}/${GAME_CONSTANTS.REFURBISH_MAX_COUNT})`, cb: () => {
        if (sys.vehicleSys.refurbish(v.id)) {
          addLog(`✨ 翻新了 ${v.name}：磨损清零，里程回春（-${rc.gold.toLocaleString()}🪙 -${rc.parts}⚙️）`);
          showToast('✨ 翻新完成', `${v.name} 折旧回春，残值回升`);
        } else {
          addLog(`❌ 翻新条件不足（需空闲 + ${rc.gold.toLocaleString()}🪙 + ${rc.parts}⚙️）`);
        }
        showVehicleDetail(v);
        requestRender();
      } });
    }
  }

  // 出售（S2a：残值金币，无零件；与拆解二选一）
  if (v.status === 'idle') {
    const sellPrice = getSellPrice(getState(), v);
    assets.push({ label: `💰 出售 (+${sellPrice.toLocaleString()}🪙)`, cls: 'gold', cb: () => {
      const got = sys.vehicleSys.sellVehicle(v.id);
      if (got > 0) {
        addLog(`💰 出售了 ${v.name}，回收残值 +${got.toLocaleString()}🪙`);
        hideModal();
      } else {
        addLog(`❌ 出售失败（车辆不存在或正在派单）`);
      }
      requestRender();
    } });
    // 以旧换新（Idle 可用：拆解回收 + 新车入队一次完成）
    assets.push({ label: '🔁 以旧换新', cls: 'gold', cb: () => { showTradeInModal(v); } });
  }

  // 拆解
  assets.push({ label: '🗑️ 拆解', cls: 'danger', cb: () => {
    const result = sys.vehicleSys.scrapVehicle(v.id);
    addLog(`🔧 ${v.name} 已拆解，回收 ${result.parts}⚙️ + ${result.gold.toLocaleString()}🪙（残值口径）`);
    hideModal();
    requestRender();
  } });

  // ---------- 渲染按钮 ----------
  const mkBtn = (a: VdAction): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = a.label;
    if (a.cls) b.className = a.cls;
    b.onclick = (e) => { e.stopPropagation(); a.cb(); };
    return b;
  };

  if (ops.length > 0) {
    const opsGrid = document.createElement('div');
    opsGrid.className = 'vd-actions';
    ops.forEach(a => opsGrid.appendChild(mkBtn(a)));
    content.appendChild(opsGrid);
  }

  const assetSec = document.createElement('div');
  assetSec.className = 'vd-sec';
  assetSec.innerHTML = '<div class="vd-sec-title">💼 资产处置</div>';
  const assetGrid = document.createElement('div');
  assetGrid.className = 'vd-actions';
  assets.forEach(a => assetGrid.appendChild(mkBtn(a)));
  assetSec.appendChild(assetGrid);
  content.appendChild(assetSec);

  const closeRow = document.createElement('div');
  closeRow.className = 'vd-actions vd-close';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '关闭';
  closeBtn.className = 'span2';
  closeBtn.onclick = (e) => { e.stopPropagation(); hideModal(); };
  closeRow.appendChild(closeBtn);
  content.appendChild(closeRow);

  overlay.classList.add('visible');
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
