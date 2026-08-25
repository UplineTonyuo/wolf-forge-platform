"use client";

import { useState } from "react";
import type { SignInIdentity } from "../../domain/profile/security";
import { SuccessToast } from "../ui/success-toast";
import { SecuritySection } from "./security-section";

export function SecuritySettingsPanel({ identities }: { identities: SignInIdentity[] }) {
  const [changedAt, setChangedAt] = useState<number | null>(null);
  return (
    <>
      {changedAt ? <SuccessToast key={changedAt} title="Password updated" /> : null}
      <SecuritySection
        identities={identities}
        onPasswordChanged={() => setChangedAt(Date.now())}
        showHeading={false}
      />
    </>
  );
}
