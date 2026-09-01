export type CsvRow = string[];

/**
 * Parse CSV records while preserving field contents for the caller to normalize.
 * Supports RFC 4180 quoting, escaped double quotes, and CRLF/LF record endings.
 */
export function parseCsvRows(source: string): CsvRow[] {
  if (source.length === 0) return [];

  const input = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  if (input.length === 0) return [];

  const rows: CsvRow[] = [];
  let row: CsvRow = [];
  let field = "";
  let inQuotes = false;

  const finishRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\r" || character === "\n") {
      finishRow();
      if (character === "\r" && input[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    throw new Error("CSV contains an unterminated quoted field.");
  }

  const endedWithRecordSeparator = /(?:\r\n|\r|\n)$/.test(input);
  if (!endedWithRecordSeparator) finishRow();

  return rows;
}
