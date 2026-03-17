import { format, parseISO } from 'date-fns';

export function formatPence(pence: number): string {
  const pounds = pence / 100;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(pounds);
}

export function formatPenceShort(pence: number): string {
  const pounds = pence / 100;
  if (Math.abs(pounds) >= 1_000_000) {
    return `\u00a3${(pounds / 1_000_000).toFixed(1)}m`;
  }
  if (Math.abs(pounds) >= 1_000) {
    return `\u00a3${(pounds / 1_000).toFixed(1)}k`;
  }
  return `\u00a3${pounds.toFixed(0)}`;
}

export function formatPoundsShort(pounds: number): string {
  if (Math.abs(pounds) >= 1_000_000) {
    return `\u00a3${(pounds / 1_000_000).toFixed(1)}m`;
  }
  if (Math.abs(pounds) >= 1_000) {
    return `\u00a3${(pounds / 1_000).toFixed(1)}k`;
  }
  return `\u00a3${pounds.toFixed(0)}`;
}

export function formatDate(date: string): string {
  return format(parseISO(date), 'MMM yyyy');
}
