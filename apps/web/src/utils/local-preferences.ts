export function readLocalPreference(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveLocalPreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences remain usable in memory when storage is blocked or full.
  }
}

export function removeLocalPreference(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 删除草稿失败不应中断阅读；当前选区仍可正常关闭。
    // A failed draft removal must not block reading or closing the active selection.
  }
}
