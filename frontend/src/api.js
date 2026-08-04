const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000/api';

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new ApiError(payload.error?.message ?? 'Request failed', response.status, payload.error?.code);
  }
  return payload;
}

export const api = {
  register: (data) => request('/auth/register', { method: 'POST', body: data }),
  login: (data) => request('/auth/login', { method: 'POST', body: data }),
  me: (token) => request('/me', { token }),
  listWorkflows: (token) => request('/workflows', { token }),
  createWorkflow: (token, workflow) => request('/workflows', { method: 'POST', token, body: workflow }),
  updateWorkflow: (token, id, workflow) => request(`/workflows/${id}`, { method: 'PUT', token, body: workflow }),
  deleteWorkflow: (token, id) => request(`/workflows/${id}`, { method: 'DELETE', token }),
  runWorkflow: (token, id, input) => request(`/workflows/${id}/run`, { method: 'POST', token, body: { input } }),
  listExecutions: (token, id) => request(`/workflows/${id}/executions`, { token })
};
