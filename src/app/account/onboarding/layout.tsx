import type { ReactNode } from "react";
import { FormsVisibilityBoundary } from "../../../components/forms/forms-visibility-boundary";
import { loadFormsVisibility } from "../../actions/forms-visibility";

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const state = await loadFormsVisibility("client");
  if (!state.ok) return <p>Form information is unavailable under your current access.</p>;
  return <FormsVisibilityBoundary scope="client" signature={state.signature}>{children}</FormsVisibilityBoundary>;
}
