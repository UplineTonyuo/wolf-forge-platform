import type { Metadata } from "next";
import { CreateClientForm } from "../../../../components/forms/create-client-form";
import { PageFrame } from "../../../../components/ui/page-frame";

export const metadata: Metadata = {
  title: "Add account",
};

export default function NewClientPage() {
  return (
    <PageFrame
      title="Add account"
      description="Create a client account and primary contact."
      narrow
    >
      <CreateClientForm />
    </PageFrame>
  );
}
