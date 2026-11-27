export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
export const STORE_ID = import.meta.env.VITE_STORE_ID ?? '';

export interface Session {
  token: string;
  user: { sub: string; storeId: string; role: string; name: string };
}

export async function api<T>(path: string, init: RequestInit = {}, session?: Session | null): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Erro ${res.status}`);
  }
  return res.json() as Promise<T>;
}
