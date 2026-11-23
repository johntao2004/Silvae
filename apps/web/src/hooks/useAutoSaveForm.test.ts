import { act, render, renderHook, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutoSaveError, AutoSaveStatus, useAutoSaveForm } from "./useAutoSaveForm";

interface SampleForm {
  name: string;
  enabled: boolean;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useAutoSaveForm", () => {
  it("debounces edits and coalesces rapid updates into a single save", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (form: SampleForm) => ({ ...form }));
    const onSaved = vi.fn();

    const { result } = renderHook(() =>
      useAutoSaveForm({
        initial: { name: "Alpha", enabled: false },
        canEdit: true,
        save,
        onSaved,
      }),
    );

    expect(result.current.saveState).toBe("idle");
    expect(result.current.dirty).toBe(false);
    expect(result.current.statusNode).toBeUndefined();

    act(() => {
      result.current.update((prev) => ({ ...prev, name: "Beta" }));
      result.current.update((prev) => ({ ...prev, name: "Gamma" }));
    });

    expect(result.current.form.name).toBe("Gamma");
    expect(result.current.dirty).toBe(true);
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ name: "Gamma", enabled: false });
    expect(onSaved).toHaveBeenCalledWith({ name: "Gamma", enabled: false });
    expect(result.current.saveState).toBe("saved");
    expect(result.current.dirty).toBe(false);
    expect(result.current.statusNode).toBeDefined();
  });

  it("saves immediately when immediate option is set", async () => {
    const deferred = createDeferred<SampleForm>();
    const save = vi.fn(() => deferred.promise);

    const { result } = renderHook(() =>
      useAutoSaveForm({
        initial: { name: "Alpha", enabled: false },
        canEdit: true,
        save,
      }),
    );

    act(() => {
      result.current.update((prev) => ({ ...prev, enabled: true }), { immediate: true });
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ name: "Alpha", enabled: true });
    expect(result.current.saveState).toBe("saving");
    expect(result.current.dirty).toBe(true);

    await act(async () => {
      deferred.resolve({ name: "ServerAlpha", enabled: true });
      await deferred.promise;
    });

    expect(result.current.saveState).toBe("saved");
    expect(result.current.form).toEqual({ name: "ServerAlpha", enabled: true });
    expect(result.current.dirty).toBe(false);
  });

  it("flushes pending debounced edits on blur", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (form: SampleForm) => ({ ...form }));

    const { result } = renderHook(() =>
      useAutoSaveForm({
        initial: { name: "Alpha", enabled: false },
        canEdit: true,
        save,
      }),
    );

    act(() => {
      result.current.update((prev) => ({ ...prev, name: "Blurred" }));
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      result.current.handleBlur();
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ name: "Blurred", enabled: false });
    expect(result.current.saveState).toBe("saved");

    // Subsequent blur without new edits does not trigger another save.
    await act(async () => {
      result.current.handleBlur();
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("coalesces edits made while a save is already in flight", async () => {
    const first = createDeferred<SampleForm>();
    const second = createDeferred<SampleForm>();
    const save = vi.fn<(_: SampleForm) => Promise<SampleForm>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result } = renderHook(() =>
      useAutoSaveForm({
        initial: { name: "V0", enabled: false },
        canEdit: true,
        save,
      }),
    );

    act(() => {
      result.current.update((prev) => ({ ...prev, name: "V1" }), { immediate: true });
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenNthCalledWith(1, { name: "V1", enabled: false });

    // Edit again while V1 is still in flight.
    act(() => {
      result.current.update((prev) => ({ ...prev, name: "V2" }), { immediate: true });
    });
    expect(save).toHaveBeenCalledTimes(1);

    // Resolve first save: should NOT overwrite local V2 or report saved yet, and should launch V2.
    await act(async () => {
      first.resolve({ name: "V1", enabled: false });
      await Promise.resolve();
    });

    expect(result.current.form.name).toBe("V2");
    expect(result.current.dirty).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, { name: "V2", enabled: false });

    await act(async () => {
      second.resolve({ name: "V2-server", enabled: false });
      await second.promise;
    });

    expect(result.current.form.name).toBe("V2-server");
    expect(result.current.saveState).toBe("saved");
    expect(result.current.dirty).toBe(false);
  });

  it("ignores stale failure when a newer valid edit superseded the failed in-flight save", async () => {
    const first = createDeferred<SampleForm>();
    const second = createDeferred<SampleForm>();
    const save = vi.fn<(_: SampleForm) => Promise<SampleForm>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result } = renderHook(() =>
      useAutoSaveForm({
        initial: { name: "V0", enabled: false },
        canEdit: true,
        save,
      }),
    );

    act(() => {
      result.current.update((prev) => ({ ...prev, name: "V1" }), { immediate: true });
    });
    act(() => {
      result.current.update((prev) => ({ ...prev, name: "V2" }), { immediate: true });
    });

    await act(async () => {
      first.reject(new Error("stale failure"));
      await Promise.resolve();
    });

    expect(result.current.error).toBe("");
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, { name: "V2", enabled: false });

    await act(async () => {
      second.resolve({ name: "V2", enabled: false });
      await second.promise;
    });

    expect(result.current.saveState).toBe("saved");
    expect(result.current.error).toBe("");
  });

  it("blocks saving on validation failure and preserves invalid input over stale in-flight completion", async () => {
    vi.useFakeTimers();
    const first = createDeferred<SampleForm>();
    const save = vi.fn(() => first.promise);
    const validate = (form: SampleForm) => (form.name.trim() ? "" : "名称不能为空");

    const { result } = renderHook(() =>
      useAutoSaveForm({
        initial: { name: "Valid", enabled: false },
        canEdit: true,
        validate,
        save,
      }),
    );

    act(() => {
      result.current.update((prev) => ({ ...prev, enabled: true }), { immediate: true });
    });
    expect(save).toHaveBeenCalledTimes(1);

    // User types invalid blank name while in-flight save is still running.
    act(() => {
      result.current.update((prev) => ({ ...prev, name: "  " }));
    });
    expect(result.current.saveState).toBe("error");
    expect(result.current.error).toBe("名称不能为空");

    await act(async () => {
      first.resolve({ name: "Valid", enabled: true });
      await first.promise;
    });

    // Must not overwrite invalid user input or clear validation error.
    expect(result.current.form.name).toBe("  ");
    expect(result.current.saveState).toBe("error");
    expect(result.current.error).toBe("名称不能为空");
    expect(result.current.dirty).toBe(true);

    // Blur and timer while invalid must not trigger save.
    await act(async () => {
      result.current.handleBlur();
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(save).toHaveBeenCalledTimes(1);

    // Fixing validation error enables saving again.
    const second = createDeferred<SampleForm>();
    save.mockReturnValueOnce(second.promise);
    act(() => {
      result.current.update((prev) => ({ ...prev, name: "Fixed" }));
    });
    expect(result.current.error).toBe("");
    expect(result.current.saveState).toBe("idle");

    await act(async () => {
      result.current.handleBlur();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ name: "Fixed", enabled: true });

    await act(async () => {
      second.resolve({ name: "Fixed", enabled: true });
      await second.promise;
    });
    expect(result.current.saveState).toBe("saved");
    expect(result.current.dirty).toBe(false);
  });

  it("reports save errors with fallback message and supports retrying via flush", async () => {
    const save = vi.fn<(_: SampleForm) => Promise<SampleForm>>()
      .mockRejectedValueOnce("network down")
      .mockResolvedValueOnce({ name: "Retried", enabled: true });

    const { result } = renderHook(() =>
      useAutoSaveForm({
        initial: { name: "Init", enabled: false },
        canEdit: true,
        save,
        errorFallback: "自定义保存失败",
      }),
    );

    act(() => {
      result.current.update({ name: "Retried", enabled: true }, { immediate: true });
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.saveState).toBe("error");
    expect(result.current.error).toBe("自定义保存失败");
    expect(result.current.dirty).toBe(true);
    expect(result.current.form).toEqual({ name: "Retried", enabled: true });

    await act(async () => {
      await result.current.flush();
    });

    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.saveState).toBe("saved");
    expect(result.current.error).toBe("");
    expect(result.current.dirty).toBe(false);
  });

  it("resyncs from updated initial prop when idle, hydrates from null, and preserves edits when dirty", async () => {
    const save = vi.fn(async (form: SampleForm) => ({ ...form }));

    const { result, rerender } = renderHook(
      ({ initial }: { initial: SampleForm | null }) =>
        useAutoSaveForm({
          initial,
          canEdit: true,
          save,
        }),
      { initialProps: { initial: null as SampleForm | null } },
    );

    expect(result.current.form).toBeNull();

    // Hydrate from null -> initial object.
    rerender({ initial: { name: "Loaded", enabled: false } });
    expect(result.current.form).toEqual({ name: "Loaded", enabled: false });

    // Resync while idle.
    rerender({ initial: { name: "Refetched", enabled: true } });
    expect(result.current.form).toEqual({ name: "Refetched", enabled: true });

    // Local dirty edit blocks external initial overwrite.
    act(() => {
      result.current.update({ name: "UserDraft", enabled: true });
    });
    rerender({ initial: { name: "StaleServer", enabled: false } });
    expect(result.current.form).toEqual({ name: "UserDraft", enabled: true });
  });

  it("skips resync after hydration when resyncOnInitialChange is false", () => {
    const save = vi.fn(async (form: SampleForm) => ({ ...form }));

    const { result, rerender } = renderHook(
      ({ initial }: { initial: SampleForm | null }) =>
        useAutoSaveForm({
          initial,
          canEdit: true,
          save,
          resyncOnInitialChange: false,
        }),
      { initialProps: { initial: null as SampleForm | null } },
    );

    rerender({ initial: { name: "First", enabled: false } });
    expect(result.current.form).toEqual({ name: "First", enabled: false });

    rerender({ initial: { name: "Second", enabled: true } });
    expect(result.current.form).toEqual({ name: "First", enabled: false });
  });

  it("flushes pending valid changes on pagehide and unmount, and blocks saves when canEdit is false", async () => {
    const save = vi.fn(async (form: SampleForm) => ({ ...form }));
    const onSaved = vi.fn();

    const { result, rerender, unmount } = renderHook(
      ({ canEdit }: { canEdit: boolean }) =>
        useAutoSaveForm({
          initial: { name: "Init", enabled: false },
          canEdit,
          save,
          onSaved,
        }),
      { initialProps: { canEdit: false } },
    );

    act(() => {
      result.current.update({ name: "ReadOnlyAttempt", enabled: true }, { immediate: true });
    });
    expect(save).not.toHaveBeenCalled();

    rerender({ canEdit: true });
    act(() => {
      result.current.update({ name: "PageHideDraft", enabled: true });
    });
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ name: "PageHideDraft", enabled: true });

    act(() => {
      result.current.update({ name: "UnmountDraft", enabled: false });
    });
    unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ name: "UnmountDraft", enabled: false });
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it("transforms payload and maps saved server state when TForm differs from TSaved", async () => {
    const save = vi.fn(async (raw: string) => ({ maxMinutes: Number(raw) * 2 }));
    const { result } = renderHook(() =>
      useAutoSaveForm<string, { maxMinutes: number }>({
        initial: "30",
        canEdit: true,
        save,
        mapSaved: (saved) => String(saved.maxMinutes),
      }),
    );

    await act(async () => {
      result.current.update("45", { immediate: true });
    });

    expect(save).toHaveBeenCalledWith("45");
    expect(result.current.form).toBe("90");
    expect(result.current.saveState).toBe("saved");
  });
});

describe("AutoSaveStatus and AutoSaveError", () => {
  it("renders status caption only while saving or saved with expected classes and roles", () => {
    const { rerender } = render(createElement(AutoSaveStatus, { state: "idle" }));
    expect(screen.queryByRole("status")).toBeNull();

    rerender(createElement(AutoSaveStatus, { state: "error" }));
    expect(screen.queryByRole("status")).toBeNull();

    rerender(createElement(AutoSaveStatus, { state: "saving" }));
    const saving = screen.getByRole("status");
    expect(saving).toHaveTextContent("正在自动保存…");
    expect(saving).toHaveClass("bk-settings-save-status", "bk-typography-caption");

    rerender(createElement(AutoSaveStatus, { state: "saved" }));
    const saved = screen.getByRole("status");
    expect(saved).toHaveTextContent("已自动保存");
    expect(saved).toHaveClass("bk-settings-save-status", "bk-typography-caption");
  });

  it("renders error alert when non-empty", () => {
    const { rerender } = render(createElement(AutoSaveError, { error: "" }));
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(createElement(AutoSaveError, { error: "保存出错" }));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("保存出错");
    expect(alert).toHaveClass("bk-settings-save-status", "bk-settings-save-status--error");
  });
});
