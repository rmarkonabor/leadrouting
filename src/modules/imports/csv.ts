/**
 * Minimal, dependency-free CSV parser (RFC 4180-ish): handles quoted
 * fields, embedded commas/newlines inside quotes, and doubled-quote
 * escaping (`""` -> `"`). No "server-only" import — this is pure, testable
 * logic with no I/O, reused by both the preview and confirm steps.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (char === ",") {
      pushField();
      i += 1;
      continue;
    }

    if (char === "\r") {
      i += 1;
      continue;
    }

    if (char === "\n") {
      pushRow();
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  // Final field/row, unless the file ended cleanly on a newline.
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export interface ParsedCsvTable {
  headers: string[];
  rows: Record<string, string>[];
}

/**
 * Parses CSV text and maps each subsequent row to an object keyed by the
 * (lowercased, trimmed) header row. Extra/missing columns per row are
 * tolerated (missing -> empty string) since real-world CSVs are frequently
 * ragged.
 */
export function parseCsvToObjects(text: string): ParsedCsvTable {
  const table = parseCsv(text);
  const [headerRow, ...dataRows] = table;
  const headers = (headerRow ?? []).map((h) => h.trim().toLowerCase());

  const rows = dataRows.map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? "").trim();
    });
    return record;
  });

  return { headers, rows };
}
