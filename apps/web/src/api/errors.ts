/** Shared diagnostic model independent of transport and authentication contexts. */
export class ApiRequestError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string,
    public readonly traceId?: string) { super(message); }
}

export function createApiRequestError(status: number, payload: unknown, options: {
  requestId?: string | null;
  fallbackMessage?: string;
} = {}): ApiRequestError {
  const problem = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const code = typeof problem.code === "string" && /^[A-Z0-9_]{1,100}$/.test(problem.code) ? problem.code : `HTTP_${status}`;
  const trace = problem.traceId ?? options.requestId;
  const traceId = typeof trace === "string" && /^[a-z0-9_-]{8,128}$/i.test(trace) ? trace : undefined;
  const knownProblem = typeof problem.type === "string" && problem.type.startsWith("urn:humite:error:");
  const detail = status < 500 || knownProblem ? problem.detail ?? problem.title : undefined;
  const fallback = options.fallbackMessage ?? (status >= 500 ? "书库服务暂时不可用，请稍后重试。"
    : status === 401 ? "登录已过期，请重新登录。" : "请求失败，请稍后重试。");
  return new ApiRequestError(typeof detail === "string" ? detail : fallback, status, code, traceId);
}
