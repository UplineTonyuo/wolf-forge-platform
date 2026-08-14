"use client";

import {
  Plus,
} from "lucide-react";

import Link from "next/link";

import type {
  ProjectCapabilities,
} from "../../domain/orders/projections";

import styles from "./projects-header-actions.module.css";


export function ProjectsHeaderActions({
  capabilities,
}: {
  capabilities: ProjectCapabilities;
}) {

  if (!capabilities.create) {
    return null;
  }


  return (
    <div className={styles.root}>
      <Link
        href="/orders/new"
        className={
          styles.newProjectButton
        }
      >
        <Plus
          size={16}
          aria-hidden="true"
        />

        <span>
          New Project
        </span>
      </Link>
    </div>
  );
}