/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SubscriptionServicePicker, type SubscriptionPickerService } from "../components/subscriptions/subscription-service-picker";
import { SearchableSelect, type SearchableOption } from "../components/ui/searchable-select";
import { rankNameStrict } from "../domain/invoices/rank-name";
import type { ServiceFolderRow } from "../lib/supabase/database-rows";

const scrollIntoView = vi.fn();

beforeAll(() => {
  window.requestAnimationFrame = (callback) => {
    callback(0);
    return 0;
  };
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  cleanup();
  scrollIntoView.mockClear();
});

function ClientPicker({ options }: { options: SearchableOption[] }) {
  const [value, setValue] = useState("");
  return (
    <SearchableSelect
      name="company_id"
      label="Client / company"
      options={options}
      value={value}
      onChange={setValue}
      placeholder="Search client or company..."
      menuLabel="Clients and companies"
      menuRequiresQuery
      rank={rankNameStrict}
    />
  );
}

const peopleAndCompanies: SearchableOption[] = [
  { id: "antholy", label: "Antholy", kind: "client" },
  { id: "anthony", label: "Anthony", kind: "client" },
  { id: "northgate", label: "Northgate Dental", kind: "client" },
  { id: "company", label: "Wolf Forge Company", kind: "company" },
];

describe("Subscription Client / Company picker", () => {
  it("stays closed for an empty query, opens predictively, and closes when cleared", () => {
    render(<ClientPicker options={peopleAndCompanies} />);
    const input = screen.getByRole("combobox", { name: "Client / company" });

    fireEvent.focus(input);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "anth" } });
    expect(screen.getByRole("listbox", { name: "Clients and companies" })).toBeInTheDocument();
    expect(screen.getByText("Antholy")).toBeInTheDocument();
    expect(screen.getByText("Anthony")).toBeInTheDocument();
    expect(screen.queryByText("Northgate Dental")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "anth" } });
    expect(screen.getByRole("listbox", { name: "Clients and companies" })).toBeInTheDocument();
  });

  it("renders persisted record kinds without name or association heuristics", () => {
    render(<ClientPicker options={peopleAndCompanies} />);
    const input = screen.getByRole("combobox", { name: "Client / company" });

    fireEvent.change(input, { target: { value: "northgate" } });
    expect(screen.getByText("Northgate Dental").parentElement?.querySelector('[data-record-kind="client"]')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "wolf" } });
    expect(screen.getByText("Wolf Forge Company").parentElement?.querySelector('[data-record-kind="company"]')).toBeInTheDocument();
  });

  it("supports Arrow Up/Down, Home, End, Enter, Escape, and scrolls the highlighted row", () => {
    render(<ClientPicker options={peopleAndCompanies} />);
    const input = screen.getByRole("combobox", { name: "Client / company" });

    fireEvent.change(input, { target: { value: "anth" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "End" });
    expect(input).toHaveAttribute("aria-activedescendant");
    expect(scrollIntoView).toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Home" });
    fireEvent.keyDown(input, { key: "End" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("Anthony");
    expect(document.querySelector('input[name="company_id"]')).toHaveValue("anthony");

    fireEvent.change(input, { target: { value: "anth" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("submits the canonical id for either persisted record type", () => {
    render(<ClientPicker options={peopleAndCompanies} />);
    const input = screen.getByRole("combobox", { name: "Client / company" });

    fireEvent.change(input, { target: { value: "wolf" } });
    fireEvent.click(screen.getByText("Wolf Forge Company"));

    expect(document.querySelector('input[name="company_id"]')).toHaveValue("company");
  });
});

const folders: ServiceFolderRow[] = [
  { id: "seo", name: "SEO Sprints", description: null, image_url: null, parent_id: null, sort_order: 1, archived_at: null, created_at: "2026-01-01", updated_at: "2026-01-01" },
  { id: "authority", name: "Authority", description: null, image_url: null, parent_id: null, sort_order: 2, archived_at: null, created_at: "2026-01-01", updated_at: "2026-01-01" },
];

const services: SubscriptionPickerService[] = [
  { id: "seo-sprint", name: "SEO Sprint", folder_id: "seo", sort_order: 1, is_active: true },
  { id: "maps-sprint", name: "Maps Sprint", folder_id: "seo", sort_order: 2, is_active: true },
  { id: "press-release", name: "Press Release", folder_id: "authority", sort_order: 1, is_active: true },
];

function ServicePicker({ initial = "", disabled = false }: { initial?: string; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return <SubscriptionServicePicker folders={folders} services={services} value={value} onChange={setValue} disabled={disabled} />;
}

describe("Subscription Service picker", () => {
  it("follows Folder to Service and submits the canonical Service id", () => {
    render(<ServicePicker />);
    fireEvent.click(screen.getByRole("button", { name: /Choose a service/i }));
    expect(screen.getByRole("listbox", { name: "Service folders" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: /SEO Sprints/i }));
    expect(screen.getByRole("button", { name: /Change folder/i })).toBeInTheDocument();
    expect(screen.getByText("SEO Sprint").closest('[role="option"]')).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Maps Sprint/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Press Release/i })).not.toBeInTheDocument();

    const rowIcon = screen.getByText("SEO Sprint").parentElement?.previousElementSibling?.getAttribute("data-service-icon");
    fireEvent.click(screen.getByText("SEO Sprint").closest('[role="option"]') as HTMLElement);
    expect(document.querySelector('input[name="service_id"]')).toHaveValue("seo-sprint");
    expect(screen.getByRole("button", { name: /SEO Sprint/i }).querySelector("[data-service-icon]")).toHaveAttribute("data-service-icon", rowIcon);
  });

  it("offers an explicit Change folder path and preserves a fixed edit value", () => {
    render(<ServicePicker />);
    fireEvent.click(screen.getByRole("button", { name: /Choose a service/i }));
    fireEvent.click(screen.getByRole("option", { name: /Authority/i }));
    fireEvent.click(screen.getByRole("button", { name: /Change folder/i }));
    expect(screen.getByRole("listbox", { name: "Service folders" })).toBeInTheDocument();

    cleanup();
    render(<ServicePicker initial="press-release" disabled />);
    expect(document.querySelector('input[name="service_id"]')).toHaveValue("press-release");
    expect(screen.getByRole("button", { name: /Press Release/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Press Release/i }).querySelector("[data-service-icon]")).toBeInTheDocument();
  });
});
