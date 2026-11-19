"use server";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readPublicEnvironment } from "../../lib/env/public-env";
import { readServerEnvironment } from "../../lib/env/server-env";
import { createTrustedServerSupabaseClient } from "../../lib/supabase/trusted-server-client";
import { beginProtectedLogin } from "../../lib/security/login-protection";

const emailSchema = z.email().max(320);
const genericReceipt = "If this email is registered, enter the most recent code from your inbox. If no code arrives, wait a few minutes before requesting another.";
const unavailable = "Recovery is temporarily unavailable. Please try again later.";
const throttled = "Too many requests. Wait a few minutes before trying again.";
const unconfirmed = "Try signing in with your new password. If that fails, request another code.";

async function recoveryAuth(email: string) {
  if (!(await beginProtectedLogin(email)).ok) throw new Error("Recovery unavailable");
  const trusted = createTrustedServerSupabaseClient(readServerEnvironment());
  const eligibility = await trusted.rpc("app_server_can_request_recovery", { p_email: email });
  if (eligibility.error) throw new Error("Recovery unavailable");
  if (eligibility.data !== true) return null;
  const env = readPublicEnvironment();
  // Isolate the OTP session from existing sign-in cookies and other requests.
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).auth;
}

export async function requestRecoveryCode(form: FormData) {
  const parsed = emailSchema.safeParse(String(form.get("email") ?? "").trim());
  if (!parsed.success) return { ok: false, message: "Enter a valid email address." };
  try {
    const auth = await recoveryAuth(parsed.data);
    if (!auth) return { ok: true, message: genericReceipt };
    const { error } = await auth.resetPasswordForEmail(parsed.data);
    // A per-recipient cooldown can reveal account existence. Give everyone
    // the same guidance about using an earlier code or waiting to resend.
    if (error?.status === 429 && error.code !== "over_email_send_rate_limit")
      return { ok: false, message: throttled };
    if (error && (!error.status || error.status >= 500)) return { ok: false, message: unavailable };
    return { ok: true, message: genericReceipt };
  } catch {
    return { ok: false, message: unavailable };
  }
}

export async function finishPasswordRecovery(form: FormData) {
  const email = emailSchema.safeParse(String(form.get("email") ?? "").trim());
  const token = String(form.get("code") ?? "").trim();
  const password = form.get("password");
  if (!email.success || !/^\d{6}$/.test(token)) return { ok: false, message: "Enter the six-digit code from your email." };
  if (typeof password !== "string" || password.length < 8 || Buffer.byteLength(password, "utf8") > 72)
    return { ok: false, message: "Use at least 8 characters and at most 72 UTF-8 bytes." };
  if (password !== form.get("confirm")) return { ok: false, message: "The passwords do not match." };

  try {
    const auth = await recoveryAuth(email.data);
    if (!auth) return { ok: false, message: "The code is invalid or expired. Check it or request another code." };
    const proof = await auth.verifyOtp({ type: "recovery", email: email.data, token });
    if (proof.error?.status === 429) return { ok: false, message: throttled };
    if (proof.error && (!proof.error.status || proof.error.status >= 500))
      return { ok: false, message: unavailable };
    if (proof.error || !proof.data.session)
      return { ok: false, message: "The code is invalid or expired. Check it or request another code." };
    let passwordChanged = false;
    let sessionsRevoked = false;
    try {
      const { error } = await auth.updateUser({ password });
      if (error && (!error.status || error.status >= 500)) return { ok: false, message: unconfirmed };
      if (error) return { ok: false, message: "Request a new code and try a different password." };
      passwordChanged = true;
    } catch {
      return { ok: false, message: unconfirmed };
    } finally {
      const signOut = await auth.signOut({ scope: passwordChanged ? "global" : "local" }).catch(() => null);
      sessionsRevoked = !!signOut && !signOut.error;
    }
    if (!sessionsRevoked) return { ok: true, message: "Password reset. Sign in with your new password. We could not confirm that all other sessions were signed out." };
    return { ok: true, message: "Your password has been reset. Sign in with your new password." };
  } catch {
    return { ok: false, message: unavailable };
  }
}
