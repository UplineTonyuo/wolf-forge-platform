import Link from "next/link";
import { signOutAction } from "../../app/actions/auth";
import { WolfForgeMark } from "../shell/wolf-forge-mark";
import { ClientAccountNavigation } from "./client-account-navigation";

export function ClientAccountShell({
  companyName,
  children,
}: {
  companyName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="client-account-shell">
      <header className="client-account-header">
        <Link href="/account/subscriptions" className="client-account-brand" aria-label="Wolf Forge client account">
          <WolfForgeMark />
          <span>WOLF FORGE</span>
        </Link>
        <div className="client-account-identity">
          <span>{companyName}</span>
          <form action={signOutAction}>
            <button type="submit">Sign out</button>
          </form>
        </div>
      </header>
      <ClientAccountNavigation />
      <main className="client-account-main">{children}</main>
    </div>
  );
}
