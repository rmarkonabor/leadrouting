import { publicEnv } from "@/lib/env/public";
import { Card } from "@/components/Card";

export function buildIntakeUrl(plaintextToken: string): string {
  return `${publicEnv.NEXT_PUBLIC_APP_URL}/api/v1/intake/${plaintextToken}`;
}

export function IntakeUrlReveal({ plaintextToken }: { plaintextToken: string }) {
  return (
    <Card className="flex flex-col gap-1 text-sm">
      <p className="font-medium">Your webhook URL (shown once — copy it now)</p>
      <code className="break-all">{buildIntakeUrl(plaintextToken)}</code>
      <p className="text-xs text-muted">
        POST JSON or form-encoded data here. Rotate the token below to generate a new URL
        — the old one stops working immediately.
      </p>
    </Card>
  );
}
