// RFC 4180 CSV parser — handles quoted fields, double-quote escaping, newlines in quotes, BOM.

export interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
  rawRows: string[][];
}

export function parseCsv(text: string): CsvParseResult {
  const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;

  const records: string[][] = [];
  let current = '';
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"' && clean[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(current);
        current = '';
      } else if (ch === '\r' && clean[i + 1] === '\n') {
        row.push(current);
        current = '';
        records.push(row);
        row = [];
        i++;
      } else if (ch === '\n') {
        row.push(current);
        current = '';
        records.push(row);
        row = [];
      } else {
        current += ch;
      }
    }
  }
  row.push(current);
  if (row.length > 1 || row[0] !== '') {
    records.push(row);
  }

  if (records.length === 0) return { headers: [], rows: [], rawRows: [] };

  const rawHeaders = records[0];
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h, i) => {
    let name = h.trim() || `Column ${i + 1}`;
    const count = seen.get(name.toLowerCase()) || 0;
    if (count > 0) name = `${name}_${count + 1}`;
    seen.set(name.toLowerCase(), count + 1);
    return name;
  });

  const dataRows = records.slice(1);
  const rawRows = dataRows;
  const rows = dataRows.map(cols => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i] ?? '';
    });
    return obj;
  });

  return { headers, rows, rawRows };
}
