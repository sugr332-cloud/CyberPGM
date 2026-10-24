/**
 * RFC 4180 compliant CSV serializer and parser
 */

export function serializeCsvValue(val: unknown): string {
  if (val === null || val === undefined) {
    return '';
  }
  let str: string;
  if (typeof val === 'object') {
    str = JSON.stringify(val);
  } else {
    str = String(val);
  }

  // If contains comma, double quote, newline, escape it
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportToCsv(
  rows: Record<string, unknown>[],
  columns?: string[],
): string {
  if (rows.length === 0 && (!columns || columns.length === 0)) {
    return '';
  }

  const cols =
    columns && columns.length > 0
      ? columns
      : Array.from(
          rows.reduce((acc, row) => {
            Object.keys(row).forEach((k) => acc.add(k));
            return acc;
          }, new Set<string>()),
        );

  const headerLine = cols.map(serializeCsvValue).join(',');
  const rowLines = rows.map((row) =>
    cols.map((col) => serializeCsvValue(row[col])).join(','),
  );

  return [headerLine, ...rowLines].join('\r\n');
}

export function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;
  let i = 0;
  const len = csvText.length;

  while (i < len) {
    const char = csvText[i];

    if (insideQuotes) {
      if (char === '"') {
        if (i + 1 < len && csvText[i + 1] === '"') {
          // Escaped quote
          currentField += '"';
          i += 2;
          continue;
        } else {
          // End of quoted field
          insideQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
        i++;
        continue;
      } else if (char === '\r') {
        if (i + 1 < len && csvText[i + 1] === '\n') {
          i++;
        }
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

export function parseCsv(csvText: string): Array<Record<string, string>> {
  const allRows = parseCsvRows(csvText);
  if (allRows.length === 0) return [];

  // Filter out any empty trailing row
  const nonEmptyRows = allRows.filter((r) => r.length > 0 && !(r.length === 1 && r[0].trim() === ''));
  if (nonEmptyRows.length === 0) return [];

  const headers = nonEmptyRows[0].map((h) => h.trim());
  const dataRows = nonEmptyRows.slice(1);

  return dataRows.map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, idx) => {
      record[header] = idx < row.length ? row[idx] : '';
    });
    return record;
  });
}
