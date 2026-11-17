import { createApiRequestError } from "./errors";

interface UploadedResource { id: string; status: string }

interface BinaryUploadOptions<T extends UploadedResource> {
  file: File;
  csrfToken: string;
  onProgress: (progress: number) => void;
  expectedResponse: { id: string; statuses: readonly T["status"][] };
  messages: {
    failed: string;
    interrupted: string;
    invalidResponse: string;
  };
}

export function uploadBinary<T extends UploadedResource>(path: string, { file, csrfToken, onProgress, expectedResponse, messages }: BinaryUploadOptions<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", path);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-XSRF-TOKEN", csrfToken);
    xhr.upload.addEventListener("progress", event => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    xhr.addEventListener("load", () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(uploadFailure(xhr, messages.failed));
        return;
      }
      try {
        const resource = JSON.parse(xhr.responseText) as Partial<UploadedResource> | null;
        if (!resource || resource.id !== expectedResponse.id || typeof resource.status !== "string"
          || !expectedResponse.statuses.includes(resource.status)) {
          reject(new Error(messages.invalidResponse));
          return;
        }
        resolve(resource as T);
      } catch {
        reject(new Error(messages.invalidResponse));
      }
    });
    xhr.addEventListener("error", () => reject(new Error(messages.interrupted)));
    xhr.addEventListener("abort", () => reject(new Error("上传已中止")));
    xhr.send(file);
  });
}

function uploadFailure(xhr: XMLHttpRequest, fallbackMessage: string) {
  let payload: unknown;
  try {
    payload = JSON.parse(xhr.responseText);
  } catch {
    payload = undefined;
  }
  return createApiRequestError(xhr.status, payload, { requestId: xhr.getResponseHeader("X-Request-ID"), fallbackMessage });
}
