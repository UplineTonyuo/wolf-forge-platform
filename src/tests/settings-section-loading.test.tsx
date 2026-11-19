/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { RouteSkeleton, SettingsSectionSkeleton } from "../components/shell/route-skeletons";
import report from "../components/reporting/reporting.module.css";
import settings from "../components/settings/settings-foundation.module.css";
import profile from "../components/settings/settings-workspace.module.css";
import manual from "../components/invoices/invoice-manual-payment.module.css";
afterEach(cleanup);
it("uses Reporting's actual list and row layout instead of generic rows", () => {
  const { container } = render(<RouteSkeleton pathname="/reporting" />);
  expect(container.querySelector(`.${report.list}`)).toBeTruthy();
  expect(container.querySelectorAll(`.${report.row}`)).toHaveLength(5);
  expect(container.querySelectorAll(`.${report.rowMain} .${report.rowMeta}`)).toHaveLength(5);
  expect(container.querySelectorAll(`.${report.rowSide}`)).toHaveLength(5);
  expect(container.querySelector(`.page-actions > .${report.compactAction}.page-action-compact`)).toBeTruthy();
});

it.each([
  ["general", profile.identity, 1],
  ["team", settings.teamMetric, 3],
  ["billing", manual.form, 1],
  ["integrations", settings.providerCard, 3],
  ["notifications", settings.preferenceRow, 1],
  ["security", profile.toggleRow, 1],
] as const)("reserves %s content using that page's structural classes", (section, layoutClass, count) => {
  const { container } = render(<SettingsSectionSkeleton section={section} />);
  expect(container.querySelectorAll(`.${layoutClass}`)).toHaveLength(count);
  expect(container.querySelector("[data-settings-section]")).toHaveAttribute("data-settings-section", section);
  expect(container.querySelector("nav, .page-header, input, button, a")).toBeNull();
  expect(screen.getAllByRole("status")).toHaveLength(1);
});
