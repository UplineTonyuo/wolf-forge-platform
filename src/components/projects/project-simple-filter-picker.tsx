"use client";

import { ProjectFilterPopover } from "./project-filter-popover";
import { SimpleFilterContent, type SimpleFilterOption } from "./project-simple-filter-content";

/**
 * Desktop Person / Client / Status filter control: the shared popover shell
 * plus the shared search + option-list body, so these three fields (and
 * mobile's identical content inside the Filters sheet) never drift into
 * separate implementations.
 */
export function ProjectSimpleFilterPicker({
  triggerId,
  ariaLabel,
  triggerLabel,
  fixedOptions,
  options,
  value,
  onChange,
  searchPlaceholder,
}: {
  triggerId: string;
  ariaLabel: string;
  triggerLabel: string;
  fixedOptions: SimpleFilterOption[];
  options: SimpleFilterOption[];
  value: string;
  onChange: (value: string) => void;
  searchPlaceholder: string;
}) {
  return (
    <ProjectFilterPopover
      triggerId={triggerId}
      triggerLabel={triggerLabel}
      ariaLabel={ariaLabel}
      render={({ close }) => (
        <SimpleFilterContent
          fixedOptions={fixedOptions}
          options={options}
          value={value}
          searchPlaceholder={searchPlaceholder}
          compactSearch
          onSelect={(id) => {
            onChange(id);
            close();
          }}
        />
      )}
    />
  );
}
