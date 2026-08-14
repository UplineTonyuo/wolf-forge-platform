import type { Metadata } from "next";
import { LoginForm } from "../../components/forms/login-form";

export const metadata: Metadata = {
  title: "Wolf Forge Access",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const params = await searchParams;

  const initialError =
    params.reason === "staff-only"
      ? "This area is for Wolf Forge team members."
      : params.reason === "client-only"
        ? "This area is for active Wolf Forge client accounts."
        : null;

  return (
    <main className="login-page wf-cinematic-login">
      <div className="wf-cinematic-grid" aria-hidden="true" />
      <div className="wf-cinematic-stars" aria-hidden="true" />
      {/* WF INDIVIDUAL PARTICLES START */}
      <div className="wf-particle-field" aria-hidden="true">
        <span className="wf-particle wf-particle-01" />
        <span className="wf-particle wf-particle-02" />
        <span className="wf-particle wf-particle-03" />
        <span className="wf-particle wf-particle-04" />
        <span className="wf-particle wf-particle-05" />
        <span className="wf-particle wf-particle-06" />
        <span className="wf-particle wf-particle-07" />
        <span className="wf-particle wf-particle-08" />
        <span className="wf-particle wf-particle-09" />
        <span className="wf-particle wf-particle-10" />
        <span className="wf-particle wf-particle-11" />
        <span className="wf-particle wf-particle-12" />
        <span className="wf-particle wf-particle-13" />
        <span className="wf-particle wf-particle-14" />
        <span className="wf-particle wf-particle-15" />
        <span className="wf-particle wf-particle-16" />
        <span className="wf-particle wf-particle-17" />
        <span className="wf-particle wf-particle-18" />
        <span className="wf-particle wf-particle-19" />
        <span className="wf-particle wf-particle-20" />
        <span className="wf-particle wf-particle-21" />
        <span className="wf-particle wf-particle-22" />
        <span className="wf-particle wf-particle-23" />
        <span className="wf-particle wf-particle-24" />
      </div>
      {/* WF INDIVIDUAL PARTICLES END */}
<div
        className="wf-cinematic-orbit wf-cinematic-orbit-one"
        aria-hidden="true"
      />

      <div
        className="wf-cinematic-orbit wf-cinematic-orbit-two"
        aria-hidden="true"
      />

      <section
        className="wf-cinematic-wolf-stage"
        aria-hidden="true"
      >
        <div className="wf-cinematic-wolf" />
      </section>

      <section className="wf-cinematic-access-stage">
        <section
          className="login-card wf-cinematic-panel"
          aria-labelledby="wf-login-title"
        >
          <div className="wf-cinematic-panel-light" aria-hidden="true" />

          <div className="wf-cinematic-heading">
            <h1 id="wf-login-title">
              Enter the forge<span>.</span>
            </h1>

            <p>
              Sign in with your Wolf Forge account to continue.
            </p>
          </div>

          <LoginForm
            next={params.next}
            initialError={initialError}
          />
        </section>
      </section>
    </main>
  );
}