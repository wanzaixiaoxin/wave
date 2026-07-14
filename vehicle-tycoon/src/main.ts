// ============================================================
// 造物运输大亨 — 运行入口（v1.1 体验优化版）
// ============================================================

import { GameLoop } from './core/GameLoop';
import { EventBus } from './core/EventBus';
import { SaveManager } from './core/SaveManager';
import { GameEvent, GameState, Vehicle, Order, Quality, VehicleStatus, TraitType } from './core/types';
import { getVehicleConfig, getUnlockedConfigs } from './config/VehicleConfig';
import { getTraitConfig } from './config/TraitConfig';
import { GAME_CONSTANTS } from './config/GameConstants';

// ==================== 状态 ====================

let gameLoop: GameLoop;
let currentTab = 'garage';
let logMessages: string[] = [];
let toastIdCounter = 0;

function getState(): GameState {
  return gameLoop.getState();
}

// ==================== 启动 ====================

function init(): void {
  const saved = SaveManager.load();
  if (saved) {
    const state = SaveManager.createInitialState();
    Object.assign(state, saved);
    const offlineSeconds = Math.floor((Date.now() - saved.timestamp) / 1000);
    gameLoop = new GameLoop(state);
    if (offlineSeconds > 10) {
      gameLoop.handleOfflineReturn(offlineSeconds);
      addLog(`📥 离线 ${Math.floor(offlineSeconds / 60)} 分钟归来，产线已自动收获`);
    }
  } else {
    gameLoop = new GameLoop(SaveManager.createInitialState());
    addLog('🚗 欢迎来到造物运输大亨！');
    addLog('💡 点击「🔧 造车」按钮造你的第一辆独轮车');
    // 首次进入引导
    setTimeout(() => {
      const btn = document.getElementById('btn-build');
      if (btn) btn.innerHTML = '🔧 造车 <span class="tutorial-arrow">👉</span>';
      setTimeout(() => {
        const btn2 = document.getElementById('btn-build');
        if (btn2) btn2.innerHTML = '🔧 造车';
      }, 6000);
    }, 500);
  }

  bindEvents();
  bindUI();
  gameLoop.start();
  renderLoop();
}

// ==================== 飘字动画 ====================

