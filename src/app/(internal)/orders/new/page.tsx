import type { Metadata } from "next";
import Link from "next/link";
import { ProjectForm } from "../../../../components/projects/project-form";
import { DataError, EmptyState } from "../../../../components/ui/list-states";
import { PageFrame } from "../../../../components/ui/page-frame";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "New Project" };

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams?: Promise<{
    serviceId?: string | string[];
  }>;
}) {
  const context = await getInternalContext();

  const params = searchParams
    ? await searchParams
    : {};

  const requestedServiceId =
    typeof params.serviceId === "string"
      ? params.serviceId
      : null;

  if (!context.user.projects.create) {
    return (
      <PageFrame title="New Project">
        <section className="error-state">
          <strong>Project creation is not available for your account.</strong>
          <span>You need the projects.create capability to create projects.</span>
          <div className="error-retry">
            <Link className="button-secondary" href="/orders">
              Back to projects
            </Link>
          </div>
        </section>
      </PageFrame>
    );
  }

  try {
    const [clients, services, folders, assignees] = await Promise.all([
      context.services.companies.listActive(),
      context.services.catalog.listActive(),
      context.services.catalog.listFolders(),
      context.services.catalog.listAssignees(),
    ]);

    const initialServiceId =
      requestedServiceId &&
      services.some(
        (service) =>
          service.id === requestedServiceId,
      )
        ? requestedServiceId
        : null;

    if (clients.length === 0) {
      return (
        <PageFrame title="New Project">
          <EmptyState
            title="No clients yet"
            body="A project always belongs to a client. Create the client first, then start the project."
            action={
              <Link className="button-primary" href="/clients/new">
                Create a client
              </Link>
            }
          />
        </PageFrame>
      );
    }

    if (services.length === 0) {
      return (
        <PageFrame title="New Project">
          <EmptyState
            title="No active services"
            body="A project delivers a service from the catalog. Activate or create a service first."
            action={
              <Link className="button-primary" href="/services/new">
                Create a service
              </Link>
            }
          />
        </PageFrame>
      );
    }

    return (
      <PageFrame
        title="New Project"
        description="Start delivery work for a client against a catalog service."
        narrow
      >
        <ProjectForm
          mode="create"
          initialServiceId={initialServiceId}
          clients={clients}
          services={services}
          folders={folders}
          assignees={assignees}
          canAssign={context.user.projects.assign}
        />
      </PageFrame>
    );
  } catch (error) {
    return (
      <PageFrame title="New Project">
        <DataError message={toClientSafeError(error).message} />
      </PageFrame>
    );
  }
}
