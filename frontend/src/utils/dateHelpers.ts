export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatStartDate(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  if (!y || !m) return '';
  return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' });
}

export function isFutureMonth(dateStr: string): boolean {
  const [y, m] = dateStr.split('-').map(Number);
  if (!y || !m) return false;
  const now = new Date();
  return y * 12 + m > now.getFullYear() * 12 + (now.getMonth() + 1);
}
