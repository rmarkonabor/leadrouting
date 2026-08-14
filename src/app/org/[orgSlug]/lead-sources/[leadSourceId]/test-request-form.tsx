"use client";

import { useState } from "react";
import { publicEnv } from "@/lib/env/public";
import { Field } from "@/components/Field";
import { Input, Textarea } from "@/components/Input";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { CodeBlock } from "@/components/CodeBlock";

const SAMPLE_PAYLOAD = JSON.stringify(
  { name: "Jane Doe", email: "jane@example.com" },
  null,
  2,
);

type TestResult =
  { kind: "success"; status: number; body: unknown } | { kind: "error"; message: string };

export function TestRequestForm() {
  const [token, setToken] = useState("");
  const [payload, setPayload] = useState(SAMPLE_PAYLOAD);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token.trim()) {
      setResult({ kind: "error", message: "Paste the source URL's token first." });
      return;
    }

    setPending(true);
    setResult(null);
    try {
      const response = await fetch(
        `${publicEnv.NEXT_PUBLIC_APP_URL}/api/v1/intake/${token.trim()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Test-Mode": "true" },
          body: payload,
        },
      );
      const body: unknown = await response.json().catch(() => null);
      setResult({ kind: "success", status: response.status, body });
    } catch {
      setResult({ kind: "error", message: "The request failed to send." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-lg flex-col gap-3">
      <Field label="Source token" htmlFor="testToken">
        <Input
          id="testToken"
          type="text"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="lrt_..."
        />
      </Field>
      <Field label="JSON payload" htmlFor="testPayload">
        <Textarea
          id="testPayload"
          rows={6}
          value={payload}
          onChange={(event) => setPayload(event.target.value)}
        />
      </Field>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Waiting for response…" : "Send test request"}
      </Button>

      {result?.kind === "error" ? (
        <p className="text-sm text-danger-text">{result.message}</p>
      ) : null}
      {result?.kind === "success" ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Badge variant={result.status < 300 ? "success" : "danger"}>
              HTTP {result.status}
            </Badge>
            <span className="text-muted">Test mode — no lead was created.</span>
          </div>
          <CodeBlock value={result.body} />
        </div>
      ) : null}
    </form>
  );
}
