import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FormRenderer } from "../../../../../../components/forms/form-renderer";
import { getInternalContext } from "../../../../../../lib/supabase/next-server";
import styles from "../../../../../../components/forms/forms.module.css";

export default async function FormVersionPage({ params }: PageProps<"/forms/[formId]/versions/[versionId]">) {
  const [{ formId, versionId }, context] = await Promise.all([params, getInternalContext()]);
  try {
    const schema = await context.services.forms.getVersionSchema(formId, versionId);
    return <div className={styles.versionPage}><header><Link href={`/forms/${formId}#versions`}><ArrowLeft aria-hidden="true" />Back to builder</Link><div><span>Published version · Read only</span><h1>{schema.title}</h1><p>Version {schema.version_number} is immutable. Submissions remain linked to this exact schema.</p></div></header><FormRenderer schema={schema} mode="readonly" /></div>;
  } catch {
    notFound();
  }
}
