import type { Metadata } from "next";
import { TeamRolesPanel } from "../../../components/settings/team-roles-panel";

export const metadata: Metadata = {
  title: "Team & Roles",
};

export default function TeamPage() {
  return <TeamRolesPanel />;
}