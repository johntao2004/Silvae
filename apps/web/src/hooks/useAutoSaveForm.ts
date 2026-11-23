// 统一设置表单的防抖自动保存、失焦与离页刷新、版本合并及空闲服务端同步逻辑。
// Centralizes debounced auto-save, blur/unload flushing, version-coalesced in-flight saves, and idle server resync.
import { createElement, useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Typography } from "../ui/primitives";

export type AutoSaveState = "idle" | "saving" | "saved" | "error";

export type FormUpdater<TForm> = TForm | ((current: TForm) => TForm);

export interface AutoSaveUpdateOptions {
  immediate?: boolean;
}

export interface UseAutoSaveFormBaseOptions<TForm, TSaved> {
  canEdit: boolean;
  validate?: (form: TForm) => string | undefined | null;
  save: (form: TForm) => Promise<TSaved>;
  onSaved?: (saved: TSaved) => void;
  mapSaved?: (saved: TSaved, currentForm: TForm, snapshot: TForm) => TForm;
  onEdit?: (nextForm: TForm) => void;
  debounceMs?: number;
  errorFallback?: string;
  resyncOnInitialChange?: boolean;
  flushOnPageHide?: boolean;
}

export type UseAutoSaveFormOptions<TForm, TSaved = TForm> =
  UseAutoSaveFormBaseOptions<TForm, TSaved> & {
    initial: TForm | null | undefined;
  } & ([TSaved] extends [TForm]
    ? { mapSaved?: (saved: TSaved, currentForm: TForm, snapshot: TForm) => TForm }
    : { mapSaved: (saved: TSaved, currentForm: TForm, snapshot: TForm) => TForm });

export interface UseAutoSaveFormResult<TForm, TCurrentForm = TForm> {
  form: TCurrentForm;
  saveState: AutoSaveState;
  error: string;
  dirty: boolean;
  statusNode: ReactElement | undefined;
  update: (updater: FormUpdater<TForm>, options?: AutoSaveUpdateOptions) => void;
  flush: () => Promise<void>;
  handleBlur: () => void;
}

const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_ERROR_FALLBACK = "保存失败，请重试。";

function areValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => areValuesEqual(item, right[index]));
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  return leftKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(rightRecord, key) && areValuesEqual(leftRecord[key], rightRecord[key]),
  );
}

export function AutoSaveStatus({ state }: { state: AutoSaveState }): ReactElement | null {
  if (state !== "saving" && state !== "saved") return null;
  return createElement(
    Typography,
    {
      role: "status",
      variant: "caption",
      color: "text.secondary",
      className: "bk-settings-save-status",
    },
    state === "saving" ? "正在自动保存…" : "已自动保存",
  );
}

export function AutoSaveError({ error }: { error?: string }): ReactElement | null {
  if (!error) return null;
  return createElement(
    Typography,
    {
      role: "alert",
      variant: "body2",
      color: "error",
      className: "bk-settings-save-status bk-settings-save-status--error",
    },
    error,
  );
}

export function useAutoSaveForm<TForm, TSaved = TForm>(
  options: UseAutoSaveFormBaseOptions<TForm, TSaved> & {
    initial: TForm;
  } & ([TSaved] extends [TForm]
    ? { mapSaved?: (saved: TSaved, currentForm: TForm, snapshot: TForm) => TForm }
    : { mapSaved: (saved: TSaved, currentForm: TForm, snapshot: TForm) => TForm }),
): UseAutoSaveFormResult<TForm, TForm>;

export function useAutoSaveForm<TForm, TSaved = TForm>(
  options: UseAutoSaveFormOptions<TForm, TSaved>,
): UseAutoSaveFormResult<TForm, TForm | null>;

