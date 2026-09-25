import type { Metadata } from "next";
import { ActivateAccountForm } from "../../components/forms/activate-account-form";

export const metadata: Metadata = {
  title: "Set your password",
};

export default function ActivatePage() {
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="activate-title">
        <h1 id="activate-title">Set your password</h1>
        <p>Choose the password you will use to sign in to your Wolf Forge client portal.</p>
        <ActivateAccountForm />
      </section>
    </main>
  );
}
