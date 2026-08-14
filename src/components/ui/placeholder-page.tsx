import { Construction } from "lucide-react";
import { PageFrame } from "./page-frame";

export function PlaceholderPage({ title, description, message }: { title: string; description: string; message: string }) {
  return (
    <PageFrame title={title} description={description}>
      <section className="placeholder-state" aria-labelledby="placeholder-heading">
        <Construction aria-hidden="true" />
        <div>
          <h2 id="placeholder-heading">Coming soon</h2>
          <p>{message}</p>
        </div>
      </section>
    </PageFrame>
  );
}