export function useAutoSaveForm<TForm, TSaved = TForm>(
  options: UseAutoSaveFormOptions<TForm, TSaved>,
): UseAutoSaveFormResult<TForm, TForm | null> {
  const {
    initial,
    canEdit,
    validate,
    save,
    onSaved,
    mapSaved,
    onEdit,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    errorFallback = DEFAULT_ERROR_FALLBACK,
    resyncOnInitialChange = true,
    flushOnPageHide = true,
  } = options;

  const initialValue = initial ?? null;

  const [form, setForm] = useState<TForm | null>(initialValue);
  const [saveState, setSaveState] = useState<AutoSaveState>("idle");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);

  const formRef = useRef<TForm | null>(initialValue);
  const lastInitialRef = useRef<TForm | null | undefined>(initial);
  const validRef = useRef(initialValue !== null ? !(validate?.(initialValue)) : true);
  const versionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const draftSeqRef = useRef(0);
  const savedDraftSeqRef = useRef(0);
  const activeSaveRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);

  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const validateRef = useRef(validate);
  validateRef.current = validate;
  const saveRef = useRef(save);
  saveRef.current = save;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const mapSavedRef = useRef(mapSaved);
  mapSavedRef.current = mapSaved;
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;
  const debounceMsRef = useRef(debounceMs);
  debounceMsRef.current = debounceMs;
  const errorFallbackRef = useRef(errorFallback);
  errorFallbackRef.current = errorFallback;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  useEffect(() => {
    if (initial == null) return;
    if (formRef.current === null) {
      lastInitialRef.current = initial;
      formRef.current = initial;
      validRef.current = !(validateRef.current?.(initial));
      setForm(initial);
      return;
    }
    if (!resyncOnInitialChange || areValuesEqual(lastInitialRef.current, initial)) {
      return;
    }
    lastInitialRef.current = initial;
    if (
      savedVersionRef.current === versionRef.current
      && savedDraftSeqRef.current === draftSeqRef.current
      && activeSaveRef.current === null
    ) {
      validRef.current = !(validateRef.current?.(initial));
      if (!areValuesEqual(formRef.current, initial)) {
        formRef.current = initial;
        setForm(initial);
      }
    }
  }, [initial, resyncOnInitialChange]);

  const flush = useCallback(async () => {
    clearTimer();
    if (!canEditRef.current || !validRef.current) return;
    while (savedVersionRef.current < versionRef.current && validRef.current) {
      if (!activeSaveRef.current) {
        const task = (async () => {
          while (savedVersionRef.current < versionRef.current && validRef.current) {
            const targetVersion = versionRef.current;
            const targetDraftSeq = draftSeqRef.current;
            const snapshot = formRef.current;
            if (snapshot === null) {
              savedVersionRef.current = targetVersion;
              savedDraftSeqRef.current = targetDraftSeq;
              continue;
            }
            if (mountedRef.current) {
              setSaveState("saving");
              setError("");
            }
            try {
              const saved = await saveRef.current(snapshot);
              savedVersionRef.current = targetVersion;
              savedDraftSeqRef.current = targetDraftSeq;
              onSavedRef.current?.(saved);
              if (mountedRef.current && targetDraftSeq === draftSeqRef.current) {
                const currentForm = formRef.current ?? snapshot;
                const mapped = mapSavedRef.current
                  ? mapSavedRef.current(saved, currentForm, snapshot)
                  : (saved as unknown as TForm);
                formRef.current = mapped;
                setForm(mapped);
                setDirty(false);
                setSaveState("saved");
              }
            } catch (reason) {
              if (targetVersion < versionRef.current) continue;
              if (mountedRef.current && targetDraftSeq === draftSeqRef.current) {
                setSaveState("error");
                setError(
                  reason instanceof Error && reason.message
                    ? reason.message
                    : errorFallbackRef.current,
                );
              }
              throw reason;
            }
          }
        })();
        activeSaveRef.current = task;
        const clearActive = () => {
          if (activeSaveRef.current === task) {
            activeSaveRef.current = null;
          }
        };
        void task.then(clearActive, clearActive);
      }
      await activeSaveRef.current;
    }
  }, [clearTimer]);

  useEffect(() => {
    mountedRef.current = true;
    const onPageHide = () => {
      if (canEditRef.current && validRef.current && savedVersionRef.current < versionRef.current) {
        void flush().catch(() => undefined);
      }
    };
    if (flushOnPageHide) {
      window.addEventListener("pagehide", onPageHide);
    }
    return () => {
      mountedRef.current = false;
      if (flushOnPageHide) {
        window.removeEventListener("pagehide", onPageHide);
      }
      clearTimer();
      if (canEditRef.current && validRef.current && savedVersionRef.current < versionRef.current) {
        void flush().catch(() => undefined);
      }
    };
  }, [clearTimer, flush, flushOnPageHide]);

  const update = useCallback((updater: FormUpdater<TForm>, updateOptions?: AutoSaveUpdateOptions) => {
    const current = formRef.current;
    if (current === null) return;
    const next = typeof updater === "function"
      ? (updater as (value: TForm) => TForm)(current)
      : updater;

    formRef.current = next;
    setForm(next);
    draftSeqRef.current += 1;
    setDirty(true);
    onEditRef.current?.(next);
    clearTimer();

    const validationError = validateRef.current?.(next) ?? "";
    if (validationError) {
      validRef.current = false;
      setSaveState("error");
      setError(validationError);
      return;
    }

    validRef.current = true;
    setError("");
    setSaveState((prev) => (prev === "error" ? "idle" : prev));
    versionRef.current += 1;
    if (!canEditRef.current) return;

    if (updateOptions?.immediate) {
      void flush().catch(() => undefined);
      return;
    }

    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined;
      void flush().catch(() => undefined);
    }, debounceMsRef.current);
  }, [clearTimer, flush]);

  const handleBlur = useCallback(() => {
    if (canEditRef.current && validRef.current && savedVersionRef.current < versionRef.current) {
      void flush().catch(() => undefined);
    }
  }, [flush]);

  const statusNode = saveState === "saving" || saveState === "saved"
    ? createElement(AutoSaveStatus, { state: saveState })
    : undefined;

  return {
    form,
    saveState,
    error,
    dirty,
    statusNode,
    update,
    flush,
    handleBlur,
  };
}
