import { afterEach, beforeEach, expect, it, vi } from "vitest";

class UploadRequest extends EventTarget {
  static instances: UploadRequest[] = [];
  upload = new EventTarget();
  status = 200;
  responseText = "";
  withCredentials = false;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  getResponseHeader = vi.fn().mockReturnValue("upload-request-12345");
  constructor() { super(); UploadRequest.instances.push(this); }
  respond(body: string, status = 200) {
    this.status = status;
    this.responseText = body;
    this.dispatchEvent(new Event("load"));
  }
}

let api: typeof import("./client").api;
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("VITE_DEMO_MODE", "false");
  vi.stubGlobal("XMLHttpRequest", UploadRequest);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: "csrf-token" }))));
  UploadRequest.instances = [];
  api = (await import("./client")).api;
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function startUpload(kind: "book" | "font") {
  const file = new File(["content"], kind === "book" ? "book.pdf" : "reader.woff2");
  const progress = vi.fn();
  const promise = kind === "book" ? api.uploadBookContent("upload-1", file, progress)
    : api.uploadReaderFontContent("font-1", file, progress);
  const result = promise.then(value => ({ value }), error => ({ error }));
  await vi.waitFor(() => expect(UploadRequest.instances).toHaveLength(1));
  return { request: UploadRequest.instances[0], result, file, progress };
}

it.each(["book", "font"] as const)("preserves credentials, CSRF and upload progress for %s content", async kind => {
  const { request, result, file, progress } = await startUpload(kind);
  const path = kind === "book" ? "/api/v1/book-uploads/upload-1/content" : "/api/v1/reader-fonts/font-1/content";
  expect(request.open).toHaveBeenCalledWith("PUT", path);
  expect(request.withCredentials).toBe(true);
  expect(request.setRequestHeader).toHaveBeenCalledWith("X-XSRF-TOKEN", "csrf-token");
  expect(request.send).toHaveBeenCalledWith(file);
  request.upload.dispatchEvent(new ProgressEvent("progress", { lengthComputable: true, loaded: 1, total: 4 }));
  expect(progress).toHaveBeenCalledWith(25);
  const saved = { id: kind === "book" ? "upload-1" : "font-1", status: kind === "book" ? "INSPECTING" : "ENABLED" };
  request.respond(JSON.stringify(saved));
  expect(await result).toEqual({ value: saved });
});

it.each(["book", "font"] as const)("rejects a malformed successful %s response instead of leaving the upload pending", async kind => {
  const { request, result } = await startUpload(kind);
  request.respond("<html>Unexpected gateway response</html>");
  expect(await result).toMatchObject({ error: expect.objectContaining({ message: expect.stringContaining("无效响应") }) });
});

it.each(["book", "font"] as const)("reports a plain-text %s upload failure", async kind => {
  const { request, result } = await startUpload(kind);
  request.respond("Bad gateway", 502);
  expect(await result).toMatchObject({ error: expect.objectContaining({ message: expect.stringContaining("上传失败") }) });
});

it.each(["book", "font"] as const)("preserves a server-provided %s upload failure message", async kind => {
  const { request, result } = await startUpload(kind);
  request.respond(JSON.stringify({ detail: "文件格式不受支持" }), 422);
  expect(await result).toMatchObject({ error: expect.objectContaining({ message: "文件格式不受支持" }) });
});

it.each(["book", "font"] as const)("reports a disconnected %s upload", async kind => {
  const { request, result } = await startUpload(kind);
  request.dispatchEvent(new Event("error"));
  expect(await result).toMatchObject({ error: expect.objectContaining({ message: expect.stringContaining("网络中断") }) });
});

it.each(["book", "font"] as const)("rejects invalid JSON resource shapes for %s uploads", async kind => {
  const id = kind === "book" ? "upload-1" : "font-1";
  for (const body of ["null", "[]", '"ok"', "{}", '{"id":"different-resource","status":"ENABLED"}', JSON.stringify({ id, status: "UNKNOWN" })]) {
    UploadRequest.instances = [];
    const { request, result } = await startUpload(kind);
    request.respond(body);
    expect(await result).toMatchObject({ error: expect.objectContaining({ message: expect.stringContaining("无效响应") }) });
  }
});

it.each(["book", "font"] as const)("preserves structured diagnostics for a %s upload failure", async kind => {
  const { request, result } = await startUpload(kind);
  request.respond(JSON.stringify({ type: "urn:humite:error:storage_unavailable", detail: "存储暂不可用。", code: "STORAGE_UNAVAILABLE" }), 503);
  expect(await result).toMatchObject({ error: expect.objectContaining({
    status: 503, code: "STORAGE_UNAVAILABLE", traceId: "upload-request-12345", message: "存储暂不可用。",
  }) });
});

it.each(["book", "font"] as const)("hides an unrecognized server error body for %s uploads", async kind => {
  const { request, result } = await startUpload(kind);
  request.respond(JSON.stringify({ detail: "/private/backend/path: secret connection string" }), 502);
  const outcome = await result;
  expect(outcome).toMatchObject({ error: expect.objectContaining({ status: 502, code: "HTTP_502" }) });
  if ("error" in outcome) expect(outcome.error.message).not.toContain("/private/");
});

it.each(["book", "font"] as const)("reports an aborted %s upload", async kind => {
  const { request, result } = await startUpload(kind);
  request.dispatchEvent(new Event("abort"));
  expect(await result).toMatchObject({ error: expect.objectContaining({ message: "上传已中止" }) });
});
