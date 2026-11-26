/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { WorkflowMonthSelect } from "../components/operations/workflow-month-select";

afterEach(cleanup);

it("shows the requested month while the previous month's results remain visible", async () => {
  let finish!: () => void;
  const response = new Promise<void>(resolve => { finish = resolve; });
  function MonthView() {
    const [value, setValue] = useState("June");
    const [ready, setReady] = useState(false);
    if (value === "July" && !ready) throw response;
    return <>
      <WorkflowMonthSelect label="Month" menuLabel="Select month" name="month" value={value}
        options={["June", "July"].map(month => ({ label: month, value: month }))}
        onChange={month => { setValue(month); void response.then(() => setReady(true)); }} />
      <p>{value} rows</p>
    </>;
  }
  render(<MonthView />);
  fireEvent.click(screen.getByRole("button"));
  fireEvent.click(screen.getByRole("option", { name: "July" }));
  expect(screen.getByRole("status")).toHaveTextContent("Updating to July... Showing June results.");
  expect(screen.getByText("June rows")).toBeVisible();
  await act(async () => { finish(); await response; });
  expect(screen.getByText("July rows")).toBeVisible();
  expect(screen.queryByRole("status")).toBeNull();
});
