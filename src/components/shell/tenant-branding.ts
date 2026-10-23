import type { CSSProperties } from "react";
import { decodeRuntimeWhiteLabelConfiguration, type RuntimeWhiteLabelConfiguration } from "../../domain/white-label/publication";
import { colorContrast, previewForeground } from "../../domain/white-label/colors";

export function tenantBranding(configuration?: RuntimeWhiteLabelConfiguration) {
  if (configuration === undefined) return null;
  const decoded = decodeRuntimeWhiteLabelConfiguration(configuration);
  if (decoded.kind !== "published") return null;
  const snapshot = decoded.configuration;

  const onPrimary = previewForeground(snapshot.primaryColor);
  const ink = colorContrast(snapshot.primaryColor, "#ffffff") >= 4.5
    ? snapshot.primaryColor : previewForeground("#ffffff");
  return {
    name: snapshot.displayName,
    tenantId: snapshot.tenantId,
    revision: snapshot.publicationRevision,
    style: {
      "--tenant-primary": snapshot.primaryColor,
      "--tenant-accent": snapshot.accentColor,
      "--tenant-on-primary": onPrimary,
      "--tenant-on-accent": previewForeground(snapshot.accentColor),
      "--tenant-active-accent": colorContrast(snapshot.primaryColor, snapshot.accentColor) >= 3
        ? snapshot.accentColor : onPrimary,
      // Existing navy tokens serve as both ink and fills; light brands need readable ink on white.
      "--wf-navy": ink,
      "--wf-navy-hover": ink,
      "--wf-navy-wash": `color-mix(in srgb, ${snapshot.primaryColor} 7%, #ffffff)`,
      "--wf-gold": colorContrast(snapshot.accentColor, "#ffffff") >= 4.5 ? snapshot.accentColor : ink,
    } as CSSProperties,
  };
}
