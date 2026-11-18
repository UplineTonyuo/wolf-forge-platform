"use server";

import type {
  TicketSummary,
} from "../../domain/tickets/schema";
import { orderReference, parseSppOrderReference } from "../../domain/orders/references";

import {
  getInternalContext,
} from "../../lib/supabase/next-server";
import { enforceServerCostLimit } from "../../lib/security/server-cost-limit";


export type GlobalSearchKind =
  | "client"
  | "project"
  | "service"
  | "ticket";


export type GlobalSearchItem = {
  kind: GlobalSearchKind;
  id: string;
  title: string;
  subtitle: string;
  href: string;
  /**
   * What this result would complete to, for the search input's ghost text.
   * Only ever a genuine prefix match of what was typed -- see
   * `prefixField` -- so the input never offers a completion the user did
   * not start typing. Absent when nothing in the result completes it.
   */
  predict?: string;
};


export type GlobalSearchResponse =
  | {
      ok: true;
      results: GlobalSearchItem[];
    }
  | {
      ok: false;
      error: string;
    };


type Candidate = GlobalSearchItem & {
  score: number;
};


type SearchProjectRow = {
  id: string;
  order_number: number;
  spp_order_reference: string | null;
  title: string;
  company_id: string;
  service_id: string;
  companies: unknown;
  services: unknown;
};


function normalize(
  value: string,
) {
  return value
    .toLocaleLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}


function textScore(
  value: string,
  query: string,
) {
  const target =
    normalize(value);

  const wanted =
    normalize(query);

  if (!wanted) {
    return 1000;
  }

  if (target === wanted) {
    return 0;
  }

  if (
    target.startsWith(wanted)
  ) {
    return 4;
  }

  const words =
    target.split(" ");

  if (
    words.some(
      (word) =>
        word.startsWith(
          wanted,
        ),
    )
  ) {
    return 8;
  }

  const index =
    target.indexOf(wanted);

  if (index >= 0) {
    return 20 + index;
  }

  return 1000;
}


/**
 * The value this result should complete to, or null when the result does not
 * start with what was typed. A result that merely contains the query scores
 * as a match but earns no prediction -- that is what keeps the ghost text
 * from proposing a completion the user is not on the way to writing.
 */
function prefixField(
  value: string | null | undefined,
  query: string,
): string | null {

  if (!value) {
    return null;
  }


  const target =
    normalize(value);

  const wanted =
    normalize(query);


  if (
    !wanted ||
    target.length <=
      wanted.length ||
    !target.startsWith(
      wanted,
    )
  ) {

    return null;
  }


  return value;
}


function relationName(
  value: unknown,
): string | null {

  if (
    Array.isArray(value)
  ) {

    const first =
      value[0];

    if (
      first &&
      typeof first === "object" &&
      "name" in first
    ) {

      const name =
        (first as {
          name?: unknown;
        }).name;

      return typeof name ===
        "string"
        ? name
        : null;
    }

    return null;
  }


  if (
    value &&
    typeof value === "object" &&
    "name" in value
  ) {

    const name =
      (value as {
        name?: unknown;
      }).name;

    return typeof name ===
      "string"
      ? name
      : null;
  }


  return null;
}


function ticketCandidate(
  ticket: TicketSummary,
  query: string,
): Candidate {

  const companyName =
    ticket.company_name;

  const clientName =
    ticket.client_name;

  const reference =
    ticket.public_ref;

  /*
   * The same fallback the Tickets list itself renders: company, then the
   * contact, then a guest. A Ticket with neither is a contact-form Ticket.
   */
  const contact =
    companyName ??
    clientName ??
    "Contact Form guest";


  const score =
    Math.min(
      textScore(
        reference,
        query,
      ),

      textScore(
        ticket.subject,
        query,
      ) + 2,

      textScore(
        companyName ?? "",
        query,
      ) + 4,

      textScore(
        clientName ?? "",
        query,
      ) + 5,
    );


  return {
    kind: "ticket",
    id: ticket.ticket_id,
    title: reference,
    subtitle:
      [ticket.subject, contact]
        .filter(Boolean)
        .join(" · "),
    href:
      `/tickets/${ticket.ticket_id}`,
    predict:
      prefixField(
        reference,
        query,
      ) ??
      prefixField(
        ticket.subject,
        query,
      ) ??
      prefixField(
        companyName,
        query,
      ) ??
      prefixField(
        clientName,
        query,
      ) ??
      undefined,
    score,
  };
}