function showFloatingGold(amount: number, isCrit = false): void {
  const el = document.createElement('div');
  el.className = 'gold-float';
  el.textContent = `+${amount}🪙`;
  el.style.left = `${40 + Math.random() * 20}%`;
  el.style.top = '45%';
  if (isCrit) {
    el.style.fontSize = '36px';
    el.style.color = '#e94560';
    el.textContent = `💥 ×${amount > 500 ? '3' : '2'}! +${amount}🪙`;
  }
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

function showCritEffect(mult: number): void {
  const el = document.createElement('div');
  el.className = 'crit-effect';
  el.textContent = `💥 暴击！×${mult}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

function goldBounce(): void {
  const el = document.getElementById('gold');
  if (!el) return;
  el.classList.remove('gold-bounce');
  void el.offsetWidth; // 触发 reflow
  el.classList.add('gold-bounce');
}

// ==================== Toast 通知 ====================

function showToast(title: string, body = '', type = 'default'): void {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const id = `toast-${toastIdCounter++}`;
  const div = document.createElement('div');
  div.id = id;
  div.className = 'toast';
  div.innerHTML = `<div class="toast-title">${title}</div>${body ? `<div class="toast-body">${body}</div>` : ''}`;

  container.appendChild(div);

  // 如果超过 3 条，移除最早的
  while (container.children.length > 3) {
    const first = container.firstChild as HTMLElement;
    if (first) first.remove();
  }

  setTimeout(() => {
    div.classList.add('removing');
    setTimeout(() => div.remove(), 350);
  }, 3000);
}

// ==================== 事件监听 ====================

function bindEvents(): void {
  const events = [
    GameEvent.VEHICLE_PRODUCED, GameEvent.VEHICLE_LEVEL_UP,
    GameEvent.VEHICLE_EVOLVED, GameEvent.VEHICLE_RETIRED,
    GameEvent.ORDER_COMPLETED, GameEvent.ACHIEVEMENT_UNLOCKED,
    GameEvent.GARAGE_EXPANDED, GameEvent.FACTORY_UPGRADED,
    GameEvent.TECH_RESEARCHED, GameEvent.RANDOM_EVENT_TRIGGERED,
    GameEvent.OFFLINE_EARNINGS,
  ];

  events.forEach(e => EventBus.on(e, (...args: unknown[]) => {
    switch (e) {
      case GameEvent.ORDER_COMPLETED: {
        const o = args[0] as Order;
        const v = args[1] as Vehicle | undefined;
        const name = v ? v.name : '车辆';
        showFloatingGold(o.baseReward);
        goldBounce();
        showToast(`✅ ${name} 完成订单`, `+${o.baseReward}🪙 +${o.expReward}经验`);
        addLog(`✅ ${name} 完成订单 +${o.baseReward}🪙`);
        break;
      }
      case GameEvent.VEHICLE_PRODUCED: {
        const v = args[0] as Vehicle;
        const cfg = getVehicleConfig(v.tier);
        addLog(`🚗 新车出厂！${cfg?.emoji} ${v.name} [${getTraitName(v.trait)}]`);
        showToast(`🚗 新车出厂！`, `${cfg?.emoji} ${v.name} · ${getTraitName(v.trait)}`);
        showModal(`${cfg?.emoji} ${v.name}`, [
          `品质: ${v.quality === 'gold' ? '🟡传说' : v.quality === 'blue' ? '🔵精良' : '⚪白板'}`,
          `特质: ${getTraitName(v.trait)} ${v.trait === TraitType.Lucky ? '🔥稀有' : ''}`,
          '',
          '给它起个名字吧！',
        ], '✏️ 取名', () => {
          const name = prompt('给这辆车起个名字：', v.name);
          if (name) gameLoop.getSystems().vehicleSys.nameVehicle(v.id, name);
        });
        setTimeout(() => addLog('💡 等几秒订单刷新后，点击「派车」让它去赚钱'), 2000);
        break;
      }
      case GameEvent.VEHICLE_LEVEL_UP: {
        const v = args[0] as Vehicle;
        showToast(`⬆ ${v.name} 升级！`, `现在 Lv.${v.level}，收入提升`);
        addLog(`⬆ ${v.name} 升到 Lv.${v.level}！`);
        break;
      }
      case GameEvent.VEHICLE_EVOLVED: {
        const v = args[0] as Vehicle;
        showToast('🌟 进化成功！', `${v.name} 形态蜕变，收入暴增！`);
        addLog(`🌟 ${v.name} 进化了！`);
        showModal('🌟 进化成功！', [`${v.name} 完成了形态蜕变！`, '收入大幅提升，获得专属天赋']);
        break;
      }
      case GameEvent.RANDOM_EVENT_TRIGGERED: {
        const evt = args[0] as { name: string; description: string };
        showToast(`🎲 ${evt.name}`, evt.description);
        addLog(`🎲 ${evt.name}: ${evt.description}`);
        break;
      }
      case GameEvent.ACHIEVEMENT_UNLOCKED: {
        const a = args[0] as { name: string };
        showToast('🏆 成就解锁！', a.name);
        addLog(`🏆 成就解锁: ${a.name}`);
        showModal('🏆 成就解锁！', [a.name]);
        break;
      }
      case GameEvent.GARAGE_EXPANDED: {
        addLog(`🏠 车库扩建完成！容量 +2`);
        break;
      }
      case GameEvent.FACTORY_UPGRADED: {
        addLog(`🏭 工厂升级！`);
        break;
      }
      case GameEvent.TECH_RESEARCHED: {
        addLog(`🔬 科技研究完成！新车型已解锁`);
        showToast('🔬 科技研究完成', '新车型已解锁，快去造车吧！');
        break;
      }
    }
  }));
}

function getTraitName(trait: TraitType | null): string {
  if (!trait) return '无';
  const tc = getTraitConfig(trait);
  return tc ? tc.name : trait;
}

// ==================== UI 绑定 ====================

function bindUI(): void {
  document.getElementById('btn-build')!.onclick = () => {
    const tier = parseInt((document.getElementById('build-tier-select') as HTMLSelectElement).value);
    const s = getState();
    const cfg = getVehicleConfig(tier);
    if (!cfg) return;

    const unlocked = getUnlockedConfigs(s.techTree.currentLevel, s.techTree.producedCount);
    if (!unlocked.find(c => c.tier === tier)) {
      addLog(`❌ T${tier} ${cfg.name} 还未解锁（需要先在🔬科技树中研究）`);
      return;
    }
    if (s.garage.vehicles.length >= s.garage.maxCapacity) {
      addLog(`❌ 车库已满（${s.garage.maxCapacity} 格），请先扩建或送走一辆车`);
      return;
    }
    if (s.resources.gold < cfg.buildCost) {
      addLog(`❌ 金币不足！需要 ${cfg.buildCost}🪙，当前 ${s.resources.gold}🪙`);
      return;
    }
    if (s.resources.parts < cfg.partsCost) {
      addLog(`❌ 零件不足！需要 ${cfg.partsCost}⚙️`);
      return;
    }

    const result = gameLoop.getSystems().vehicleSys.createVehicle(tier);
    if (result) {
      addLog(`🔧 造了一辆 ${cfg.emoji}${cfg.name}，花费 ${cfg.buildCost}🪙`);
    }
  };

  document.getElementById('btn-expand')!.onclick = () => {
    const ec = gameLoop.getSystems().economySys as any;
    if (ec.expandGarage()) {
      addLog('🏠 车库扩建完成！+2 车位');
    } else {
      const state = getState();
      if (state.garage.maxCapacity >= GAME_CONSTANTS.GARAGE_MAX_CAPACITY) {
        addLog('🏠 车库已到最大容量（12 格）');
      } else {
        addLog(`❌ 金币不足，扩建需要 ${ec.getNextExpandCost?.() ?? '?'}🪙`);
      }
    }
  };

  document.querySelectorAll('#bottombar button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#bottombar button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('visible'));
      const tab = btn.getAttribute('data-tab')!;
      currentTab = tab;
      const panel = document.getElementById('panel-' + tab);
      if (panel) panel.classList.add('visible');
    });
  });

  // 顶栏车辆状态图标点击切回车库
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('#vehicle-status-icons')) {
      document.querySelectorAll('#bottombar button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('visible'));
      const garageBtn = document.querySelector('[data-tab="garage"]') as HTMLElement;
      if (garageBtn) { garageBtn.classList.add('active'); currentTab = 'garage'; }
    }
  });

  document.getElementById('btn-start-prod')!.onclick = () => {
    const tier = parseInt((document.getElementById('prod-tier-select') as HTMLSelectElement).value);
    const line = gameLoop.getSystems().factorySys.getIdleLines()[0];
    if (line) {
      if (gameLoop.getSystems().factorySys.startProduction(tier, line.index)) {
        addLog(`🏭 产线开始生产 T${tier}`);
      } else {
        addLog('❌ 生产失败：金币或零件不足');
      }
    } else {
      addLog('⚠️ 所有产线都在生产中');
    }
  };

  document.getElementById('btn-upgrade-factory')!.onclick = () => {
    const fs = gameLoop.getSystems().factorySys;
    if ((fs as any).upgradeFactory()) {
      addLog('🏭 工厂升级成功！');
    } else {
      addLog('❌ 升级失败：金币不足或已达上限');
    }
  };
}

// ==================== 渲染循环 ====================

function renderLoop(): void {
  renderTopBar();
  renderGarage();
  renderOrders();
  renderFactory();
  renderTech();
  renderAchievements();
  updateStatusIcons();
  requestAnimationFrame(renderLoop);
}

function renderTopBar(): void {
  const s = getState();
  document.getElementById('gold')!.textContent = s.resources.gold.toLocaleString();
  document.getElementById('parts')!.textContent = s.resources.parts.toLocaleString();
  document.getElementById('intimacy-sum')!.textContent =
    s.garage.vehicles.reduce((sum, v) => sum + v.intimacy, 0).toString();

  const highestTier = s.garage.vehicles.length > 0
    ? Math.max(...s.garage.vehicles.map(v => v.tier)) : 1;
  const emojis = ['', '🛴', '🚲', '🐴', '🚗', '🚛', '🚂', '🚢', '✈️', '🚀', '🛸'];
  document.getElementById('tier-label')!.textContent = `${emojis[highestTier] || '🛴'} T${highestTier}`;

  const ec = gameLoop.getSystems().economySys as any;
  document.getElementById('eps')!.textContent = `${ec.getEstimatedEPS?.() ?? 0}/s`;
}

function updateStatusIcons(): void {
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

// ==================== 车库渲染 ====================

function renderGarage(): void {
  const s = getState();
  document.getElementById('garage-count')!.textContent = s.garage.vehicles.length.toString();
  document.getElementById('garage-max')!.textContent = s.garage.maxCapacity.toString();

  const grid = document.getElementById('garage-grid')!;
  grid.innerHTML = '';

  if (s.garage.vehicles.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#555;padding:30px;font-size:14px;">🅿️ 车库是空的<br><span style="font-size:12px;">点击「🔧 造车」造你的第一辆车</span></div>';
    return;
  }

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

    card.innerHTML = `
      ${badge}
      <div class="emoji">${config?.emoji || '🚗'}</div>
      <div class="name">${v.name}</div>
      <div style="text-align:center;margin:4px 0;">
        Lv.${v.level}/10 ${v.isEvolved ? '🌟' : ''}
      </div>
      <div class="info">${traitName} ${v.trait === TraitType.Lucky ? '<span class="badge rare">稀有</span>' : ''}</div>
      <div class="info">💖${v.intimacy} · 📦${v.ordersCompleted}单</div>
      <div style="text-align:center;margin-top:4px;"><span class="status-badge ${statusClass}">${statusText}</span></div>
    `;
    card.onclick = () => showVehicleDetail(v);
    grid.appendChild(card);
  });
}

function showVehicleDetail(v: Vehicle): void {
  const sys = gameLoop.getSystems();
  const config = getVehicleConfig(v.tier);

  let detail = `
    <p>${config?.emoji} <strong>${v.name}</strong> · ${config?.name || 'T' + v.tier}</p>
    <p>📊 Lv.${v.level}/10 | 品质: ${v.quality === 'gold' ? '🟡传说' : v.quality === 'blue' ? '🔵精良' : '⚪白板'}</p>
    <p>🧬 特质: ${getTraitName(v.trait)} ${v.trait === TraitType.Lucky ? '🔥稀有' : ''}</p>
    <p>💖 亲密度 ${v.intimacy}/100</p>
    <p>🏎️速度 ${v.stats.speed}/5 · 📦载货 ${v.stats.cargo}/5 · 🔩耐久 ${v.stats.durability}/5</p>
    <p>📦 ${v.ordersCompleted}单 · 🪙 ${v.totalEarnings.toLocaleString()}</p>
    <p>${v.status === 'idle' ? '✅ 空闲' : '🚚 执行订单中'}</p>
    ${v.isEvolved ? '<p style="color:#f1c40f;">🌟 已进化 — 获得专属天赋：' + (config?.talentDesc || '') + '</p>' : v.quality === Quality.Gold && v.level >= GAME_CONSTANTS.MAX_VEHICLE_LEVEL && v.intimacy >= GAME_CONSTANTS.INTIMACY_EVOLVE_REQUIREMENT ? '<p style="color:#f1c40f;font-weight:600;">✨ 可以进化！</p>' : ''}
  `;

  const buttons: (string | (() => void))[] = [];

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
    });
  }

  if (v.quality !== Quality.Gold) {
    buttons.push('⬆ 提升品质', () => {
      if (sys.vehicleSys.upgradeQuality(v.id)) {
        showToast('⬆ 品质提升！', `${v.name}: ${v.quality === 'blue' ? '⚪→🔵' : '🔵→🟡'}`);
        hideModal();
      } else {
        addLog('❌ 品质升级条件不足（需要完成订单数/金币/零件）');
      }
    });
  }

  if (!v.isEvolved && v.quality === Quality.Gold && v.level >= GAME_CONSTANTS.MAX_VEHICLE_LEVEL && v.intimacy >= GAME_CONSTANTS.INTIMACY_EVOLVE_REQUIREMENT) {
    buttons.push('🌟 进化', () => {
      if (sys.vehicleSys.evolve(v.id)) { hideModal(); }
      else { addLog('❌ 进化失败'); }
    });
  }

  buttons.push('🔧 拆解', () => {
    const result = sys.vehicleSys.scrapVehicle(v.id);
    addLog(`🔧 ${v.name} 已拆解，回收 ${result.parts}⚙️${result.inheritedTrait ? ' + 特质传承' : ''}`);
    hideModal();
  });

  showModal(`${config?.emoji} ${v.name}`, [detail], ...buttons);
}

// ==================== 订单渲染 ====================

function renderOrders(): void {
  const container = document.getElementById('orders')!;
  const orders = gameLoop.getSystems().orderSys.getAvailableOrders().slice(0, 3);
  container.innerHTML = '';

  if (orders.length === 0) {
    const s = getState();
    const msg = s.garage.vehicles.length === 0
      ? '🚗 先造一辆车，订单会自动出现 ↗'
      : '⏳ 等待新订单...';
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:#555;padding:20px;font-size:13px;">${msg}</div>`;
    return;
  }

  orders.forEach(o => {
    const div = document.createElement('div');
    div.className = 'order-card';
    const typeNames: Record<string, string> = { normal: '📮 普通配送', long_distance: '🏔️ 长途运输', valuable: '💎 贵重物品' };
    const idle = getState().garage.vehicles.filter(
      v => v.status === 'idle' && gameLoop.getSystems().orderSys.canVehicleTakeOrder(v.id, o)
    );

    let vehicleInfo = '';
    if (idle.length > 0) {
      vehicleInfo = `🚗 ${idle.slice(0, 2).map(v => v.name).join(', ')}${idle.length > 2 ? ` +${idle.length - 2}` : ''}`;
    } else {
      vehicleInfo = '🔴 暂无空闲车辆';
    }

    div.innerHTML = `
      <div class="type">${typeNames[o.type] || o.type}</div>
      <div class="reward">+${o.baseReward}🪙</div>
      <div style="font-size:11px;color:#888;">经验 ${o.expReward}</div>
      <div style="font-size:11px;color:#aaa;margin:4px 0;">${vehicleInfo}</div>
      <button style="margin-top:4px;padding:4px 14px;border:none;border-radius:6px;background:${idle.length > 0 ? '#e94560' : '#555'};color:#fff;cursor:${idle.length > 0 ? 'pointer' : 'not-allowed'};font-size:12px;">🚗 派车</button>
    `;

    div.querySelector('button')!.onclick = () => {
      const nowIdle = getState().garage.vehicles.filter(
        v => v.status === 'idle' && gameLoop.getSystems().orderSys.canVehicleTakeOrder(v.id, o)
      );
      if (nowIdle.length > 0) {
        gameLoop.getSystems().orderSys.assignVehicle(o.id, nowIdle[0].id);
        showToast(`🚚 ${nowIdle[0].name} 接了订单`, `${typeNames[o.type] || ''} · ${o.duration}秒后完成`);
        addLog(`🚚 ${nowIdle[0].name} 接了${typeNames[o.type] || ''}订单`);
      } else {
        addLog('⚠️ 没有空闲车辆可接单');
        showToast('⚠️ 派车失败', '没有空闲车辆');
      }
    };

    container.appendChild(div);
  });
}

