'use client';

/**
 * AddFieldDialog — Modal for adding/editing table fields.
 * Extracted from TableEditor.tsx during refactoring — no behavior changes.
 */

import React from 'react';
import { Plus, X, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import * as br from '@/lib/api/tables';
import {
  ColTypeDef, COLUMN_TYPES, GROUP_KEYS,
  getColIcon, SELECT_COLORS, isSelectType,
} from './types';

export interface AddFieldDialogProps {
  // State
  newColTitle: string;
  setNewColTitle: (v: string) => void;
  newColType: string;
  setNewColType: (v: string) => void;
  showTypeSelector: boolean;
  setShowTypeSelector: (v: boolean) => void;
  newColOptionsList: string[];
  setNewColOptionsList: (v: string[]) => void;
  newColFormula: string;
  setNewColFormula: (v: string) => void;
  newColRelTable: string;
  setNewColRelTable: (v: string) => void;
  newColRelMulti: boolean;
  setNewColRelMulti: (v: boolean) => void;
  newColRelCol: string;
  setNewColRelCol: (v: string) => void;
  newColLookupCol: string;
  setNewColLookupCol: (v: string) => void;
  newColRollupCol: string;
  setNewColRollupCol: (v: string) => void;
  newColRollupFn: string;
  setNewColRollupFn: (v: string) => void;
  decimalPrecision: number;
  setDecimalPrecision: (v: number) => void;
  currencySymbol: string;
  setCurrencySymbol: (v: string) => void;
  ratingMax: number;
  setRatingMax: (v: number) => void;
  ratingIcon: string;
  setRatingIcon: (v: string) => void;
  dateFormat: string;
  setDateFormat: (v: string) => void;
  // Context
  editFieldColId: string | null;
  editFieldAnchor: { x: number; y: number } | null;
  meta: br.BRTableMeta | undefined;
  displayCols: br.BRColumn[];
  allTables: br.BRTable[] | undefined;
  relatedMeta: br.BRTableMeta | undefined;
  tableId: string;
  newColRef: React.RefObject<HTMLInputElement | null>;
  // Actions
  onSave: () => void;
  onClose: () => void;
}

export function AddFieldDialog({
  newColTitle, setNewColTitle, newColType, setNewColType,
  showTypeSelector, setShowTypeSelector,
  newColOptionsList, setNewColOptionsList,
  newColFormula, setNewColFormula,
  newColRelTable, setNewColRelTable,
  newColRelMulti, setNewColRelMulti,
  newColRelCol, setNewColRelCol,
  newColLookupCol, setNewColLookupCol,
  newColRollupCol, setNewColRollupCol,
  newColRollupFn, setNewColRollupFn,
  decimalPrecision, setDecimalPrecision,
  currencySymbol, setCurrencySymbol,
  ratingMax, setRatingMax,
  ratingIcon, setRatingIcon,
  dateFormat, setDateFormat,
  editFieldColId, editFieldAnchor,
  meta, displayCols, allTables, relatedMeta, tableId,
  newColRef, onSave, onClose,
}: AddFieldDialogProps) {
  const { t } = useT();

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-96 max-h-[70vh] flex flex-col"
        style={editFieldAnchor ? { position: 'fixed', left: Math.max(0, editFieldAnchor.x), top: Math.min(editFieldAnchor.y, window.innerHeight - 400) } : { position: 'fixed', left: '50%', top: '15vh', transform: 'translateX(-50%)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 flex-1 overflow-y-auto space-y-5">
          {/* Field title */}
          <div>
            <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.fieldTitle')}</div>
            <input
              ref={newColRef}
              value={newColTitle}
              onChange={e => setNewColTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onClose(); }}
              placeholder={editFieldColId ? t('dataTable.fieldName') : t(`dataTable.colTypes.${newColType}`)}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-sidebar-primary/50 bg-transparent"
              autoFocus
            />
          </div>

          {/* Field type selector */}
          <div>
            <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.fieldType')}</div>
            <div className="border border-border rounded-lg overflow-hidden">
              {/* Current type row */}
              <button
                onClick={() => setShowTypeSelector(!showTypeSelector)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-accent/50 transition-colors"
              >
                {(() => { const TypeIcon = getColIcon(newColType); return <TypeIcon className="h-4 w-4 text-muted-foreground shrink-0" />; })()}
                <span className="flex-1 text-left">{t(`dataTable.colTypes.${newColType}`)}</span>
                <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', showTypeSelector && 'rotate-180')} />
              </button>
              {/* Expanded type list */}
              {showTypeSelector && (() => {
                const IMMUTABLE_TYPES = new Set(['Links', 'LinkToAnotherRecord', 'Lookup', 'Rollup', 'Formula', 'AutoNumber', 'ID']);
                const TEXT_TYPES = new Set(['SingleLineText', 'LongText', 'Email', 'URL', 'PhoneNumber']);
                const NUM_TYPES = new Set(['Number']);
                const isEditing = !!editFieldColId;
                const origType = isEditing ? (meta?.columns?.find(c => c.column_id === editFieldColId)?.type || newColType) : newColType;
                const getCompat = (from: string, to: string): 'ok' | 'lossy' | 'clear' | 'blocked' => {
                  if (from === to) return 'ok';
                  if (IMMUTABLE_TYPES.has(from) || IMMUTABLE_TYPES.has(to)) return 'blocked';
                  if (TEXT_TYPES.has(from) && TEXT_TYPES.has(to)) return 'ok';
                  if (NUM_TYPES.has(from) && NUM_TYPES.has(to)) return 'ok';
                  if ((from === 'Date' || from === 'DateTime') && (to === 'Date' || to === 'DateTime')) return 'ok';
                  if (from === 'SingleSelect' && to === 'MultiSelect') return 'ok';
                  if (TEXT_TYPES.has(from) && (NUM_TYPES.has(to) || to === 'Date' || to === 'DateTime')) return 'lossy';
                  if (NUM_TYPES.has(from) && TEXT_TYPES.has(to)) return 'ok';
                  const SELECT_TYPES = new Set(['SingleSelect', 'MultiSelect']);
                  if (SELECT_TYPES.has(from) !== SELECT_TYPES.has(to) && !(TEXT_TYPES.has(from) || TEXT_TYPES.has(to))) return 'clear';
                  if ((from === 'Checkbox' && !NUM_TYPES.has(to) && !TEXT_TYPES.has(to)) || (to === 'Checkbox' && !NUM_TYPES.has(from) && !TEXT_TYPES.has(from))) return 'clear';
                  if ((from === 'Attachment' || to === 'Attachment') && from !== to) return 'clear';
                  return 'lossy';
                };
                return (
                <div className="border-t border-border max-h-48 overflow-y-auto">
                  {GROUP_KEYS.map(group => {
                    const label = t(`dataTable.colGroups.${group}`);
                    const types = COLUMN_TYPES.filter(ct => ct.group === group);
                    if (types.length === 0) return null;
                    return (
                      <div key={group}>
                        <div className="px-3 py-1 text-[10px] text-muted-foreground/60 bg-muted/30 sticky top-0">{label}</div>
                        <div className="grid grid-cols-2">
                        {types.map(ct => {
                          const CtIcon = ct.icon;
                          const compat = isEditing ? getCompat(origType, ct.value) : 'ok';
                          if (compat === 'blocked' && ct.value !== origType) return (
                            <div key={ct.value} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground/40 cursor-not-allowed">
                              <CtIcon className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{t(`dataTable.colTypes.${ct.value}`)}</span>
                            </div>
                          );
                          return (
                            <button
                              key={ct.value}
                              onClick={() => {
                                if (compat === 'clear') {
                                  if (!window.confirm(t('dataTable.typeChangeClearConfirm', { from: t(`dataTable.colTypes.${origType}`), to: t(`dataTable.colTypes.${ct.value}`) }))) return;
                                } else if (compat === 'lossy') {
                                  if (!window.confirm(t('dataTable.typeChangeLossyConfirm', { from: t(`dataTable.colTypes.${origType}`), to: t(`dataTable.colTypes.${ct.value}`) }))) return;
                                }
                                setNewColType(ct.value); setShowTypeSelector(false);
                              }}
                              className={cn(
                                'flex items-center gap-1.5 px-3 py-1.5 text-xs hover:bg-accent transition-colors',
                                newColType === ct.value ? 'text-sidebar-primary font-medium bg-sidebar-primary/5' : 'text-foreground'
                              )}
                            >
                              <CtIcon className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{t(`dataTable.colTypes.${ct.value}`)}</span>
                              {compat === 'clear' && ct.value !== origType && <span className="text-[9px] text-destructive ml-auto">&#x26a0;</span>}
                              {compat === 'lossy' && ct.value !== origType && <span className="text-[9px] text-amber-500 ml-auto">!</span>}
                            </button>
                          );
                        })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                );
              })()}
            </div>
          </div>

          {/* Type-specific config */}
          {newColType === 'Decimal' && (
            <div className="space-y-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.decimals')}</div>
                <select
                  value={decimalPrecision}
                  onChange={e => setDecimalPrecision(parseInt(e.target.value) || 2)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none bg-transparent"
                >
                  {[1,2,3,4,5,6,7,8].map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="text-[10px] text-muted-foreground/60">
                {t('dataTable.preview')}: {(1234.5).toFixed(decimalPrecision)}
              </div>
            </div>
          )}
          {newColType === 'Currency' && (
            <div className="space-y-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.currencySymbol')}</div>
                <select
                  value={currencySymbol}
                  onChange={e => setCurrencySymbol(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none bg-transparent"
                >
                  {[
                    { symbol: '$', label: 'USD ($)' },
                    { symbol: '\u00a5', label: 'CNY (\u00a5)' },
                    { symbol: '\u20ac', label: 'EUR (\u20ac)' },
                    { symbol: '\u00a3', label: 'GBP (\u00a3)' },
                    { symbol: 'A$', label: 'AUD (A$)' },
                    { symbol: 'C$', label: 'CAD (C$)' },
                    { symbol: 'S$', label: 'SGD (S$)' },
                    { symbol: '\u20a9', label: 'KRW (\u20a9)' },
                    { symbol: '\u20b9', label: 'INR (\u20b9)' },
                    { symbol: '\u00a5', label: 'JPY (\u00a5)' },
                  ].map(c => <option key={c.label} value={c.symbol}>{c.label}</option>)}
                </select>
              </div>
              <div className="text-[10px] text-muted-foreground/60">
                {t('dataTable.preview')}: {currencySymbol}1,234.56
              </div>
            </div>
          )}
          {newColType === 'Percent' && (
            <div className="text-[10px] text-muted-foreground/60">
              {t('dataTable.preview')}: 85%
            </div>
          )}
          {newColType === 'Rating' && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.ratingSettings')}</div>
              <label className="flex items-center gap-1.5 text-xs text-foreground">
                <span>{t('dataTable.maxValue')}</span>
                <input
                  type="number" min={1} max={10} value={ratingMax}
                  onChange={e => setRatingMax(parseInt(e.target.value) || 5)}
                  className="w-14 border border-border rounded px-2 py-1 text-xs outline-none bg-transparent"
                />
              </label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-foreground">{t('dataTable.icon')}</span>
                {[
                  { key: 'star', icon: '\u2605' }, { key: 'heart', icon: '\u2764' }, { key: 'thumb', icon: '\ud83d\udc4d' },
                  { key: 'fire', icon: '\ud83d\udd25' }, { key: 'smile', icon: '\ud83d\ude0a' }, { key: 'flower', icon: '\ud83c\udf38' },
                  { key: 'bolt', icon: '\u26a1' }, { key: 'puzzle', icon: '\ud83e\udde9' }, { key: 'number', icon: '\ud83d\udd22' },
                ].map(({ key, icon: ico }) => (
                  <button key={key} onClick={() => setRatingIcon(key)}
                    className={cn('px-2 py-1 rounded text-sm', ratingIcon === key ? 'bg-sidebar-primary/10 ring-1 ring-sidebar-primary' : 'bg-muted')}
                  >
                    {ico}
                  </button>
                ))}
              </div>
            </div>
          )}
          {(newColType === 'Date' || newColType === 'DateTime' || newColType === 'CreatedTime' || newColType === 'LastModifiedTime') && (
            <div>
              <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.dateFormat')}</div>
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {(() => {
                  const isDateOnly = newColType === 'Date';
                  const baseFmts = [
                    { value: 'YYYY/MM/DD', example: '2026/01/30' },
                    { value: 'YYYY-MM-DD', example: '2026-01-30' },
                    { value: 'DD/MM/YYYY', example: '30/01/2026' },
                    { value: 'MM/DD/YYYY', example: '01/30/2026' },
                    { value: 'MM-DD', example: '01-30' },
                  ];
                  const allFmts: { value: string; example: string }[] = [];
                  if (isDateOnly) {
                    allFmts.push(...baseFmts);
                  } else {
                    for (const f of baseFmts) {
                      allFmts.push({ value: `${f.value} HH:mm`, example: `${f.example} 14:00` });
                    }
                  }
                  return allFmts.map(fmt => (
                    <button
                      key={fmt.value}
                      onClick={() => setDateFormat(fmt.value)}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-1.5 rounded text-xs transition-colors',
                        dateFormat === fmt.value ? 'bg-sidebar-primary/10 text-sidebar-primary' : 'hover:bg-accent text-foreground'
                      )}
                    >
                      <span>{fmt.value}</span>
                      <span className="text-muted-foreground">{fmt.example}</span>
                    </button>
                  ));
                })()}
              </div>
            </div>
          )}
          {isSelectType(newColType) && (
            <div>
              <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.options')}</div>
              <div className="space-y-1.5">
                {newColOptionsList.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: SELECT_COLORS[i % SELECT_COLORS.length] }} />
                    <input
                      value={opt}
                      onChange={e => {
                        const updated = [...newColOptionsList];
                        updated[i] = e.target.value;
                        setNewColOptionsList(updated);
                      }}
                      className="flex-1 border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground outline-none bg-muted/30 focus:ring-1 focus:ring-sidebar-primary/50"
                      placeholder={t('dataTable.optionN', { n: i + 1 })}
                    />
                    <button
                      onClick={() => setNewColOptionsList(newColOptionsList.filter((_, j) => j !== i))}
                      className="p-0.5 text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setNewColOptionsList([...newColOptionsList, ''])}
                  className="flex items-center gap-1.5 text-xs text-sidebar-primary hover:opacity-80 px-1 py-1"
                >
                  <Plus className="h-3.5 w-3.5" /> {t('dataTable.addOption')}
                </button>
              </div>
            </div>
          )}
          {newColType === 'Formula' && (
            <div>
              <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.formulaExpression')}</div>
              <input
                value={newColFormula}
                onChange={e => setNewColFormula(e.target.value)}
                placeholder={t('dataTable.formulaPlaceholder')}
                className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none font-mono bg-transparent"
              />
              <div className="text-[10px] text-muted-foreground/50 mt-1">
                {t('dataTable.formulaHint')}
              </div>
            </div>
          )}
          {newColType === 'Links' && (
            <div className="space-y-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.relatedTable')}</div>
                <select
                  value={newColRelTable}
                  onChange={e => setNewColRelTable(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none bg-transparent"
                >
                  <option value="">{t('dataTable.selectTable')}</option>
                  {allTables?.filter(tbl => tbl.id !== tableId).map(tbl => (
                    <option key={tbl.id} value={tbl.id}>{tbl.title}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={newColRelMulti}
                  onChange={e => setNewColRelMulti(e.target.checked)}
                  className="accent-sidebar-primary"
                />
                {t('dataTable.allowMultiple')}
              </label>
              <div className="text-[10px] text-muted-foreground/60">
                {newColRelMulti ? t('dataTable.relMultiHint') : t('dataTable.relSingleHint')}
              </div>
            </div>
          )}
          {newColType === 'Lookup' && (() => {
            const linkCols = displayCols.filter(c => c.type === 'Links' || c.type === 'LinkToAnotherRecord');
            return (
            <div className="space-y-3">
              {linkCols.length === 0 ? (
                <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2">
                  {t('dataTable.needLinkCol', { type: t('dataTable.colTypes.Lookup') })}
                </div>
              ) : (
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.linkCol')}</div>
                <select
                  value={newColRelCol}
                  onChange={e => setNewColRelCol(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none bg-transparent"
                >
                  <option value="">{t('dataTable.selectLinkCol')}</option>
                  {linkCols.map(c => (
                    <option key={c.column_id} value={c.column_id}>{c.title}</option>
                  ))}
                </select>
              </div>
              )}
              {relatedMeta && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.lookupField')}{'\uff08'}{relatedMeta.title}{'\uff09'}</div>
                  <select
                    value={newColLookupCol}
                    onChange={e => setNewColLookupCol(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none bg-transparent"
                  >
                    <option value="">{t('dataTable.selectField')}</option>
                    {(relatedMeta.columns || [])
                      .filter(c => c.title !== 'created_by' && !c.title.startsWith('nc_') && c.type !== 'ForeignKey')
                      .map(c => (
                      <option key={c.column_id} value={c.column_id}>{c.title} ({c.type})</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            );
          })()}
          {newColType === 'Rollup' && (() => {
            const linkCols = displayCols.filter(c => c.type === 'Links' || c.type === 'LinkToAnotherRecord');
            return (
            <div className="space-y-3">
              {linkCols.length === 0 ? (
                <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2">
                  {t('dataTable.needLinkCol', { type: t('dataTable.colTypes.Rollup') })}
                </div>
              ) : (
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.linkCol')}</div>
                <select
                  value={newColRelCol}
                  onChange={e => setNewColRelCol(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none bg-transparent"
                >
                  <option value="">{t('dataTable.selectLinkCol')}</option>
                  {linkCols.map(c => (
                    <option key={c.column_id} value={c.column_id}>{c.title}</option>
                  ))}
                </select>
              </div>
              )}
              {relatedMeta && (
                <>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.rollupField')}{'\uff08'}{relatedMeta.title}{'\uff09'}</div>
                    <select
                      value={newColRollupCol}
                      onChange={e => setNewColRollupCol(e.target.value)}
                      className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none bg-transparent"
                    >
                      <option value="">{t('dataTable.selectField')}</option>
                      {(relatedMeta.columns || []).filter(c => ['Number', 'Decimal', 'Currency', 'Percent', 'Rating'].includes(c.type)).map(c => (
                        <option key={c.column_id} value={c.column_id}>{c.title} ({c.type})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.aggregateFn')}</div>
                    <div className="flex flex-wrap gap-1">
                      {[
                        { value: 'sum', key: 'fnSum' },
                        { value: 'avg', key: 'fnAvg' },
                        { value: 'count', key: 'fnCount' },
                        { value: 'min', key: 'fnMin' },
                        { value: 'max', key: 'fnMax' },
                      ].map(fn => (
                        <button
                          key={fn.value}
                          onClick={() => setNewColRollupFn(fn.value)}
                          className={cn(
                            'px-2 py-1.5 rounded-lg text-xs transition-colors border',
                            newColRollupFn === fn.value
                              ? 'border-sidebar-primary bg-sidebar-primary/10 text-sidebar-primary'
                              : 'border-border text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {t(`dataTable.${fn.key}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
            );
          })()}
        </div>

        {/* Footer: Cancel + Confirm */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-foreground border border-border rounded-lg hover:bg-accent transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onSave}
            disabled={
              (newColType === 'Lookup' && (!newColRelCol || !newColLookupCol)) ||
              (newColType === 'Rollup' && (!newColRelCol || !newColRollupCol)) ||
              (newColType === 'Links' && !newColRelTable) ||
              (newColType === 'Formula' && !newColFormula.trim())
            }
            className="px-4 py-2 text-sm bg-sidebar-primary text-sidebar-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors"
          >
            {t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