function projectCandidate(
  project: SearchProjectRow,
  query: string,
  sppReference: string | null,
): Candidate {

  const companyName =
    relationName(
      project.companies,
    );

  const serviceName =
    relationName(
      project.services,
    );

  const number =
    String(
      project.order_number,
    );

  const queryNumber =
    query.replace(
      /^#\s*/,
      "",
    );

  let numberScore =
    1000;

  if (
    /^\d+$/.test(queryNumber)
  ) {

    if (
      number === queryNumber
    ) {
      numberScore = -30;
    } else if (
      number.startsWith(
        queryNumber,
      )
    ) {
      numberScore = -20;
    }
  }


  const score =
    Math.min(
      numberScore,
      sppReference !== null && project.spp_order_reference === sppReference ? 0 : 1000,

      textScore(
        project.title,
        query,
      ),

      textScore(
        companyName ?? "",
        query,
      ) + 4,

      textScore(
        serviceName ?? "",
        query,
      ) + 6,
    );


  const separator =
    "\u00B7";


  const relationship =
    [
      `Project #${orderReference(project)}`,
      companyName,
      serviceName,
    ]
      .filter(Boolean)
      .join(
        ` ${separator} `,
      );


  return {
    kind: "project",
    id: project.id,
    title: project.title,
    subtitle: relationship,
    href:
      `/orders/${project.id}`,
    score,
  };
}


function uniqueCandidates(
  candidates: Candidate[],
) {

  const unique =
    new Map<
      string,
      Candidate
    >();


  for (
    const candidate
    of candidates
  ) {

    const key =
      `${candidate.kind}:${candidate.id}`;

    const existing =
      unique.get(key);

    if (
      !existing ||
      candidate.score <
        existing.score
    ) {

      unique.set(
        key,
        candidate,
      );
    }
  }


  return Array.from(
    unique.values(),
  );
}


