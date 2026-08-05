// Provides safe dummy values for the env modules' Zod validation so unit
// tests don't need a real Supabase project. Integration tests that need a
// real database set TEST_DATABASE_URL themselves (see
// tests/integration/README.md).
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.SUPABASE_SECRET_KEY ??= "test-secret-key";
