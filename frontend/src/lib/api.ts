const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API ${response.status}: ${body}`);
  }

  return response.json() as Promise<T>;
}

export function createSSEConnection(
  path: string,
  onEvent: (event: string, data: string) => void,
  onError?: (error: Event) => void
): EventSource {
  const url = `${API_BASE}${path}`;
  const source = new EventSource(url);
  let isClosed = false;

  source.onmessage = (event) => {
    if (isClosed) return;
    onEvent("message", event.data);
  };

  source.addEventListener("progress", (event) => {
    if (isClosed) return;
    onEvent("progress", (event as MessageEvent).data);
  });

  source.addEventListener("ping", (event) => {
    if (isClosed) return;
    onEvent("ping", (event as MessageEvent).data);
  });

  source.addEventListener("complete", (event) => {
    isClosed = true;
    onEvent("complete", (event as MessageEvent).data);
    source.close();
  });

  source.addEventListener("error", (event) => {
    if (isClosed) return;
    isClosed = true;
    onEvent("error", (event as MessageEvent).data || JSON.stringify({ message: "SSE connection error" }));
    if (onError) onError(event);
    source.close();
  });

  return source;
}
