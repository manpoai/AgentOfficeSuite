'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Upload, X, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { parseCsv, type CsvParseResult } from '@/lib/csv-parser';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ROWS = 50_000;
const MAX_COLS = 100;

export interface CsvImportNewTableDialogProps {
  onClose: () => void;
  onImport: (tableName: string, parsed: CsvParseResult) => Promise<void>;
}

export function CsvImportNewTableDialog({ onClose, onImport }: CsvImportNewTableDialogProps) {
  const { t } = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [tableName, setTableName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setParsed(null);

    if (file.size > MAX_FILE_SIZE) {
      setError(t('csvImport.fileTooLarge'));
      return;
    }

    const name = file.name.replace(/\.csv$/i, '');
    setTableName(name);

    const reader = new FileReader();
    reader.onerror = () => setError(t('csvImport.parseError'));
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) { setError(t('csvImport.parseError')); return; }

      try {
        const result = parseCsv(text);
        if (result.headers.length === 0 || result.rows.length === 0) {
          setError(t('csvImport.emptyFile'));
          return;
        }
        if (result.rows.length > MAX_ROWS) {
          setError(t('csvImport.tooManyRows'));
          return;
        }
        if (result.headers.length > MAX_COLS) {
          setError(t('csvImport.tooManyColumns'));
          return;
        }
        setParsed(result);
      } catch {
        setError(t('csvImport.parseError'));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [t]);

  const handleImport = async () => {
    if (!parsed || !tableName.trim()) return;
    setImporting(true);
    setError(null);
    try {
      await onImport(tableName.trim(), parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('csvImport.createTableFailed'));
      setImporting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">{t('csvImport.title')}</h3>
            <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-4">
            {/* File picker */}
            {!parsed && !error && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex flex-col items-center justify-center gap-2 py-8 border-2 border-dashed border-border rounded-lg hover:border-sidebar-primary/50 hover:bg-sidebar-primary/5 transition-colors"
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Click to select a .csv file</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileSelect}
            />

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}

            {/* Preview */}
            {parsed && (
              <>
                {/* Table name */}
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">{t('csvImport.tableName')}</label>
                  <input
                    value={tableName}
                    onChange={e => setTableName(e.target.value)}
                    className="w-full bg-muted rounded px-3 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-sidebar-primary"
                  />
                </div>

                {/* Stats */}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <FileSpreadsheet className="h-4 w-4" />
                  <span>{t('csvImport.columns', { n: parsed.headers.length })}</span>
                  <span>·</span>
                  <span>{t('csvImport.rows', { n: parsed.rows.length })}</span>
                </div>

                {/* Preview table */}
                <div className="border border-border rounded-lg overflow-auto max-h-48">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/50">
                        {parsed.headers.map((h, i) => (
                          <th key={i} className="px-3 py-1.5 text-left font-medium text-foreground whitespace-nowrap border-b border-border">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.rawRows.slice(0, 5).map((row, ri) => (
                        <tr key={ri} className="border-b border-border last:border-0">
                          {parsed.headers.map((_, ci) => (
                            <td key={ci} className="px-3 py-1.5 text-muted-foreground whitespace-nowrap max-w-[200px] truncate">
                              {row[ci] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {parsed.rows.length > 5 && (
                  <p className="text-[10px] text-muted-foreground text-center">
                    … and {parsed.rows.length - 5} more rows
                  </p>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
            {error && !parsed && (
              <button
                onClick={() => { setError(null); fileInputRef.current?.click(); }}
                className="mr-auto px-3 py-1.5 text-xs text-sidebar-primary hover:underline"
              >
                Try another file
              </button>
            )}
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded border border-border"
            >
              {t('common.cancel')}
            </button>
            {parsed && (
              <button
                onClick={handleImport}
                disabled={importing || !tableName.trim()}
                className="px-3 py-1.5 text-xs text-white bg-sidebar-primary rounded hover:opacity-90 disabled:opacity-50"
              >
                {importing ? t('csvImport.importing') : t('csvImport.importBtn')}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
