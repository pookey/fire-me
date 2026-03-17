import { useState, useRef } from 'react';
import { importData } from '../utils/api';

interface CsvRow {
  [key: string]: string;
}

export default function Import() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setError('');
    setSuccess('');

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.trim().split('\n');
      if (lines.length < 2) {
        setError('CSV file must have a header row and at least one data row');
        return;
      }

      const parsedHeaders = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      setHeaders(parsedHeaders);

      const rows: CsvRow[] = lines.slice(1, 21).map(line => {
        const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
        const row: CsvRow = {};
        parsedHeaders.forEach((header, i) => {
          row[header] = values[i] || '';
        });
        return row;
      });
      setPreview(rows);
    };
    reader.readAsText(selected);
  };

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setError('');
    setSuccess('');
    try {
      const result = await importData({ funds: [], snapshots: [] });
      setSuccess(`Successfully imported ${result.fundsImported} funds, ${result.snapshotsImported} snapshots`);
      setFile(null);
      setPreview([]);
      setHeaders([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <h2 className="font-display text-2xl font-semibold animate-in" style={{ color: 'var(--text-primary)' }}>
        Import Data
      </h2>

      {error && (
        <div className="text-sm px-4 py-3 rounded-lg" style={{ background: 'var(--negative-dim)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
          {error}
        </div>
      )}
      {success && (
        <div className="text-sm px-4 py-3 rounded-lg" style={{ background: 'var(--positive-dim)', color: '#86efac', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
          {success}
        </div>
      )}

      {/* Upload area */}
      <div className="card p-5 animate-in stagger-1">
        <div
          className="rounded-lg p-10 text-center"
          style={{ border: '2px dashed var(--border-medium)', background: 'var(--surface-1)' }}
        >
          <svg className="mx-auto h-10 w-10 mb-3" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <p className="text-sm mb-4" style={{ color: 'var(--text-tertiary)' }}>
            Upload a CSV file to import snapshot data
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:cursor-pointer"
            style={{ color: 'var(--text-tertiary)' }}
          />
        </div>
      </div>

      {/* Preview table */}
      {preview.length > 0 && (
        <div className="card p-5 animate-in">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              Preview ({preview.length} of {file?.name} rows)
            </h3>
            <button
              onClick={handleImport}
              disabled={importing}
              className="btn-gold"
            >
              {importing ? 'Importing...' : 'Confirm Import'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="table-dark">
              <thead>
                <tr>
                  {headers.map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i}>
                    {headers.map(h => (
                      <td key={h}>{row[h]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
