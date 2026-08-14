export function CodeBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-md bg-neutral-bg p-3 text-xs whitespace-pre-wrap text-neutral-text">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}
