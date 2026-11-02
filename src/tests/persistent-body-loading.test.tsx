/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import ProjectLoading from "../app/(internal)/orders/[orderId]/loading";
import SettingsLoading from "../app/(internal)/settings/loading";
import * as skeletons from "../components/shell/route-skeletons";
import project from "../components/projects/project-detail.module.css";

afterEach(cleanup);
function bodyOnly(container: HTMLElement) {
  expect(container.querySelector(`.page-header, nav, .${project.subnav}, .${project.rail}, a, button, input`)).toBeNull();
  expect(screen.getAllByRole("status")).toHaveLength(1);
}

it("keeps the default Project fallback below the already-real title, tabs and rail", () => {
  const { container } = render(<ProjectLoading />);
  expect(container.querySelector("[data-skeleton-body='details']")).toBeTruthy();
  expect(container.querySelector("[data-skeleton-block='project-responses']")).toBeTruthy();
  expect(container.querySelector("[data-skeleton-block='project-conversation']")).toBeTruthy();
  expect(container.querySelector("[data-skeleton-block='project-tasks']")).toBeTruthy();
  bodyOnly(container);
});

it("provides distinct file rows and dated-history body shapes without repeating record chrome", () => {
  expect(skeletons).toHaveProperty("ProjectFilesSkeleton", expect.any(Function));
  expect(skeletons).toHaveProperty("ProjectHistorySkeleton", expect.any(Function));
  const files = render(<skeletons.ProjectFilesSkeleton />);
  expect(files.container.querySelector(`.${project.filesList}`)?.children).toHaveLength(3);
  expect(files.container.querySelector(`.${project.filesTable} .${project.filesHeaderRow}`)?.children).toHaveLength(2);
  expect(files.container.querySelectorAll(`.${project.filesNameGroup}, .${project.filesDate}`)).toHaveLength(6);
  bodyOnly(files.container);
  cleanup();
  const history = render(<skeletons.ProjectHistorySkeleton />);
  expect(history.container.querySelector(`.${project.historyStream} .${project.historyGroup}`)).toBeTruthy();
  expect(history.container.querySelectorAll(`.${project.historyList} li`)).toHaveLength(3);
  bodyOnly(history.container);
});

it("uses only a section body inside the persistent Settings title/navigation", () => {
  const { container } = render(<SettingsLoading />);
  expect(container.querySelector("[data-skeleton-body='settings']")).toBeTruthy();
  expect(container.querySelector(".settings-page-layout, .page-header, nav, input, button")).toBeNull();
  expect(screen.getAllByRole("status")).toHaveLength(1);
});

it("reserves a Project frame and placeholder rail for entry before the real layout is ready", () => {
  const { container } = render(<skeletons.RouteSkeleton pathname="/orders/one/history" />);
  expect(container.querySelector("[data-skeleton='projectDetail']")).toBeTruthy();
  expect(container.querySelectorAll(`.${project.rail}`)).toHaveLength(1);
  expect(container.querySelector("[data-skeleton-body='history']")).toBeTruthy();
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(container.querySelector("input, button, a")).toBeNull();
});
