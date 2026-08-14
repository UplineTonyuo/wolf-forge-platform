import { notFound } from "next/navigation";
import { FormRenderer } from "../../../components/forms/form-renderer";
import { createNextServerSupabaseClient } from "../../../lib/supabase/next-server";
import { FormRepository } from "../../../repositories/form-repository";
import styles from "../../../components/forms/forms.module.css";

export default async function PublicFormPage({ params }: PageProps<"/f/[canonicalKey]">) {
  const { canonicalKey } = await params;
  try {
    const schema = await new FormRepository(await createNextServerSupabaseClient()).getPublishedSchema(canonicalKey);
    return <main className={styles.publicFormPage}><div className={styles.publicBrand}><strong>WOLF FORGE</strong><span>Secure client Form</span></div><FormRenderer schema={schema} mode="public" /></main>;
  } catch {
    notFound();
  }
}
