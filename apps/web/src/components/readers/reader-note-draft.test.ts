import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readReaderNoteDraft } from "./reader-note-draft";

const selection = { quote: "保留这句话", locator: "epubcfi(/6/2!/4/2)", x: 140, y: 200, placement: "ABOVE" };

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it("restores a valid note and its selected passage", () => {
  const draft = { note: "完整的笔记\n\n第二段", selection };
  localStorage.setItem("draft", JSON.stringify(draft));
  expect(readReaderNoteDraft("draft")).toEqual(draft);
});

it("restores a legacy selection without note text", () => {
  localStorage.setItem("draft", JSON.stringify({ selection }));
  expect(readReaderNoteDraft("draft")).toEqual({ note: "", selection });
});

it.each(["null", "[]", "17", "{", JSON.stringify({ selection, note: {} }),
  ...[{ quote: {} }, { locator: null }, { x: "140" }, { y: null }, { placement: "LEFT" }]
    .map(invalid => JSON.stringify({ selection: { ...selection, ...invalid }, note: "草稿" })),
])("ignores a damaged draft without removing the original: %s", body => {
  localStorage.setItem("draft", body);
  expect(readReaderNoteDraft("draft")).toBeUndefined();
  expect(localStorage.getItem("draft")).toBe(body);
});

it("ignores unavailable local storage", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
  expect(readReaderNoteDraft("draft")).toBeUndefined();
});
