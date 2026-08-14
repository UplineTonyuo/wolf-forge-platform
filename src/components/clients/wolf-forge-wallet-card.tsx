"use client";

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

    if (
      reducedMotion ||
      from === to
    ) {
      setDisplayedBalance(to);
      setRolling(false);
      return;
    }

    let animationFrame = 0;

    const duration = 1650;
    const startedAt =
      performance.now();

    setDisplayedBalance(from);
    setRolling(true);

    const animate = (
      now: number,
    ) => {
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
            animate,
          );

        return;
      }

      setDisplayedBalance(to);
      setRolling(false);
    };

    animationFrame =
      requestAnimationFrame(
        animate,
      );

    return () => {
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

      <img
        src="/branding/wolf-head-mark.png"
        alt=""
        aria-hidden="true"
        className="wolf-wallet-final__logo"
      />

      <div className="wolf-wallet-final__content">
        <span className="wolf-wallet-final__eyebrow">
          Client Wallet
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