// ==================== 工厂渲染 ====================

function renderFactory(): void {
  const s = getState();
  document.getElementById('factory-level')!.textContent = s.factory.level.toString();
  const container = document.getElementById('factory-lines')!;
  container.innerHTML = '';
  s.factory.productionLines.forEach((line, i) => {
    const div = document.createElement('div');
    div.className = 'factory-line';
    const current = line.currentOrder;
    const config = current ? getVehicleConfig(current.tier) : null;
    div.innerHTML = `
      <span>产线 ${i + 1}: ${current ? `${config?.emoji || '🚗'} T${current.tier} (${Math.ceil(current.remainingTime)}s)` : '🟢 空闲'}</span>
      <span style="font-size:11px;color:#888;">队列: ${line.queue.length}</span>
    `;
    container.appendChild(div);
  });
}

// ==================== 科技树渲染 ====================

function renderTech(): void {
  const container = document.getElementById('tech-tree')!;
  container.innerHTML = '';

  const s = getState();
  const sys = gameLoop.getSystems().techSys;
  const names = ['', '🔧 基础机械', '🔥 内燃机', '⚡ 自动化产线', '🌍 全球供应链', '🚀 星际物流'];
  const costs = ['', '100🪙', '800🪙 + 10⚙️', '5,000🪙 + 50⚙️', '30,000🪙 + 200⚙️', '200,000🪙 + 1,000⚙️'];
  const reqs = ['', '', '需先产 5 辆马车', '需先产 5 辆卡车', '需先产 3 艘轮船', '需先产 2 枚火箭'];

  for (let i = 1; i <= 5; i++) {
    const researched = s.techTree.isResearched[i - 1];
    const isCurrent = i === s.techTree.currentLevel + 1;
    const next = sys.getNextResearchable();

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
        if (!next.conditionMet) reasons.push(reqs[i]);
        if (!next.canAfford) reasons.push(costs[i]);
        rightContent = `<span style="font-size:11px;color:#e94560;">❌ ${reasons.join(' ')}</span>`;
      }
    } else {
      rightContent = '🔒 未解锁';
    }

    div.innerHTML = `<span class="name">${names[i]}</span><span class="cost">${rightContent}</span>`;

    if (isCurrent && next?.canAfford && next?.conditionMet) {
      div.onclick = () => {
        if (sys.researchNext()) {
          showToast('🔬 研究完成', `${names[i]} — 新车型已解锁！`);
          addLog(`🔬 ${names[i]} 研究完成！`);
        }
      };
    }

    container.appendChild(div);
  }
}

