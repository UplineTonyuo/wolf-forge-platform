import { notFound } from "next/navigation";
import { FormRenderer } from "../../../components/forms/form-renderer";
import { ApplicationError } from "../../../lib/errors/application-error";
import { getRequestPublicPublishedSchema } from "../public-schema";
import styles from "../../../components/forms/forms.module.css";

export default async function PublicFormPage({ params }: PageProps<"/f/[canonicalKey]">) {
  const { canonicalKey } = await params;
  try {
    const schema = await getRequestPublicPublishedSchema(canonicalKey);
    return <main className={styles.publicFormPage}><div className={styles.publicBrand}><strong>WOLF FORGE</strong><span>Secure client Form</span></div><FormRenderer schema={schema} mode="public" /></main>;
  } catch (error) {
    if (error instanceof ApplicationError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
