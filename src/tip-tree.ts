import type { TipThread } from "./types.js";

export interface TipTreeNode {
  tip: TipThread;
  children: TipTreeNode[];
}

export function plainMessageContent(content: string) {
  return content.replace(/\r\n?/g, "\n").replace(/\*\*([^*]+)\*\*/g, "$1");
}

export function httpLinkRanges(content: string) {
  const ranges: Array<{ start: number; end: number; url: string }> = [];
  for (const match of content.matchAll(/https?:\/\/[^\s<>"'`，。！？；：、（）【】]+/gi)) {
    const start = match.index || 0;
    const visible = match[0].replace(/[),.;!?]+$/g, "");
    if (!visible) continue;
    try {
      const parsed = new URL(visible);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      ranges.push({ start, end: start + visible.length, url: parsed.toString() });
    } catch { /* Ignore malformed or unsupported links and keep them as plain text. */ }
  }
  return ranges;
}

export function buildTipPath(tips: TipThread[], activeTipId: string | null) {
  if (!activeTipId) return [];
  const byId = new Map(tips.map((tip) => [tip.id, tip]));
  const reverse: TipThread[] = [];
  const visited = new Set<string>();
  let current = byId.get(activeTipId);
  while (current) {
    if (visited.has(current.id) || reverse.length >= 32) return [];
    visited.add(current.id);
    reverse.push(current);
    if (!current.parentTipId) break;
    current = byId.get(current.parentTipId);
    if (!current) return [];
  }
  const path = reverse.reverse();
  return path[0]?.parentTipId ? [] : path;
}

export function visibleTipLayout(tips: TipThread[], activeTipId: string | null) {
  const path = buildTipPath(tips, activeTipId);
  if (!path.length) return { left: { kind: "document" as const }, rightTipId: null };
  const active = path[path.length - 1];
  const parent = path[path.length - 2];
  return {
    left: parent ? { kind: "tip" as const, tipId: parent.id } : { kind: "document" as const },
    rightTipId: active.id
  };
}

export function buildTipForest(tips: TipThread[]) {
  const byId = new Map(tips.map((tip) => [tip.id, tip]));
  const valid = new Set(tips.filter((tip) => buildTipPath(tips, tip.id).length > 0).map((tip) => tip.id));
  const nodes = new Map<string, TipTreeNode>();
  for (const tip of tips) if (valid.has(tip.id)) nodes.set(tip.id, { tip, children: [] });
  const roots: TipTreeNode[] = [];
  for (const tip of tips) {
    const node = nodes.get(tip.id);
    if (!node) continue;
    if (!tip.parentTipId) roots.push(node);
    else {
      const parent = nodes.get(tip.parentTipId);
      if (parent && byId.has(tip.parentTipId)) parent.children.push(node);
    }
  }
  return roots;
}

export function collectTipSubtreeIds(tips: TipThread[], rootId: string) {
  const result = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    if (result.has(id)) continue;
    result.add(id);
    for (const tip of tips) if (tip.parentTipId === id) queue.push(tip.id);
  }
  return result;
}
