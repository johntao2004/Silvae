// 过滤可编辑目标上的快捷键并识别横向滑动，避免阅读导航抢占表单输入。
// Filters editable targets and recognizes horizontal swipes so reader navigation does not hijack text input.
import { tokens } from "../../theme/tokens";

export const READER_SWIPE_THRESHOLD = tokens.layout.touchTarget;

export function isEditableReaderTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(element?.isContentEditable || element?.closest("input, textarea, select, [contenteditable='true'], [role='menu'], [role='dialog']"));
}

export function isReaderSwipe(startX: number | null, endX: number) {
  return startX !== null && Math.abs(endX - startX) >= READER_SWIPE_THRESHOLD;
}

export function isReaderHorizontalSwipe({ startX, startY, endX, endY, hasSelection = false }: {
  startX: number | null;
  startY: number | null;
  endX: number;
  endY: number;
  hasSelection?: boolean;
}) {
  if (hasSelection || startX === null) return false;
  const deltaX = Math.abs(endX - startX);
  if (deltaX < READER_SWIPE_THRESHOLD) return false;
  if (startY !== null) {
    const deltaY = Math.abs(endY - startY);
    if (deltaX <= deltaY * 1.3) return false;
  }
  return true;
}

export type ReaderTapZone = "PREVIOUS" | "CENTER" | "NEXT";
export function classifyReaderTapZone(clientX: number, rectLeft: number, rectWidth: number): ReaderTapZone {
  if (!Number.isFinite(rectWidth) || rectWidth <= 0) return "CENTER";
  const ratio = (clientX - rectLeft) / rectWidth;
  if (ratio < 0.25) return "PREVIOUS";
  if (ratio > 0.75) return "NEXT";
  return "CENTER";
}

export function isReaderInteractiveTapTarget(target: EventTarget | null) {
  if (!target || typeof target !== "object") return false;
  const element = "closest" in target && typeof target.closest === "function"
    ? (target as Element)
    : "parentElement" in target
      ? (target as Node).parentElement
      : null;
  return Boolean(element?.closest("a, button, input, textarea, select, [role='button'], [data-annotation-id]"));
}

export function hasReaderTextSelection(doc?: Document | null) {
  if (typeof window !== "undefined" && window.getSelection()?.toString().trim()) return true;
  if (!doc) return false;
  try {
    return Boolean(doc.defaultView?.getSelection()?.toString().trim());
  } catch {
    return false;
  }
}
