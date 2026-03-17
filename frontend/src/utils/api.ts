import { getAuthToken } from './auth';
import type { Fund, Snapshot, FireConfig, FireScenario, Income, Expense } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAuthToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  return response;
}

export async function getFunds(): Promise<Fund[]> {
  const res = await authFetch('/funds');
  return res.json();
}

export async function createFund(fund: Omit<Fund, 'id'>): Promise<Fund> {
  const res = await authFetch('/funds', {
    method: 'POST',
    body: JSON.stringify(fund),
  });
  return res.json();
}

export async function updateFund(id: string, fund: Partial<Fund>): Promise<Fund> {
  const res = await authFetch(`/funds/${id}`, {
    method: 'PUT',
    body: JSON.stringify(fund),
  });
  return res.json();
}

export async function getSnapshots(from?: string, to?: string): Promise<Snapshot[]> {
  const fromDate = from || '2000-01-01';
  const toDate = to || '2099-12-31';
  const res = await authFetch(`/snapshots?from=${fromDate}&to=${toDate}`);
  return res.json();
}

export async function getSnapshotsByFund(fundId: string, from?: string, to?: string): Promise<Snapshot[]> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await authFetch(`/funds/${fundId}/snapshots${query}`);
  return res.json();
}

export async function createSnapshot(fundId: string, snapshot: { date: string; value: number }): Promise<Snapshot> {
  const res = await authFetch(`/funds/${fundId}/snapshots`, {
    method: 'POST',
    body: JSON.stringify(snapshot),
  });
  return res.json();
}

export async function batchCreateSnapshots(data: { date: string; values: { fundId: string; value: number }[] }): Promise<{ message: string; count: number }> {
  const res = await authFetch('/snapshots/batch', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteSnapshot(fundId: string, date: string): Promise<void> {
  await authFetch(`/funds/${fundId}/snapshots/${date}`, {
    method: 'DELETE',
  });
}

export async function getFireConfig(): Promise<FireConfig> {
  const res = await authFetch('/fire-config');
  return res.json();
}

export async function updateFireConfig(config: FireConfig): Promise<FireConfig> {
  const res = await authFetch('/fire-config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  return res.json();
}

export async function importData(data: { funds: unknown[]; snapshots: unknown[] }): Promise<{ message: string; fundsImported: number; snapshotsImported: number }> {
  const res = await authFetch('/import', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.json();
}

// Income
export async function getIncome(): Promise<Income[]> {
  const res = await authFetch('/income');
  return res.json();
}

export async function createIncome(income: Omit<Income, 'id'>): Promise<Income> {
  const res = await authFetch('/income', {
    method: 'POST',
    body: JSON.stringify(income),
  });
  return res.json();
}

export async function updateIncome(id: string, income: Partial<Income>): Promise<Income> {
  const res = await authFetch(`/income/${id}`, {
    method: 'PUT',
    body: JSON.stringify(income),
  });
  return res.json();
}

export async function deleteIncome(id: string): Promise<void> {
  await authFetch(`/income/${id}`, { method: 'DELETE' });
}

// Expenses
export async function getExpenses(): Promise<Expense[]> {
  const res = await authFetch('/expenses');
  return res.json();
}

export async function createExpense(expense: Omit<Expense, 'id'>): Promise<Expense> {
  const res = await authFetch('/expenses', {
    method: 'POST',
    body: JSON.stringify(expense),
  });
  return res.json();
}

export async function updateExpense(id: string, expense: Partial<Expense>): Promise<Expense> {
  const res = await authFetch(`/expenses/${id}`, {
    method: 'PUT',
    body: JSON.stringify(expense),
  });
  return res.json();
}

export async function deleteExpense(id: string): Promise<void> {
  await authFetch(`/expenses/${id}`, { method: 'DELETE' });
}

// --- FIRE Scenarios ---

export async function getFireScenarios(): Promise<FireScenario[]> {
  const res = await authFetch('/fire-scenarios');
  return res.json();
}

export async function createFireScenario(scenario: { name: string; config: FireConfig }): Promise<FireScenario> {
  const res = await authFetch('/fire-scenarios', {
    method: 'POST',
    body: JSON.stringify(scenario),
  });
  return res.json();
}

export async function updateFireScenario(id: string, scenario: { name: string; config: FireConfig }): Promise<FireScenario> {
  const res = await authFetch(`/fire-scenarios/${id}`, {
    method: 'PUT',
    body: JSON.stringify(scenario),
  });
  return res.json();
}

export async function deleteFireScenario(id: string): Promise<void> {
  await authFetch(`/fire-scenarios/${id}`, {
    method: 'DELETE',
  });
}
