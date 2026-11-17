import { readLocalPreference } from "../../utils/local-preferences";
import type { ReaderSelection } from "./types";

interface ReaderNoteDraft {
  note: string;
  selection: ReaderSelection;
}

export function readReaderNoteDraft(key: string): ReaderNoteDraft | undefined {
  try {
    const draft = JSON.parse(readLocalPreference(key) ?? "null") as { note?: unknown; selection?: unknown } | null;
    if (!draft || (draft.note != null && typeof draft.note !== "string") || !isReaderSelection(draft.selection)) return undefined;
    return { note: draft.note ?? "", selection: draft.selection };
  } catch {
    return undefined;
  }
}

function isReaderSelection(value: unknown): value is ReaderSelection {
  if (!value || typeof value !== "object") return false;
  const selection = value as Partial<ReaderSelection>;
  return typeof selection.quote === "string" && selection.quote.length > 0
    && typeof selection.locator === "string" && selection.locator.length > 0
    && typeof selection.x === "number" && Number.isFinite(selection.x)
    && typeof selection.y === "number" && Number.isFinite(selection.y)
    && (selection.placement === "ABOVE" || selection.placement === "BELOW");
}
