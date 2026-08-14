import { ResetPasswordForm } from "./reset-password-form";
import { Card } from "@/components/Card";

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <h1 className="mb-4 text-xl font-semibold">Reset your password</h1>
        <ResetPasswordForm />
      </Card>
    </main>
  );
}
