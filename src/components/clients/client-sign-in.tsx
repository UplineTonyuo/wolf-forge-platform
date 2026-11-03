"use client";

import { useActionState, useState } from "react";
import { LogIn } from "lucide-react";
import { beginClientSupportAction } from "../../app/actions/client-support";
import { SearchableSelect } from "../ui/searchable-select";
import styles from "./client-sign-in.module.css";

export function ClientSignIn({ accounts }: { accounts: Array<{ id: string; label: string }> }) {
  const [selected, setSelected] = useState(accounts.length === 1 ? accounts[0]!.id : "");
  const [state, action, pending] = useActionState(beginClientSupportAction, { error: null });
  if (!accounts.length) return null;
  return (
    <form action={action} className={styles.form} aria-label="Sign in as client">
      {accounts.length > 1 ? <SearchableSelect
        name="client_profile_id" label="Client portal account" options={accounts} value={selected}
        onChange={setSelected} placeholder="Choose client account" menuLabel="Client portal accounts" disabled={pending}
      /> : <input type="hidden" name="client_profile_id" value={selected} />}
      <button type="submit" className="button-secondary" disabled={pending || !selected} aria-busy={pending}>
        <LogIn size={16} aria-hidden="true" />{pending ? "Opening client…" : "Sign in as client"}
      </button>
      {state.error ? <p role="alert" className={styles.error}>{state.error}</p> : null}
    </form>
  );
}
