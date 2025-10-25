const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const STATIC_TOKEN = process.env.NEXT_PUBLIC_JWT;

type RequestOptions<TBody> = {
  path: string;
  method?: string;
  body?: TBody;
  headers?: Record<string, string>;
};

export type ApiResponse<T> = {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
};

export async function apiRequest<TResponse, TBody = unknown>(
  options: RequestOptions<TBody>,
): Promise<ApiResponse<TResponse>> {
  const url = `${API_URL}${options.path}`;
  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
  };

  const token = STATIC_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body,
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: typeof payload === "string" ? payload : payload?.detail ?? "Request failed",
    };
  }

  return {
    ok: true,
    status: response.status,
    data: payload as TResponse,
  };
}
