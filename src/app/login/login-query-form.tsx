"use client";

import { useSearchParams } from "next/navigation";
import { LoginForm } from "../../components/forms/login-form";
import { IDENTITY_UNAVAILABLE_MESSAGE } from "../../lib/supabase/identity-lookup";

export function LoginQueryForm() {
  const params = useSearchParams();
  const reason = params.get("reason");
  const initialError =
    reason === "identity-unavailable"
      ? IDENTITY_UNAVAILABLE_MESSAGE
      : reason === "staff-only"
        ? "This area is for Wolf Forge team members."
        : reason === "client-only"
          ? "This area is for active Wolf Forge client accounts."
          : null;

  return <LoginForm next={params.get("next") ?? undefined} initialError={initialError} />;
}
