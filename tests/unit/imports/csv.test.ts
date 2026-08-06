import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvToObjects } from "@/modules/imports/csv";

describe("parseCsv", () => {
  it("parses a simple comma-separated table", () => {
    const result = parseCsv("a,b,c\n1,2,3\n");
    expect(result).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields containing commas", () => {
    const result = parseCsv('name,note\n"Doe, Jane","hello world"\n');
    expect(result).toEqual([
      ["name", "note"],
      ["Doe, Jane", "hello world"],
    ]);
  });

  it("handles doubled-quote escaping inside a quoted field", () => {
    const result = parseCsv('field\n"she said ""hi"""\n');
    expect(result).toEqual([["field"], ['she said "hi"']]);
  });

  it("handles embedded newlines inside a quoted field", () => {
    const result = parseCsv('field\n"line one\nline two"\n');
    expect(result).toEqual([["field"], ["line one\nline two"]]);
  });

  it("handles a file with no trailing newline", () => {
    const result = parseCsv("a,b\n1,2");
    expect(result).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseCsvToObjects", () => {
  it("maps rows to lowercased, trimmed header keys", () => {
    const { headers, rows } = parseCsvToObjects(
      " Name , Email \nJane,jane@example.com\n",
    );
    expect(headers).toEqual(["name", "email"]);
    expect(rows).toEqual([{ name: "Jane", email: "jane@example.com" }]);
  });

  it("tolerates ragged rows by filling missing columns with empty strings", () => {
    const { rows } = parseCsvToObjects("a,b,c\n1,2\n");
    expect(rows).toEqual([{ a: "1", b: "2", c: "" }]);
  });
});
