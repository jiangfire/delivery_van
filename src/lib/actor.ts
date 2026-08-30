/**
 * 「我是谁」软身份（v2.0 开放问题 3 默认方案）：页头常驻单选，localStorage 记住。
 * 无账号体系下的最小操作人标识——链式审计日志的 actor 来源，缺省 '(unknown)'。
 */
const KEY = "delivery-van.actor";

export function getActor(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // 隐私模式等场景读不到，退化为未选择
  }
}

export function saveActor(name: string | null): void {
  try {
    if (name) localStorage.setItem(KEY, name);
    else localStorage.removeItem(KEY);
  } catch {
    // 写不进就算了，软身份不阻塞操作
  }
}
