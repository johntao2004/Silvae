// 覆盖水平手势阈值与可编辑元素，避免阅读导航劫持输入操作。
// Covers horizontal gesture thresholds and editable controls so reading navigation does not hijack input.
import { describe, expect, it } from "vitest";
import {
  classifyReaderTapZone,
  isEditableReaderTarget,
  isReaderHorizontalSwipe,
  isReaderInteractiveTapTarget,
  isReaderSwipe,
  READER_SWIPE_THRESHOLD,
} from "./reader-navigation";

describe("reader navigation", () => {
  it("recognizes horizontal gestures at the touch target threshold", () => {
    expect(isReaderSwipe(200, 200 - READER_SWIPE_THRESHOLD)).toBe(true);
    expect(isReaderSwipe(200, 200 - READER_SWIPE_THRESHOLD + 1)).toBe(false);
    expect(isReaderSwipe(null, 100)).toBe(false);
  });

  it("validates clean horizontal swipes while rejecting vertical, diagonal, and selection gestures", () => {
    expect(isReaderHorizontalSwipe({ startX: 240, startY: 200, endX: 240 - READER_SWIPE_THRESHOLD, endY: 208 })).toBe(true);
    expect(isReaderHorizontalSwipe({ startX: 120, startY: null, endX: 120 + READER_SWIPE_THRESHOLD, endY: 220 })).toBe(true);
    expect(isReaderHorizontalSwipe({ startX: 200, startY: 200, endX: 215, endY: 320 })).toBe(false);
    expect(isReaderHorizontalSwipe({ startX: 200, startY: 200, endX: 200 - READER_SWIPE_THRESHOLD, endY: 200 + READER_SWIPE_THRESHOLD })).toBe(false);
    expect(isReaderHorizontalSwipe({ startX: 200, startY: 200, endX: 100, endY: 202, hasSelection: true })).toBe(false);
    expect(isReaderHorizontalSwipe({ startX: null, startY: 200, endX: 100, endY: 202 })).toBe(false);
  });

  it("classifies left, center, and right reader tap zones", () => {
    expect(classifyReaderTapZone(0, 0, 400)).toBe("PREVIOUS");
    expect(classifyReaderTapZone(99, 0, 400)).toBe("PREVIOUS");
    expect(classifyReaderTapZone(100, 0, 400)).toBe("CENTER");
    expect(classifyReaderTapZone(200, 0, 400)).toBe("CENTER");
    expect(classifyReaderTapZone(300, 0, 400)).toBe("CENTER");
    expect(classifyReaderTapZone(301, 0, 400)).toBe("NEXT");
    expect(classifyReaderTapZone(400, 0, 400)).toBe("NEXT");
    expect(classifyReaderTapZone(150, 100, 400)).toBe("PREVIOUS");
    expect(classifyReaderTapZone(250, 100, 400)).toBe("CENTER");
    expect(classifyReaderTapZone(450, 100, 400)).toBe("NEXT");
    expect(classifyReaderTapZone(50, 0, 0)).toBe("CENTER");
  });

  it("does not hijack editable controls or interactive tap targets", () => {
    const input = document.createElement("input");
    const article = document.createElement("article");
    const link = document.createElement("a");
    const annotation = document.createElement("mark");
    annotation.dataset.annotationId = "ann-1";
    expect(isEditableReaderTarget(input)).toBe(true);
    expect(isEditableReaderTarget(article)).toBe(false);
    expect(isReaderInteractiveTapTarget(link)).toBe(true);
    expect(isReaderInteractiveTapTarget(annotation)).toBe(true);
    expect(isReaderInteractiveTapTarget(article)).toBe(false);
  });
});
