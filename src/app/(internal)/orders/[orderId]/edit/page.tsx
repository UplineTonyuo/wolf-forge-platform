import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectForm } from "../../../../../components/projects/project-form";
import { DataError } from "../../../../../components/ui/list-states";
import { PageFrame } from "../../../../../components/ui/page-frame";
import { orderReference } from "../../../../../domain/orders/references";
import { toClientSafeError } from "../../../../../lib/errors/application-error";
import { getInternalContext } from "../../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Edit Project" };

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const context = await getInternalContext();

  if (!context.user.projects.edit) {
    return (
      <PageFrame title="Edit Project">
        <section className="error-state">
          <strong>Project editing is not available for your account.</strong>
          <span>You need the projects.edit capability to change project details.</span>
          <div className="error-retry">
            <Link className="button-secondary" href={`/orders/${orderId}`}>
              Back to the project
            </Link>
          </div>
        </section>
      </PageFrame>
    );
  }

  try {
    const [project, clients, services, folders, assignees] = await Promise.all([
      context.services.orders.get(orderId),
      context.services.companies.listActive(),
      context.services.catalog.listActive(),
      context.services.catalog.listFolders(),
      context.services.catalog.listAssignees(),
    ]);

    return (
      <PageFrame title="Edit Project" description={`Project #${orderReference(project)}`} narrow>
        <ProjectForm
          mode="edit"
          project={project}
          clients={clients}
          services={services}
          folders={folders}
          assignees={assignees}
          canAssign={context.user.projects.assign}
        />
      </PageFrame>
    );
  } catch (error) {
    const safe = toClientSafeError(error);
    if (safe.code === "NOT_FOUND") notFound();

    return (
      <PageFrame title="Edit Project">
        <DataError message={safe.message} />
      </PageFrame>
    );
  }
}
