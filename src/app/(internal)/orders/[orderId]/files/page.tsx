import { FileText } from "lucide-react";
import Link from "next/link";
import styles from "../../../../../components/projects/project-detail.module.css";
import { DataError } from "../../../../../components/ui/list-states";
import { toClientSafeError } from "../../../../../lib/errors/application-error";
import { formatDate } from "../../../../../lib/format";
import { getInternalContext } from "../../../../../lib/supabase/next-server";

export default async function OrderFilesPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const context = await getInternalContext();

  try {
    const [conversation, agreements] = await Promise.all([
      context.services.tickets.getForOrder(orderId),
      context.services.forms.listSignedAgreements(orderId),
    ]);
    const files = [
      ...agreements.map((agreement) => ({
        id: agreement.submission_id, original_name: agreement.original_name, created_at: agreement.source_signed_at,
        size_bytes: agreement.size_bytes, mime_type: "application/pdf", href: `/api/form-submissions/${agreement.submission_id}/pdf?original=signed`,
      })),
      ...(conversation?.messages ?? []).flatMap((message) => message.attachments.map((file) => ({
        ...file, href: `/api/ticket-attachments/${file.id}`,
      }))),
    ];

    return (
      <section aria-labelledby="order-files-heading">
        <h2 id="order-files-heading" className={styles.sectionHeading}>
          Files
        </h2>

        {files.length === 0 ? (
          <p className={styles.panelEmpty}>No files have been shared in this conversation yet.</p>
        ) : (
          <div className={styles.filesTable}>
            <div className={styles.filesHeaderRow}>
              <span>Name</span>
              <span>Date</span>
            </div>

            <ul className={styles.filesList}>
              {files.map((file) => (
                <li key={file.id}>
                  <FileText aria-hidden="true" />
                  <span className={styles.filesNameGroup}>
                    <Link
                      className={styles.filesName}
                      href={file.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {file.original_name}
                    </Link>
                    <span className={styles.filesMeta}>
                      {file.mime_type} {String.fromCharCode(183)} {file.size_bytes.toLocaleString()} bytes
                    </span>
                  </span>
                  <span className={styles.filesDate}>{formatDate(file.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    );
  } catch (error) {
    const safe = toClientSafeError(error);
    return <DataError message={safe.message} />;
  }
}
