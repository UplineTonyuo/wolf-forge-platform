import "server-only";

import { cookies } from "next/headers";
import { CLIENT_SUPPORT_COOKIE, CLIENT_SUPPORT_EXIT_COOKIE, clientSupportTokenSchema } from "../../domain/auth/client-support";
import { IdentityLookupError } from "./identity-lookup";

export async function clientSupportCookie(): Promise<string | undefined> {
  const value = (await cookies()).getAll().find((cookie) => cookie.name === CLIENT_SUPPORT_COOKIE)?.value;
  if (!value) return undefined;
  if (!clientSupportTokenSchema.safeParse(value).success) throw new IdentityLookupError("unauthorized", "membership");
  return value;
}

export async function refuseClientSupportAccountChange(): Promise<void> {
  if (await clientSupportRequested()) throw new Error("Exit client support before changing account settings.");
}

export async function clientSupportRequested(): Promise<boolean> {
  return (await cookies()).getAll().some((cookie) => cookie.name === CLIENT_SUPPORT_COOKIE);
}

export async function clientSupportExitPending(): Promise<boolean> {
  return (await cookies()).getAll().some((cookie) => cookie.name === CLIENT_SUPPORT_EXIT_COOKIE);
}
