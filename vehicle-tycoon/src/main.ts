// ============================================================
// 造物运输大亨 — 运行入口
// 创建游戏实例，绑定 DOM UI，启动循环
// ============================================================

import { GameLoop } from './core/GameLoop';
import { EventBus } from './core/EventBus';
import { SaveManager } from './core/SaveManager';
import { GameEvent, GameState, Vehicle, Order, Quality, VehicleStatus, TraitType } from './core/types';
import { getVehicleConfig, getUnlockedConfigs } from './config/VehicleConfig';
import { getTraitConfig, rollTrait } from './config/TraitConfig';
import { GAME_CONSTANTS, garageExpandCost } from './config/GameConstants';

// ==================== 状态 ====================

let gameLoop: GameLoop;
let selectedVehicleId: string | null = null;
let currentTab: string = 'garage';
let logMessages: string[] = [];

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
      addLog(`📥 离线 ${Math.floor(offlineSeconds / 60)} 分钟归来，已自动收获`);
    }
  } else {
    gameLoop = new GameLoop(SaveManager.createInitialState());
    addLog('🚗 欢迎来到造物运输大亨！');
  }

  bindEvents();
  bindUI();
  gameLoop.start();
  renderLoop();
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
      case GameEvent.VEHICLE_PRODUCED: {
        const v = args[0] as Vehicle;
        const cfg = getVehicleConfig(v.tier);
        addLog(`🚗 新车出厂！${cfg?.emoji} ${v.name} [${getTraitName(v.trait)}]`);
        showModal(`${cfg?.emoji} ${v.name}`, [
          `品质: ${v.quality === 'gold' ? '🟡' : v.quality === 'blue' ? '🔵' : '⚪'}${v.quality}`,
          `特质: ${getTraitName(v.trait)} ${v.trait === TraitType.Lucky ? '🔥稀有' : ''}`,
        ], '给它取名', () => {
          const name = prompt('给这辆车起个名字：', v.name);
          if (name) gameLoop.getSystems().vehicleSys.nameVehicle(v.id, name);
        });
        break;
      }
      case GameEvent.VEHICLE_LEVEL_UP: {
        const v = args[0] as Vehicle;
        addLog(`⬆ ${v.name} 升到 Lv.${v.level}！`);
        break;
      }
      case GameEvent.VEHICLE_EVOLVED: {
        const v = args[0] as Vehicle;
        addLog(`🌟 ${v.name} 进化了！`);
        showModal('🌟 进化成功！', [`${v.name} 完成了进化！`]);
        break;
      }
      case GameEvent.RANDOM_EVENT_TRIGGERED: {
        const evt = args[0] as { name: string; description: string };
        addLog(`🎲 ${evt.name}: ${evt.description}`);
        break;
      }
      case GameEvent.ACHIEVEMENT_UNLOCKED: {
        const a = args[0] as { name: string };
        addLog(`🏆 成就解锁: ${a.name}`);
        showModal('🏆 成就解锁！', [a.name]);
        break;
      }
      case GameEvent.ORDER_COMPLETED: {
        const o = args[0] as Order;
        const v = args[1] as Vehicle | undefined;
        addLog(`✅ 订单完成 +${o.baseReward}🪙 ${v ? '(' + v.name + ')' : ''}`);
        break;
      }
      case GameEvent.GARAGE_EXPANDED: {
        addLog(`🏠 车库扩建完成！`);
        break;
      }
      case GameEvent.FACTORY_UPGRADED: {
        addLog(`🏭 工厂升级！`);
        break;
      }
      case GameEvent.TECH_RESEARCHED: {
        addLog(`🔬 科技研究完成！`);
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
  // 造车
  document.getElementById('btn-build')!.onclick = () => {
    const tier = parseInt((document.getElementById('build-tier-select') as HTMLSelectElement).value);
    const result = gameLoop.getSystems().vehicleSys.createVehicle(tier);
    if (!result) addLog('❌ 造车失败：金币不足或车库已满');
  };

  // 车库扩建
  document.getElementById('btn-expand')!.onclick = () => {
    const sys = gameLoop.getSystems().economySys as any;
    if (!sys.expandGarace?.()) {
      if (getState().garage.maxCapacity >= GAME_CONSTANTS.GARAGE_MAX_CAPACITY) {
        addLog('🏠 车库已到最大容量');
      } else {
        addLog('❌ 金币不足');
      }
    }
  };

  // 直接用 EconomySystem 的 expandGarage
  document.getElementById('btn-expand')!.onclick = () => {
    const ec = gameLoop.getSystems().economySys as any;
    if (ec.expandGarage()) {
      addLog('🏠 车库扩建中...');
    } else {
      const state = getState();
      if (state.garage.maxCapacity >= GAME_CONSTANTS.GARAGE_MAX_CAPACITY) {
        addLog('🏠 车库已达上限');
      } else {
        addLog('❌ 金币不足，需要 ' + ec.getNextExpandCost() + '🪙');
      }
    }
  };

  // Tab 切换
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

  // 生产
  document.getElementById('btn-start-prod')!.onclick = () => {
    const tier = parseInt((document.getElementById('prod-tier-select') as HTMLSelectElement).value);
    const line = gameLoop.getSystems().factorySys.getIdleLines()[0];
    if (line) {
      if (gameLoop.getSystems().factorySys.startProduction(tier, line.index)) {
        addLog(`🏭 开始生产 T${tier}`);
      } else {
        addLog('❌ 生产失败：金币或零件不足');
      }
    } else {
      addLog('⚠️ 所有产线都在生产中');
    }
  };

  // 工厂升级
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
  requestAnimationFrame(renderLoop);
}

