import { cookies } from "next/headers";
import Link from "next/link";
import { endClientSupportAction } from "../../actions/client-support";
import { CLIENT_SUPPORT_EXIT_COOKIE } from "../../../domain/auth/client-support";

export const dynamic = "force-dynamic";

export default async function ClientSupportExitPage() {
  const pending = (await cookies()).getAll().some((cookie) => cookie.name === CLIENT_SUPPORT_EXIT_COOKIE);
  return <main className="page-frame">
    <h1>Return to your workspace</h1>
    <p>{pending
      ? "Client view is closed in this browser. Server revocation is not yet confirmed. Retry exit before starting another client session."
      : "Exit client view to continue with your own account. Your administrator sign-in is retained."}</p>
    <form action={endClientSupportAction}><button type="submit" className="button-primary">{pending ? "Retry exit" : "Exit client view"}</button></form>
    {pending ? <p><Link href="/clients">Return to your own workspace</Link></p> : null}
  </main>;
}
