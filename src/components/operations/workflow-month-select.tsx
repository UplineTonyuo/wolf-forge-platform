"use client";

import { startTransition, useOptimistic, type ComponentProps } from "react";
import { AnimatedSelect } from "../ui/animated-select";

export function WorkflowMonthSelect({ value, onChange, options, ...props }: ComponentProps<typeof AnimatedSelect>) {
  const [selected, select] = useOptimistic(value);
  const label = (month: string) => options.find(option => option.value === month)?.label ?? month;

  return <div>
    <AnimatedSelect {...props} options={options} value={selected} onChange={month => {
      startTransition(() => {
        select(month);
        onChange(month);
      });
    }} />
    {selected !== value && <small role="status">Updating to {label(selected)}... Showing {label(value)} results.</small>}
  </div>;
}
