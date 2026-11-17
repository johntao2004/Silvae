import catalog from '../../../server/src/main/resources/catalog/thema-1.6.json';
import chineseCatalog from './thema-zh-CN.json';

export const THEMA_VERSION = catalog.version;
export const THEMA_SUBJECTS = catalog.subjects;
const subjects = new Map(THEMA_SUBJECTS.map(item => [item.code, item]));
// 中文为 Humite 展示译名；标准代码及英文原名保留用于检索和数据互通。
// Humite display translations do not replace the canonical codes or English headings.
const chinese: Record<string, string> = chineseCatalog.labels;
export function themaLabel(code: string) {
  const item = subjects.get(code);
  return item ? `${chinese[code]}（${code}）` : `未收录代码（${code}）`;
}
const themaPathCache = new Map<string, string>();
const englishPathCache = new Map<string, string>();
export function themaPath(code: string): string {
  const cached = themaPathCache.get(code);
  if (cached !== undefined) return cached;
  const item = subjects.get(code);
  const path = item
    ? [item.parent ? themaPath(item.parent) : '', themaLabel(code)].filter(Boolean).join(' / ')
    : themaLabel(code);
  themaPathCache.set(code, path);
  return path;
}
function englishPath(code: string): string {
  const cached = englishPathCache.get(code);
  if (cached !== undefined) return cached;
  const item = subjects.get(code);
  const path = item ? [item.parent ? englishPath(item.parent) : '', item.label].filter(Boolean).join(' / ') : '';
  englishPathCache.set(code, path);
  return path;
}
export interface ThemaTreeNode { value: string; title: string; searchText: string; selectable: boolean; children: ThemaTreeNode[] }
export function themaTree(filter = false): ThemaTreeNode[] {
  const nodes = new Map(THEMA_SUBJECTS.map(item => [item.code, {
    value: item.code, title: themaLabel(item.code), searchText: `${themaPath(item.code)} ${englishPath(item.code)}`.toLowerCase(),
    selectable: filter || item.code.length > 1, children: [] as ThemaTreeNode[],
  }]));
  const roots: ThemaTreeNode[] = [];
  for (const item of THEMA_SUBJECTS) {
    const node = nodes.get(item.code)!;
    if (item.parent) nodes.get(item.parent)?.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export { matchesThema } from "./thema-filter";