function renderTopBar(): void {
  const s = getState();
  document.getElementById('gold')!.textContent = s.resources.gold.toLocaleString();
  document.getElementById('parts')!.textContent = s.resources.parts.toLocaleString();
  document.getElementById('intimacy-sum')!.textContent = 
    s.garage.vehicles.reduce((sum, v) => sum + v.intimacy, 0).toString();

  const highestTier = s.garage.vehicles.length > 0
    ? Math.max(...s.garage.vehicles.map(v => v.tier))
    : 1;
  const emojis = ['', '🛴', '🚲', '🐴', '🚗', '🚛', '🚂', '🚢', '✈️', '🚀', '🛸'];
  document.getElementById('tier-label')!.textContent = `${emojis[highestTier] || '🛴'} T${highestTier}`;

  const ec = gameLoop.getSystems().economySys as any;
  document.getElementById('eps')!.textContent = `${ec.getEstimatedEPS?.() ?? 0}/s`;
}

function renderGarage(): void {
  const s = getState();
  document.getElementById('garage-count')!.textContent = s.garage.vehicles.length.toString();
  document.getElementById('garage-max')!.textContent = s.garage.maxCapacity.toString();

  const grid = document.getElementById('garage-grid')!;
  grid.innerHTML = '';

  s.garage.vehicles.forEach(v => {
    const config = getVehicleConfig(v.tier);
    const card = document.createElement('div');
    card.className = `vehicle-card quality-${v.quality}`;
    card.innerHTML = `
      <div class="emoji">${config?.emoji || '🚗'}</div>
      <div class="name">${v.name}</div>
      <div class="info">
        Lv.${v.level}/10 | ${v.quality === 'gold' ? '🟡' : v.quality === 'blue' ? '🔵' : '⚪'}
        ${v.trait ? '| ' + getTraitName(v.trait) + (v.trait === TraitType.Lucky ? '<span class="badge rare">稀有</span>' : '') : ''}
      </div>
      <div class="info">${v.isEvolved ? '🌟 已进化' : ''} | 💖 ${v.intimacy}</div>
      <div class="info">📦 ${v.ordersCompleted}单 | 🪙 ${v.totalEarnings.toLocaleString()}</div>
      <div><span class="status status-${v.status}">${v.status === 'idle' ? '空闲' : v.status === 'on_order' ? '派单中' : v.status}</span></div>
    `;
    card.onclick = () => showVehicleDetail(v);
    grid.appendChild(card);
  });
}

function showVehicleDetail(v: Vehicle): void {
  const sys = gameLoop.getSystems();
  const config = getVehicleConfig(v.tier);

  const actions: string[] = [];
  if (v.status === 'idle') actions.push('📮 接单');
  if (v.quality !== Quality.Gold) actions.push('⬆ 提升品质');
  actions.push('🛠️ 退役');
  actions.push('🔧 拆解');

  let detail = `
    <p>${config?.emoji} <strong>${v.name}</strong> T${v.tier} ${config?.name || ''}</p>
    <p>等级: Lv.${v.level}/10 | 品质: ${v.quality}</p>
    <p>特质: ${getTraitName(v.trait)} ${v.trait === TraitType.Lucky ? '🔥稀有' : ''}</p>
    <p>亲密度: 💖 ${v.intimacy}/100</p>
    <p>属性: 🏎️${v.stats.speed} 📦${v.stats.cargo} 🔩${v.stats.durability}</p>
    <p>战绩: ${v.ordersCompleted}单 | 🪙 ${v.totalEarnings.toLocaleString()}</p>
    <p>状态: ${v.status === 'idle' ? '空闲' : v.status === 'on_order' ? '执行订单中' : v.status}</p>
    ${v.isEvolved ? '<p>🌟 已进化</p>' : v.quality === Quality.Gold && v.level >= GAME_CONSTANTS.MAX_VEHICLE_LEVEL && v.intimacy >= GAME_CONSTANTS.INTIMACY_EVOLVE_REQUIREMENT ? '<p>✨ 可以进化！</p>' : ''}
  `;

  showModal(`${config?.emoji} ${v.name}`, [detail], '📮 派单', () => {
    const orders = sys.orderSys.getAvailableOrders();
    const match = orders.find(o => sys.orderSys.canVehicleTakeOrder(v.id, o));
    if (match) {
      sys.orderSys.assignVehicle(match.id, v.id);
      addLog(`📮 ${v.name} 已接单`);
    } else {
      addLog('⚠️ 没有适合该车的订单');
    }
  }, '⬆ 品质', () => {
    if (sys.vehicleSys.upgradeQuality(v.id)) {
      addLog(`⬆ ${v.name} 品质提升！`);
    } else {
      addLog('❌ 品质升级条件不足');
    }
  }, '🌟 进化', () => {
    if (sys.vehicleSys.evolve(v.id)) {
      addLog(`🌟 ${v.name} 进化成功！`);
    } else {
      addLog('❌ 进化条件不足（需传说Lv.10亲密80+）');
    }
  }, '🔧 拆解', () => {
    const result = sys.vehicleSys.scrapVehicle(v.id);
    addLog(`🔧 ${v.name} 已拆解，回收 ${result.parts}⚙️`);
    hideModal();
  });
}

