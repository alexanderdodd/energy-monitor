/**
 * Every request is resolved against the document base URL, which the server
 * sets from the Ingress path. That keeps the same bundle working at `/`
 * during development and under `/api/hassio_ingress/<token>/` in Home
 * Assistant, without any absolute URLs.
 */
export function apiUrl(path: string): string {
  const relative = path.replace(/^\//, "");
  return new URL(relative, document.baseURI).toString();
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the status-based message.
    }
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  put: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
};