// ==================== 成就渲染 ====================

function renderAchievements(): void {
  const s = getState();
  const unlocked = s.achievements.filter(a => a.isUnlocked).length;
  document.getElementById('achieve-count')!.textContent = unlocked.toString();
  document.getElementById('achieve-total')!.textContent = s.achievements.length.toString();

  const container = document.getElementById('achieve-list')!;
  container.innerHTML = '';
  s.achievements.forEach(a => {
    const div = document.createElement('div');
    div.style.cssText = 'padding:6px 10px;margin:4px 0;background:#0f3460;border-radius:6px;display:flex;justify-content:space-between;align-items:center;';
    const sys = gameLoop.getSystems().achievementSys;
    const progress = Math.floor((sys as any).getProgress(a.id) * 100);
    div.innerHTML = `
      <span>${a.isUnlocked ? '✅' : '⬜'} ${a.name}</span>
      <span style="font-size:11px;color:#888;">${a.isUnlocked ? '✅ 已完成' : `${progress}%`}</span>
    `;
    container.appendChild(div);
  });
}

// ==================== 日志 ====================

function addLog(msg: string): void {
  logMessages.unshift(msg);
  if (logMessages.length > 50) logMessages.pop();
  const container = document.getElementById('log')!;
  container.innerHTML = logMessages.slice(0, 20).map(m => `<div>${m}</div>`).join('');
}

// ==================== 弹窗 ====================

function showModal(title: string, body: string[], ...buttons: (string | (() => void))[]): void {
  const overlay = document.getElementById('modal-overlay')!;
  const content = document.getElementById('modal-content')!;
  content.innerHTML = `<h2>${title}</h2>${body.map(b => `<p>${b}</p>`).join('')}`;

  const btnRow = document.createElement('div');
  btnRow.style.marginTop = '16px';

  for (let i = 0; i < buttons.length; i += 2) {
    const label = buttons[i] as string;
    const cb = buttons[i + 1] as () => void;
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.onclick = () => { cb(); hideModal(); };
    btnRow.appendChild(btn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '关闭';
  closeBtn.style.background = '#555';
  closeBtn.onclick = hideModal;
  btnRow.appendChild(closeBtn);

  content.appendChild(btnRow);
  overlay.classList.add('visible');
}

function hideModal(): void {
  document.getElementById('modal-overlay')!.classList.remove('visible');
}

// ==================== 顶栏状态图标容器 ====================
// 在 index.html 的 topbar 中已预留

// ==================== 启动 ====================

document.addEventListener('DOMContentLoaded', init);
