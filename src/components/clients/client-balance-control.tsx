"use client";

import {
  Minus,
  Plus,
  WalletCards,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  useEffect,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import {
  adjustClientBalanceAction,
} from "../../app/actions/clients";
import {
  WolfForgeWalletCard,
} from "./wolf-forge-wallet-card";

type WalletDirection =
  | "credit"
  | "debit";

type WalletSuccess = {
  direction: WalletDirection;
  amountCents: number;
  balanceCents: number;
};

function formatMoney(
  cents: number,
  currency: string,
) {
  return new Intl.NumberFormat(
    "en-US",
    {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    },
  ).format(cents / 100);
}

function firstName(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    return "This client";
  }

  return (
    normalized.split(/\s+/)[0] ??
    "This client"
  );
}

function parseAmountToCents(
  value: string,
) {
  const normalized =
    value.trim();

  if (
    !/^\d{1,10}(\.\d{1,2})?$/.test(
      normalized,
    )
  ) {
    return null;
  }

  const [
    whole,
    fraction = "",
  ] = normalized.split(".");

  const total =
    Number(whole) * 100 +
    Number(
      fraction.padEnd(2, "0"),
    );

  return (
    Number.isSafeInteger(total) &&
    total > 0
  )
    ? total
    : null;
}

export function ClientBalanceControl({
  companyId,
  clientName,
  balanceCents,
  currency,
}: {
  companyId: string;
  clientName: string;
  balanceCents: number;
  currency: string;
}) {
  const router =
    useRouter();

  const displayName =
    firstName(clientName);

  const [
    currentBalance,
    setCurrentBalance,
  ] =
    useState(balanceCents);

  const [
    lastBalanceCents,
    setLastBalanceCents,
  ] = useState(balanceCents);

  if (
    lastBalanceCents !==
    balanceCents
  ) {
    setLastBalanceCents(
      balanceCents,
    );
    setCurrentBalance(
      balanceCents,
    );
  }

  const [open, setOpen] =
    useState(false);

  const [
    direction,
    setDirection,
  ] =
    useState<WalletDirection>(
      "credit",
    );

  const [amount, setAmount] =
    useState("");

  const [reason, setReason] =
    useState("");

  const [error, setError] =
    useState<string | null>(
      null,
    );

  const [
    success,
    setSuccess,
  ] =
    useState<WalletSuccess | null>(
      null,
    );

  const [
    pending,
    startTransition,
  ] =
    useTransition();

  useEffect(() => {
    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (
        event.key === "Escape" &&
        !pending
      ) {
        setOpen(false);
        setSuccess(null);
      }
    };

    document.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      document.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [pending]);

  const close = () => {
    if (pending) return;

    setOpen(false);
    setSuccess(null);
    setError(null);
  };

  const submit = (
    event:
      FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    if (pending) return;

    const submittedAmount =
      parseAmountToCents(
        amount,
      );

    if (!submittedAmount) {
      setError(
        "Enter a valid amount.",
      );

      return;
    }

    setError(null);

    const requestId =
      crypto.randomUUID();

    startTransition(
      async () => {
        const result =
          await adjustClientBalanceAction(
            companyId,
            direction,
            amount,
            reason,
            requestId,
          );

        if (!result.ok) {
          setError(
            result.error,
          );

          return;
        }

        setCurrentBalance(
          result.balanceCents,
        );

        setSuccess({
          direction,
          amountCents:
            submittedAmount,
          balanceCents:
            result.balanceCents,
        });

        setAmount("");
        setReason("");

        window.setTimeout(
          () => {
            setOpen(false);

            window.setTimeout(
              () => {
                setSuccess(null);
                router.refresh();
              },
              220,
            );
          },
          3000,
        );
      },
    );
  };

  const previousBalance =
    success
      ? success.direction ===
        "credit"
        ? success.balanceCents -
          success.amountCents
        : success.balanceCents +
          success.amountCents
      : currentBalance;

  return (
    <>
      <div className="client-balance-inline">
        <strong>
          {formatMoney(
            currentBalance,
            currency,
          )}
        </strong>

        <button
          type="button"
          className="client-balance-manage"
          onClick={() => {
            setSuccess(null);
            setError(null);
            setOpen(true);
          }}
        >
          Manage
        </button>
      </div>


      {typeof document !== "undefined"
        ? createPortal(
            <div
              className={
                open
                  ? "client-balance-modal is-open"
                  : "client-balance-modal"
              }
              aria-hidden={!open}
            >
        <button
          type="button"
          className="client-balance-backdrop"
          aria-label="Close balance manager"
          tabIndex={
            open ? 0 : -1
          }
          onClick={close}
        />

        <section
          className="client-balance-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Manage client balance"
        >
          <header className="client-balance-panel-header">
            <div>
              <span>
                CLIENT WALLET
              </span>

              <h2>
                {success
                  ? "Balance updated"
                  : "Manage balance"}
              </h2>
            </div>

            <button
              type="button"
              onClick={close}
              disabled={pending}
              aria-label="Close"
            >
              <X aria-hidden="true" />
            </button>
          </header>

          {success ? (
            <div className="client-wallet-success">
              <div
                className="client-wallet-success-icon"
                aria-hidden="true"
              >
                <span
                  className="client-wallet-success-check"
                />
              </div>

              <div className="client-wallet-success-copy">
                <h3 className="client-wallet-success-title">
                  <span>
                    You{" "}
                    {success.direction === "credit"
                      ? "added"
                      : "deducted"}{" "}
                  </span>

                  <strong>
                    {formatMoney(
                      success.amountCents,
                      currency,
                    )}
                  </strong>

                  <span>
                    {success.direction === "credit"
                      ? " to "
                      : " from "}
                  </span>

                  <strong>
                    {displayName}
                  </strong>

                  <span>
                    {"\u2019s balance."}
                  </span>
                </h3>

                <p className="client-wallet-success-after">
                  <span>
                    {displayName} now has{" "}
                    <strong>
                      {formatMoney(
                        success.balanceCents,
                        currency,
                      )}
                    </strong>{" "}
                    available.
                  </span>

                  <span>
                    That balance is ready to use for Wolf Forge services.
                  </span>
                </p>
              </div>

              <div className="client-wallet-success-card">
                <WolfForgeWalletCard
                  clientName={
                    clientName
                  }
                  fromBalanceCents={
                    previousBalance
                  }
                  balanceCents={
                    success.balanceCents
                  }
                  currency={
                    currency
                  }
                  compact
                />
              </div>
            </div>
          ) : (
            <>
              <div className="client-balance-current">
                <WalletCards
                  aria-hidden="true"
                />

                <div>
                  <span>
                    Current balance
                  </span>

                  <strong>
                    {formatMoney(
                      currentBalance,
                      currency,
                    )}
                  </strong>
                </div>
              </div>

              <form
                className="client-balance-form"
                onSubmit={submit}
              >
                <div className="client-balance-direction">
                  <button
                    type="button"
                    className={
                      direction ===
                      "credit"
                        ? "is-active"
                        : ""
                    }
                    onClick={() =>
                      setDirection(
                        "credit",
                      )
                    }
                  >
                    <Plus
                      aria-hidden="true"
                    />
                    Add credit
                  </button>

                  <button
                    type="button"
                    className={
                      direction ===
                      "debit"
                        ? "is-active"
                        : ""
                    }
                    onClick={() =>
                      setDirection(
                        "debit",
                      )
                    }
                  >
                    <Minus
                      aria-hidden="true"
                    />
                    Deduct
                  </button>
                </div>

                <label className="client-balance-field">
                  <span>
                    Amount
                  </span>

                  <div className="client-balance-money-input">
                    <span>$</span>

                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amount}
                      onChange={(
                        event,
                      ) =>
                        setAmount(
                          event
                            .target
                            .value,
                        )
                      }
                      disabled={
                        pending
                      }
                    />
                  </div>
                </label>

                <label className="client-balance-field">
                  <span>
                    Reason

                    <small>
                      Optional
                    </small>
                  </span>

                  <input
                    type="text"
                    maxLength={240}
                    placeholder={
                      direction ===
                      "credit"
                        ? "Manual credit"
                        : "Manual deduction"
                    }
                    value={reason}
                    onChange={(
                      event,
                    ) =>
                      setReason(
                        event
                          .target
                          .value,
                      )
                    }
                    disabled={
                      pending
                    }
                  />
                </label>

                {error ? (
                  <p
                    className="client-balance-error"
                    role="alert"
                  >
                    {error}
                  </p>
                ) : null}

                <footer className="client-balance-actions">
                  <button
                    type="button"
                    onClick={close}
                    disabled={
                      pending
                    }
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={
                      pending ||
                      !amount.trim()
                    }
                  >
                    {pending
                      ? "Saving..."
                      : direction ===
                          "credit"
                        ? "Add credit"
                        : "Deduct balance"}
                  </button>
                </footer>
              </form>
            </>
          )}
        </section>

            </div>,
            document.body,
          )
        : null}
    </>
  );
}
