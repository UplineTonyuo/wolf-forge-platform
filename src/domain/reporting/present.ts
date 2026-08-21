/**
 * Collapse casing, surrounding space and repeated whitespace so "YouTube
 * Stack", "Youtube Stack" and " youtube  stack " compare as one label.
 */
function comparable(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * Presentation rule for the client report viewer.
 *
 * A section titled "Blog Content" holding one entry also labelled "Blog
 * Content" prints the same phrase twice in a row. When a section has exactly
 * one entry and that entry's label is effectively the section's own title,
 * the label adds no information, so the viewer de-emphasises it and lets the
 * value carry the row alone. Multi-entry sections always render every label —
 * there the label is what tells the entries apart.
 *
 * Presentation only: the stored label is never changed, only de-emphasised.
 */
export function singleEntryRepeatsSectionTitle(section: {
  title: string;
  entries: readonly { label: string }[];
}): boolean {
  if (section.entries.length !== 1) return false;
  const label = section.entries[0]?.label ?? "";
  return label !== "" && comparable(label) === comparable(section.title);
}
