"use client";

import { Archive, LoaderCircle } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { archiveCouponAction, type CouponActionState } from "../../app/actions/coupons";
import styles from "./coupon-admin.module.css";

function ConfirmButton() {
  const { pending } = useFormStatus();
  return <button className="button-danger" disabled={pending} type="submit">{pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Archive aria-hidden="true" />}Archive Coupon</button>;
}

export function ArchiveCouponButton({ couponId, code, compact = false }: { couponId: string; code: string; compact?: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initialState: CouponActionState = { error: null, fieldErrors: {} };
  const [state, action] = useActionState(archiveCouponAction.bind(null, couponId), initialState);

  useEffect(() => {
    if (state.error && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [state.error]);

  return (
    <>
      <button className={compact ? styles.archiveLink : "button-danger"} type="button" onClick={() => dialogRef.current?.showModal()}>
        <Archive aria-hidden="true" />Archive
      </button>
      <dialog className={styles.archiveDialog} ref={dialogRef} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
        <form action={action} className={styles.archiveDialogBody}>
          <div className={styles.dialogIcon}><Archive aria-hidden="true" /></div>
          <h2>Archive coupon?</h2>
          <p><strong>{code}</strong> will no longer be accepted for future purchases. Existing redemption history will be preserved.</p>
          {state.error ? <div className="form-banner" role="alert">{state.error}</div> : null}
          <div className={styles.dialogActions}>
            <button className="button-secondary" type="button" onClick={() => dialogRef.current?.close()}>Cancel</button>
            <ConfirmButton />
          </div>
        </form>
      </dialog>
    </>
  );
}