function renderOrders(): void {
  const container = document.getElementById('orders')!;
  const orders = gameLoop.getSystems().orderSys.getAvailableOrders().slice(0, 3);

  container.innerHTML = '';
  if (orders.length === 0) {
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#555;padding:20px;">等待新订单...</div>';
    return;
  }

  orders.forEach(o => {
    const div = document.createElement('div');
    div.className = 'order-card';
    const typeNames: Record<string, string> = { normal: '📮 普通', long_distance: '🏔️ 长途', valuable: '💎 贵重' };
    const hasIdle = getState().garage.vehicles.some(v => v.status === 'idle' && gameLoop.getSystems().orderSys.canVehicleTakeOrder(v.id, o));
    div.innerHTML = `
      <div class="type">${typeNames[o.type] || o.type}</div>
      <div class="reward">+${o.baseReward}🪙</div>
      <div style="font-size:11px;color:#888;">经验 ${o.expReward}</div>
      <button ${hasIdle ? '' : 'disabled'}>派车</button>
    `;
    div.querySelector('button')!.onclick = () => {
      const idle = getState().garage.vehicles.filter(v => v.status === 'idle' && gameLoop.getSystems().orderSys.canVehicleTakeOrder(v.id, o));
      if (idle.length > 0) {
        gameLoop.getSystems().orderSys.assignVehicle(o.id, idle[0].id);
        addLog(`📮 ${idle[0].name} 接了${typeNames[o.type] || ''}订单`);
      }
    };
    container.appendChild(div);
  });
}

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
      <span>产线 ${i + 1}: ${current ? `${config?.emoji || '🚗'} T${current.tier} (${Math.ceil(current.remainingTime)}s)` : '空闲'}</span>
      <span style="font-size:11px;color:#888;">队列: ${line.queue.length}</span>
    `;
    container.appendChild(div);
  });
}

function renderTech(): void {
  const container = document.getElementById('tech-tree')!;
  container.innerHTML = '';

  const s = getState();
  const sys = gameLoop.getSystems().techSys;
  for (let i = 1; i <= 5; i++) {
    const researched = s.techTree.isResearched[i - 1];
    const isCurrent = i === s.techTree.currentLevel + 1;
    const next = sys.getNextResearchable();

    const div = document.createElement('div');
    div.className = 'tech-node';
    div.classList.add(researched ? 'researched' : isCurrent ? 'available' : 'locked');

    const names = ['', '基础机械', '内燃机', '自动化产线', '全球供应链', '星际物流'];
    const costs = ['', '100🪙', '800🪙 + 10⚙️', '5,000🪙 + 50⚙️', '30,000🪙 + 200⚙️', '200,000🪙 + 1,000⚙️'];

    div.innerHTML = `
      <span class="name">${researched ? '✅ ' : ''}L${i} ${names[i]}</span>
      <span class="cost">${researched ? '已完成' : isCurrent ? costs[i] : '🔒 未解锁'}</span>
    `;

    if (isCurrent && next?.canAfford && next?.conditionMet) {
      div.style.cursor = 'pointer';
      div.onclick = () => {
        if (sys.researchNext()) {
          addLog(`🔬 科技 L${i} 研究完成！`);
        } else {
          addLog('❌ 研究失败：条件不足');
        }
      };
    }

    container.appendChild(div);
  }
}

function renderAchievements(): void {
  const s = getState();
  const unlocked = s.achievements.filter(a => a.isUnlocked).length;
  document.getElementById('achieve-count')!.textContent = unlocked.toString();
  document.getElementById('achieve-total')!.textContent = s.achievements.length.toString();

  const container = document.getElementById('achieve-list')!;
  container.innerHTML = '';
  s.achievements.forEach(a => {
    const div = document.createElement('div');
    div.style.cssText = 'padding:6px 10px;margin:4px 0;background:#0f3460;border-radius:6px;display:flex;justify-content:space-between;';
    const sys = gameLoop.getSystems().achievementSys;
    const progress = Math.floor((sys as any).getProgress(a.id) * 100);
    div.innerHTML = `
      <span>${a.isUnlocked ? '✅' : '⬜'} ${a.name}</span>
      <span style="font-size:11px;color:#888;">${a.isUnlocked ? '已完成' : `${progress}%`}</span>
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

// ==================== 启动 ====================

document.addEventListener('DOMContentLoaded', init);
