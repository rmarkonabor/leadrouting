import { ConfirmPasswordForm } from "./confirm-password-form";
import { Card } from "@/components/Card";

export default function ConfirmResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <h1 className="mb-4 text-xl font-semibold">Choose a new password</h1>
        <ConfirmPasswordForm />
      </Card>
    </main>
  );
}
