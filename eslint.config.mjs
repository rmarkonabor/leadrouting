import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// The service-role Supabase client bypasses Row Level Security entirely
// (docs/security-model.md §3) — it must only ever be imported from a
// narrow, explicitly allow-listed set of trusted server modules, never from
// a route/module reachable by an untrusted request path (in particular, the
// public lead-intake route, added in a later milestone, must never import
// it). See docs/decisions.md ADR-022.
const serviceRoleImportRestriction = {
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@/lib/supabase/service-role",
            message:
              "The service-role client bypasses RLS. Only org_admin-gated server modules on the allow-list in eslint.config.mjs may import it.",
          },
        ],
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  serviceRoleImportRestriction,
  {
    files: ["src/modules/users/**", "src/modules/imports/**"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
