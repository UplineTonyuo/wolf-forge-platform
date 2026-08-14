import type { Metadata } from "next";
import { PlaceholderPage } from "../../../components/ui/placeholder-page";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return (
    <div className="settings-page-layout">
      <PlaceholderPage
        title="Settings"
        description="Configure the Wolf Forge workspace."
        message="Workspace settings will be added in a future delivery phase."
      />
    </div>
  );
}