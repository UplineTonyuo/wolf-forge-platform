"use client";

import Image from "next/image";
import {
  useEffect,
  useState,
} from "react";

type WolfForgeWalletCardProps = {
  clientName: string;
  balanceCents: number;
  currency: string;
  compact?: boolean;
  fromBalanceCents?: number;
  /**
   * The micro-label above the holder name.
   *
   * Defaults to the admin wording, because that is where the card was born and
   * where "Client Wallet" is the correct description of what a staff member is
   * looking at. The client portal passes "Your Wallet" instead: a client should
   * never be addressed as "Client" in their own workspace. Deliberately a prop
   * rather than a global rename, so the two perspectives stay independent.
   */
  eyebrow?: string;
};

function getFirstName(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    return "Client";
  }

  return normalized.split(/\s+/)[0] ?? "Client";
}

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
      maximumFractionDigits: 2,
    },
  ).format(cents / 100);
}

function easeInOutCubic(value: number) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

export function WolfForgeWalletCard({
  clientName,
  balanceCents,
  currency,
  compact = false,
  fromBalanceCents,
  eyebrow = "Client Wallet",
}: WolfForgeWalletCardProps) {
  const displayName =
    getFirstName(clientName);

  const startingBalance =
    fromBalanceCents ??
    balanceCents;

  const [
    displayedBalance,
    setDisplayedBalance,
  ] = useState(startingBalance);

  const [rolling, setRolling] =
    useState(false);

  useEffect(() => {
    const from =
      fromBalanceCents ??
      balanceCents;

    const to = balanceCents;

    const reducedMotion =
      window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

    let active = true;
    let animationFrame = 0;

    const duration = 1650;

    const animate = (
      now: number,
      startedAt: number,
    ) => {
      if (!active) {
        return;
      }

      const progress = Math.min(
        (now - startedAt) /
          duration,
        1,
      );

      const eased =
        easeInOutCubic(progress);

      const nextValue =
        Math.round(
          from +
            (to - from) *
              eased,
        );

      setDisplayedBalance(
        nextValue,
      );

      if (progress < 1) {
        animationFrame =
          requestAnimationFrame(
            (nextNow) =>
              animate(
                nextNow,
                startedAt,
              ),
          );

        return;
      }

      setDisplayedBalance(to);
      setRolling(false);
    };

    void Promise.resolve().then(
      () => {
        if (!active) {
          return;
        }

        if (
          reducedMotion ||
          from === to
        ) {
          setDisplayedBalance(
            to,
          );
          setRolling(false);
          return;
        }

        const startedAt =
          performance.now();

        setDisplayedBalance(
          from,
        );
        setRolling(true);

        animationFrame =
          requestAnimationFrame(
            (nextNow) =>
              animate(
                nextNow,
                startedAt,
              ),
          );
      },
    );

    return () => {
      active = false;
      cancelAnimationFrame(
        animationFrame,
      );
    };
  }, [
    balanceCents,
    fromBalanceCents,
  ]);

  return (
    <div
      className={
        compact
          ? "wolf-wallet-final is-compact"
          : "wolf-wallet-final"
      }
      aria-label={`${displayName} Wolf Forge wallet`}
    >
      <div
        className="wolf-wallet-final__glow"
        aria-hidden="true"
      />

      <div
        className="wolf-wallet-final__waves"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 500 300"
          preserveAspectRatio="none"
        >
          <path d="M170 -30 C270 55 290 195 520 270" />
          <path d="M150 -20 C260 65 280 205 515 285" />
          <path d="M130 -10 C250 75 270 215 510 300" />
          <path d="M110 0 C240 85 260 225 505 315" />
          <path d="M90 10 C230 95 250 235 500 330" />
        </svg>
      </div>

      <Image
        src="/branding/wolf-head-mark.png"
        alt=""
        aria-hidden="true"
        className="wolf-wallet-final__logo"
        width={1920}
        height={1080}
        sizes="(max-width: 520px) 39vw, 164px"
        loading="eager"
        decoding="auto"
      />

      <div className="wolf-wallet-final__content">
        <span className="wolf-wallet-final__eyebrow">
          {eyebrow}
        </span>

        <strong className="wolf-wallet-final__name">
          {displayName}
        </strong>

        <span
          className="wolf-wallet-final__line"
          aria-hidden="true"
        />

        <span className="wolf-wallet-final__balance-label">
          Available Balance
        </span>

        <div className="wolf-wallet-final__balance-window">
          <strong
            className={
              rolling
                ? "wolf-wallet-final__balance is-rolling"
                : "wolf-wallet-final__balance"
            }
          >
            {formatMoney(
              displayedBalance,
              currency,
            )}
          </strong>
        </div>
      </div>
    </div>
  );
}
