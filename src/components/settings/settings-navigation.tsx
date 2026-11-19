"use client";
import { ArrowLeft, Bell, Building2, CreditCard, Plug, ShieldCheck, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { sections, sectionTitle } from "../../domain/process/settings";

export const SETTINGS_NAV_ITEMS = [
  {route:"/settings/general",label:"General",icon:Building2},
  {route:"/settings/team",label:"Team & Access",icon:UsersRound},
  {route:"/settings/billing",label:"Billing & Payments",icon:CreditCard},
  {route:"/settings/integrations",label:"Integrations",icon:Plug},
  {route:"/settings/notifications",label:"Notifications",icon:Bell},
  {route:"/settings/security",label:"Security",icon:ShieldCheck},
] as const;
export function SettingsNavigation({ manage=false, back="/dashboard", pending, onNavigate }: {
  manage?: boolean; back?: string; pending?: string | null; onNavigate?: (route:string,event:React.MouseEvent<HTMLAnchorElement>)=>void;
}) {
  const pathname = usePathname();
  function item(route:string,label:string,icon?:React.ReactNode) {
    const current=(pending ?? pathname)===route || ((pending ?? pathname)==="/settings" && route==="/settings/general");
    return <Link key={route} className={"sidebar-link"+(current?" is-active":"")} href={route} aria-current={current?"page":undefined}
      onClick={event=>onNavigate?.(route,event)}>{icon}<span>{label}</span></Link>;
  }
  return <nav className="sidebar-navigation" aria-label="Settings sections">
    {item(back,"Back",<ArrowLeft aria-hidden />)}
    <section className="sidebar-section"><h2>Business</h2><div className="sidebar-links">
      {SETTINGS_NAV_ITEMS.map(({route,label,icon:Icon})=>item(route,label,<Icon aria-hidden />))}
    </div></section>
    {manage && <section className="sidebar-section"><h2>Process</h2><div className="sidebar-links">
      {sections.map(section=>item("/settings/process/"+section,sectionTitle[section]))}
    </div></section>}
  </nav>;
}