export async function globalSearchAction(
  rawQuery: string,
): Promise<GlobalSearchResponse> {

  const query =
    String(
      rawQuery ?? "",
    )
      .trim()
      .slice(0, 80);


  if (!query) {

    return {
      ok: true,
      results: [],
    };
  }

  const sppReference = parseSppOrderReference(query);


  /*
   * Prevent user-entered wildcard characters from
   * accidentally turning a normal search into a
   * broad wildcard query.
   */
  const searchable =
    query
      .replace(
        /[%_]/g,
        " ",
      )
      .replace(
        /\s+/g,
        " ",
      )
      .trim();


  if (!searchable) {

    return {
      ok: true,
      results: [],
    };
  }


  const textQuery =
    searchable.replace(
      /^#\s*/,
      "",
    );


  const pattern =
    `%${textQuery}%`;


  try {

    const context =
      await getInternalContext();

    await enforceServerCostLimit({
      actorId: context.actor.id,
      action: "search.global",
    });


    const projectSelect =
      "id, order_number, spp_order_reference, title, company_id, service_id, companies(id, name), services(id, name)";


    const [
      companiesResult,
      servicesResult,
      titleProjectsResult,
      ticketsResult,
      referenceProjectsResult,
    ] =
      await Promise.all([

        context.client
          .from("companies")
          .select(
            "id, name, status",
          )
          .is(
            "archived_at",
            null,
          )
          .ilike(
            "name",
            pattern,
          )
          .order(
            "name",
          )
          .limit(5),


        context.client
          .from("services")
          .select(
            "id, name, folder_id",
          )
          .eq(
            "is_active",
            true,
          )
          .is(
            "archived_at",
            null,
          )
          .ilike(
            "name",
            pattern,
          )
          .order(
            "name",
          )
          .limit(5),


        context.client
          .from("orders")
          .select(
            projectSelect,
          )
          .is(
            "archived_at",
            null,
          )
          .ilike(
            "title",
            pattern,
          )
          .order(
            "created_at",
            {
              ascending: false,
            },
          )
          .limit(6),


        /*
         * Tickets come from the canonical RPC-backed list, not the table:
         * `public.tickets` is deliberately revoked for `authenticated` and
         * every Ticket read goes through a security-definer RPC, so Global
         * search adds a result type without adding a way to reach Tickets.
         * A failed Ticket read degrades to "no Ticket results" rather than
         * taking the whole panel down with it.
         *
         * ponytail: that list is unbounded, so the ceiling here is Ticket
         * volume -- it is now the heaviest read in this panel. The
         * `search.global` cost limiter is the guard; if the Ticket table
         * grows, the upgrade is an `app_search_ticket_summaries(p_query,
         * p_limit)` RPC that filters in the database instead.
         */
        context.services.tickets
          .list()
          .catch(
            (): TicketSummary[] => [],
          ),

        sppReference === null
          ? Promise.resolve({ data: [], error: null })
          : context.client
            .from("orders")
            .select(projectSelect)
            .is("archived_at", null)
            .eq("spp_order_reference", sppReference)
            .limit(1),
      ]);


    if (
      companiesResult.error ||
      servicesResult.error ||
      titleProjectsResult.error ||
      referenceProjectsResult.error
    ) {

      return {
        ok: false,
        error:
          "Search is temporarily unavailable.",
      };
    }


    const companies =
      companiesResult.data ?? [];

    const services =
      servicesResult.data ?? [];

    const projects:
      SearchProjectRow[] =
      [
        ...(referenceProjectsResult.data ?? []),
        ...(titleProjectsResult.data ?? []),
      ] as unknown as SearchProjectRow[];

    const tickets:
      TicketSummary[] =
      ticketsResult;


    /*
     * Numeric prefix search:
     *
     * "227" -> #227
     * "22"  -> #220 through #229
     * "2"   -> #20 through #29, etc.
     *
     * We also check wider prefixes so the search
     * remains useful as order numbers grow.
     */
    if (
      /^\d{1,7}$/.test(
        textQuery,
      )
    ) {

      const prefix =
        Number(
          textQuery,
        );


      if (
        Number.isSafeInteger(
          prefix,
        )
      ) {

        const factors =
          [1, 10, 100, 1000];


        const numberQueries =
          factors.map(
            (factor) => {

              let request =
                context.client
                  .from(
                    "orders",
                  )
                  .select(
                    projectSelect,
                  )
                  .is(
                    "archived_at",
                    null,
                  );


              if (
                factor === 1
              ) {

                request =
                  request.eq(
                    "order_number",
                    prefix,
                  );

              } else {

                const low =
                  prefix *
                  factor;

                const high =
                  low +
                  factor -
                  1;


                request =
                  request
                    .gte(
                      "order_number",
                      low,
                    )
                    .lte(
                      "order_number",
                      high,
                    );
              }


              return request
                .order(
                  "order_number",
                  {
                    ascending:
                      true,
                  },
                )
                .limit(5);
            },
          );


        const numberResponses =
          await Promise.all(
            numberQueries,
          );


        for (
          const response
          of numberResponses
        ) {

          if (
            response.error
          ) {
            continue;
          }


          projects.push(
            ...(
              (
                response.data ??
                []
              ) as unknown as
                SearchProjectRow[]
            ),
          );
        }
      }
    }


    /*
     * If "Wolf Forge" or "Lead Gen Sprint" matches,
     * also surface projects related to that client
     * or service.
     */

    const relationQueries:
      PromiseLike<unknown>[] =
      [];


    if (
      companies.length > 0
    ) {

      relationQueries.push(
        context.client
          .from("orders")
          .select(
            projectSelect,
          )
          .is(
            "archived_at",
            null,
          )
          .in(
            "company_id",
            companies.map(
              (company) =>
                company.id,
            ),
          )
          .order(
            "created_at",
            {
              ascending: false,
            },
          )
          .limit(4),
      );
    }


    if (
      services.length > 0
    ) {

      relationQueries.push(
        context.client
          .from("orders")
          .select(
            projectSelect,
          )
          .is(
            "archived_at",
            null,
          )
          .in(
            "service_id",
            services.map(
              (service) =>
                service.id,
            ),
          )
          .order(
            "created_at",
            {
              ascending: false,
            },
          )
          .limit(4),
      );
    }


    if (
      relationQueries.length >
      0
    ) {

      const relationResponses =
        await Promise.all(
          relationQueries,
        );


      for (
        const rawResponse
        of relationResponses
      ) {

        const response =
          rawResponse as {
            data:
              | unknown[]
              | null;
            error:
              | unknown
              | null;
          };


        if (
          response.error ||
          !response.data
        ) {
          continue;
        }


        const relationRows =
          response.data as unknown as SearchProjectRow[];

        projects.push(
          ...relationRows,
        );
      }
    }


    const candidates:
      Candidate[] =
      [];


    for (
      const company
      of companies
    ) {

      candidates.push({
        kind: "client",
        id: company.id,
        title: company.name,
        subtitle:
          `Client \u00B7 ${company.status}`,
        href:
          `/clients/${company.id}`,
        score:
          textScore(
            company.name,
            textQuery,
          ),
      });
    }


    for (
      const service
      of services
    ) {

      candidates.push({
        kind: "service",
        id: service.id,
        title: service.name,
        subtitle:
          "Service catalog",
        href:
          `/services/${service.id}`,
        score:
          textScore(
            service.name,
            textQuery,
          ) + 2,
      });
    }


    for (
      const project
      of projects
    ) {

      candidates.push(
        projectCandidate(
          project,
          textQuery,
          sppReference,
        ),
      );
    }


    for (
      const ticket
      of tickets
    ) {

      candidates.push(
        ticketCandidate(
          ticket,
          textQuery,
        ),
      );
    }


    const results =
      uniqueCandidates(
        candidates,
      )
        .filter(
          (candidate) =>
            candidate.score <
            1000,
        )
        .sort(
          (a, b) => {

            if (
              a.score !==
              b.score
            ) {

              return (
                a.score -
                b.score
              );
            }


            return a.title.localeCompare(
              b.title,
            );
          },
        )
        .slice(0, 10)
        .map(
          (candidate): GlobalSearchItem => ({
            kind: candidate.kind,
            id: candidate.id,
            title: candidate.title,
            subtitle: candidate.subtitle,
            href: candidate.href,
            predict: candidate.predict,
          }),
        );


    return {
      ok: true,
      results,
    };

  } catch {

    return {
      ok: false,
      error:
        "Search is temporarily unavailable.",
    };
  }
}
