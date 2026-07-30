// ============================================================
// 「💡 下一步」提示条（M5）— 纯 UI 层，零数值改动
// 按优先级扫描 GameState，给出当前最有价值的一个行动建议
// computeHint 为纯函数（smoke 可测），renderHint 负责 DOM（签名缓存防闪烁）
// ============================================================

import { GameState, Quality, qualityRank } from '../core/types';
import { getUnlockedConfigs, getOccupiedSpaces } from '../config/VehicleConfig';
import { getTechConfig } from '../config/TechConfig';
import { getState, getSystems } from './context';
import { isTutorialActive } from './tutorial';
import { showVehicleDetail } from './garage';

/** 提示动作：切 Tab / 打开车辆详情 / 聚焦制造按钮 */
export type HintAction =
  | { type: 'tab'; tab: string }
  | { type: 'vehicle'; vehicleId: string }
  | { type: 'build' };

export interface Hint {
  icon: string;
  text: string;
  action: HintAction;
}

/** TechSystem.getNextResearchable() 的返回形状（结构化传入，保持纯函数） */
export interface NextTechInfo {
  level: number;
  canAfford: boolean;
  conditionMet: boolean;
}

/** 主力车 = 车库中 tier 最高的车（并列取第一辆） */
function getMainVehicle(state: GameState) {
  let main = null as (GameState['garage']['vehicles'][number] | null);
  for (const v of state.garage.vehicles) {
    if (!main || v.tier > main.tier) main = v;
  }
  return main;
}

/**
 * 计算当前提示（优先级从高到低）：
 * 1. 科技可研究 2. 车库将满 3. 蓝车未选运营配置 4. 主力车磨损≥70 5. 默认攒钱造下一 tier
 */
export function computeHint(state: GameState, nextTech: NextTechInfo | null): Hint | null {
  const vehicles = state.garage.vehicles;

  // 1. 主线科技下一级条件已满足且资源足够 → 切科技 Tab
  if (nextTech && nextTech.conditionMet && nextTech.canAfford) {
    const cfg = getTechConfig(nextTech.level);
    return {
      icon: '🔬',
      text: `「${cfg?.name ?? 'L' + nextTech.level}」可以研究了！去科技树看看`,
      action: { type: 'tab', tab: 'tech' },
    };
  }

  // 2. 车库已满或差 1 格满（S2a 占格数口径，含建造队列预留） → 切车库 Tab（扩建/拆解）
  const used = getOccupiedSpaces(state);
  const free = state.garage.maxCapacity - used;
  if (free <= 1 && state.garage.maxCapacity > 0) {
    return {
      icon: '🏠',
      text: free <= 0
        ? `车库已满（${used}/${state.garage.maxCapacity}格），扩建或拆解旧车腾位置`
        : `车库只剩 1 格（${used}/${state.garage.maxCapacity}格），记得扩建或拆解旧车`,
      action: { type: 'tab', tab: 'garage' },
    };
  }

  // 3. 有蓝规格及以上但未选运营配置的车 → 打开详情
  const unspec = vehicles.find(v =>
    !v.specialization && qualityRank(v.quality) >= qualityRank(Quality.Blue)
  );
  if (unspec) {
    return {
      icon: '🎯',
      text: `${unspec.name} 还没选运营配置，详情页三选一（快运/重载/耐用）`,
      action: { type: 'vehicle', vehicleId: unspec.id },
    };
  }

  // 4. 主力车磨损 ≥70 → 打开详情（建议检修）
  const main = getMainVehicle(state);
  if (main && main.wear >= 70) {
    return {
      icon: '🔧',
      text: `主力车 ${main.name} 磨损 ${Math.floor(main.wear)}%，该检修了（≥80 收入打折）`,
      action: { type: 'vehicle', vehicleId: main.id },
    };
  }

  // 5. 默认：攒钱造下一 tier 车型（时代差异化矩阵全维度已解锁（M9）的最高 tier）
  const unlocked = getUnlockedConfigs(state);
  const target = unlocked[unlocked.length - 1];
  if (!target) return null;
  const remaining = target.buildCost - state.resources.gold;
  return {
    icon: '💰',
    text: remaining > 0
      ? `攒钱造 ${target.emoji}${target.name}（还差 ${remaining.toLocaleString()}🪙）`
      : `金币够了！可以造 ${target.emoji}${target.name} 了`,
    action: { type: 'build' },
  };
}

// ==================== DOM 渲染（签名缓存，内容不变不重建） ====================

let lastSig = '';

export function renderHint(): void {
  const bar = document.getElementById('hint-bar');
  if (!bar) return;

  // 教程进行中不显示，避免和引导高亮打架
  if (isTutorialActive()) {
    if (lastSig !== '') { bar.style.display = 'none'; lastSig = ''; }
    return;
  }

  const state = getState();
  const hint = computeHint(state, getSystems().techSys.getNextResearchable());
  const sig = hint ? `${hint.icon}|${hint.text}|${JSON.stringify(hint.action)}` : '';
  if (sig === lastSig) return;
  lastSig = sig;

  if (!hint) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';
  bar.innerHTML = `<span>💡</span><span class="hint-text">${hint.icon} ${hint.text}</span><span class="hint-arrow">→</span>`;
  bar.onclick = () => executeHint(hint);
}

/** 点击提示条：执行对应操作 / 跳转对应界面 */
function executeHint(hint: Hint): void {
  const action = hint.action;
  switch (action.type) {
    case 'tab': {
      // 复用底部导航已有绑定，直接模拟点击对应 Tab
      (document.querySelector(`#bottombar [data-tab="${action.tab}"]`) as HTMLElement | null)?.click();
      break;
    }
    case 'vehicle': {
      const v = getState().garage.vehicles.find(x => x.id === action.vehicleId);
      if (v) showVehicleDetail(v);
      break;
    }
    case 'build': {
      // 聚焦制造按钮并短暂高亮，引导视线
      const btn = document.getElementById('btn-build');
      if (btn) {
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        btn.classList.add('tutorial-highlight');
        setTimeout(() => btn.classList.remove('tutorial-highlight'), 2000);
      }
      break;
    }
  }
}
