"use client";

import {
  ArrowLeft,
} from "lucide-react";

import {
  useRouter,
} from "next/navigation";

import {
  useRef,
  useState,
} from "react";

import styles from "./project-back-to-orders.module.css";


export function ProjectBackToOrders() {
  const router =
    useRouter();

  const [
    leaving,
    setLeaving,
  ] = useState(false);

  const timerRef =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);


  function goBack() {
    if (leaving) return;

    setLeaving(true);

    timerRef.current =
      setTimeout(() => {
        router.push("/orders");
      }, 145);
  }


  return (
    <button
      type="button"
      className={`${styles.button} ${
        leaving
          ? styles.leaving
          : ""
      }`}
      disabled={leaving}
      onClick={goBack}
    >
      <ArrowLeft
        size={15}
        aria-hidden="true"
      />

      <span>
        Orders
      </span>
    </button>
  );
}