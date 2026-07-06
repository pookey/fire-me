import { MONTH_NAMES } from '../utils/dateHelpers';

export default function MonthYearPicker({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  const [yStr, mStr] = (value ?? '').split('-');
  const month = mStr ? Number(mStr) : 0;
  const year = yStr ? Number(yStr) : 0;
  const thisYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = thisYear - 1; y <= thisYear + 10; y++) years.push(y);

  const update = (nextMonth: number, nextYear: number) => {
    if (!nextMonth || !nextYear) {
      onChange(undefined);
      return;
    }
    onChange(`${nextYear}-${String(nextMonth).padStart(2, '0')}`);
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      <select
        value={month || ''}
        onChange={e => update(Number(e.target.value), year || thisYear)}
        className="input-dark"
      >
        <option value="">Month</option>
        {MONTH_NAMES.map((name, i) => (
          <option key={name} value={i + 1}>{name}</option>
        ))}
      </select>
      <select
        value={year || ''}
        onChange={e => update(month, Number(e.target.value))}
        className="input-dark"
      >
        <option value="">Year</option>
        {years.map(y => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  );
}
