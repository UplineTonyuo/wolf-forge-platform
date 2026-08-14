import type { Metadata } from "next";
import { ProjectsWorkspace } from "../../../components/projects/projects-workspace";
import { DataError } from "../../../components/ui/list-states";
import { PageFrame } from "../../../components/ui/page-frame";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { getInternalContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = {
  title: "Projects",
};

export default async function ProjectsPage() {
  const context = await getInternalContext();

  try {
    /* One embedded query resolves every project with its client, service and
       assignee, plus one batched task query. Filter option lists come from the
       authoritative catalogs rather than from whatever the rows happen to
       contain. Everything stays inside the caller's RLS scope. */
    const [projects, people, services, clients] = await Promise.all([
      context.services.orders.listProjects(),
      context.services.catalog.listAssignees(),
      context.services.catalog.listActive(),
      context.services.companies.listActive(),
    ]);

    return (
      <PageFrame
        title="Projects"
        description="Manage client delivery work across Wolf Forge services."
      >
        <ProjectsWorkspace
          rows={projects.rows}
          complete={projects.complete}
          people={people.map((person) => ({ id: person.id, name: person.displayName }))}
          services={services.map((service) => ({ id: service.id, name: service.name }))}
          clients={clients.map((client) => ({ id: client.id, name: client.name }))}
          capabilities={context.user.projects}
        />
      </PageFrame>
    );
  } catch (error) {
    return (
      <PageFrame title="Projects">
        <DataError message={toClientSafeError(error).message} />
      </PageFrame>
    );
  }
}
