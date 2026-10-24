// Small fetch wrapper. The session token goes in the Authorization header.
export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export function getToken(): string | null {
  try {
    return sessionStorage.getItem("ug.token");
  } catch {
    return null;
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = getToken();
  if (token && opts.auth !== false) headers.authorization = "Bearer " + token;
  let res: Response;
  try {
    res = await fetch("/api" + path, { method: opts.method ?? (opts.body ? "POST" : "GET"), headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new ApiError("No connection to the server", 0);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error ?? `Request failed (${res.status})`, res.status);
  return json as T;
}
