const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const api = {
  getSessions: (page = 1, limit = 20) =>
    request<any>(`/sessions?page=${page}&limit=${limit}`),

  getSession: (id: string) =>
    request<any>(`/sessions/${id}`),

  getSnapshots: (id: string, from?: string, to?: string) => {
    let url = `/sessions/${id}/snapshots`;
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (params.toString()) url += `?${params}`;
    return request<any>(url);
  },

  getHighlights: (id: string) =>
    request<any>(`/sessions/${id}/highlights`),

  deleteSession: (id: string) =>
    request<any>(`/sessions/${id}`, { method: 'DELETE' }),

  getChannels: () =>
    request<any>('/channels'),

  createChannel: (data: any) =>
    request<any>('/channels', { method: 'POST', body: JSON.stringify(data) }),

  updateChannel: (id: string, data: any) =>
    request<any>(`/channels/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteChannel: (id: string) =>
    request<any>(`/channels/${id}`, { method: 'DELETE' }),

  getWorkers: () =>
    request<any>('/workers'),

  exportSession: (id: string, format: string) =>
    `/sessions/${id}/export/${format}`,

  deleteMe: () =>
    request<void>('/me', { method: 'DELETE' }),
};
