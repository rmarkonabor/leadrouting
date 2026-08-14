import { LoginForm } from "./login-form";
import { Card } from "@/components/Card";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <h1 className="mb-4 text-xl font-semibold">Sign in</h1>
        <LoginForm />
      </Card>
    </main>
  );
}
