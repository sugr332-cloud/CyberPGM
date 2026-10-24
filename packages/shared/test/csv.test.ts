import { describe, it, expect } from 'vitest';
import { exportToCsv, parseCsv, serializeCsvValue } from '../src/csv.js';

describe('CSV Serializer & Parser', () => {
  it('correctly escapes values with commas, quotes, and newlines', () => {
    expect(serializeCsvValue('normal')).toBe('normal');
    expect(serializeCsvValue('with,comma')).toBe('"with,comma"');
    expect(serializeCsvValue('with"quote')).toBe('"with""quote"');
    expect(serializeCsvValue("with\nnewline")).toBe("\"with\nnewline\"");
    expect(serializeCsvValue(null)).toBe('');
    expect(serializeCsvValue(undefined)).toBe('');
    expect(serializeCsvValue({ a: 1 })).toBe('"{""a"":1}"');
  });

  it('exports array of records to CSV format', () => {
    const data = [
      { id: '1', name: 'Alpha', price: 100 },
      { id: '2', name: 'Beta, with comma', price: 200 },
      { id: '3', name: 'Gamma "quoted"', price: 300 },
    ];
    const csv = exportToCsv(data, ['id', 'name', 'price']);
    const expected =
      'id,name,price\r\n' +
      '1,Alpha,100\r\n' +
      '2,"Beta, with comma",200\r\n' +
      '3,"Gamma ""quoted""",300';
    expect(csv).toBe(expected);
  });

  it('parses CSV back to records correctly', () => {
    const csv =
      'id,name,price\r\n' +
      '1,Alpha,100\r\n' +
      '2,"Beta, with comma",200\r\n' +
      '3,"Gamma ""quoted""",300';
    const parsed = parseCsv(csv);
    expect(parsed).toEqual([
      { id: '1', name: 'Alpha', price: '100' },
      { id: '2', name: 'Beta, with comma', price: '200' },
      { id: '3', name: 'Gamma "quoted"', price: '300' },
    ]);
  });

  it('handles empty csv and edge cases', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('id,name\n')).toEqual([]);
    expect(parseCsv('id,name\n1,')).toEqual([{ id: '1', name: '' }]);
  });
});
