export const WHITE_LABEL_COLOR_TEMPLATES = [
  { name: "Wolf Forge Default", primaryColor: "#000d51", accentColor: "#a8832e" },
  { name: "Executive Navy", primaryColor: "#111c38", accentColor: "#c8a96b" },
  { name: "Modern Sand", primaryColor: "#4b4138", accentColor: "#d8bc8c" },
  { name: "Slate Gold", primaryColor: "#28333f", accentColor: "#c2a15f" },
  { name: "Forest Premium", primaryColor: "#173c32", accentColor: "#d2b777" },
  { name: "Minimal Mono", primaryColor: "#202124", accentColor: "#e0e0e0" },
] as const;

export function parseHexColor(value: string): string | null {
  const match = value.trim().match(/^#?([0-9a-f]{6})$/i);
  return match?.[1] ? `#${match[1].toLowerCase()}` : null;
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function colorContrast(first: string, second: string): number {
  const values = [luminance(first), luminance(second)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

export function previewForeground(background: string): string {
  if (colorContrast(background, "#000d51") >= 4.5) return "#000d51";
  return colorContrast(background, "#ffffff") >= 4.5 ? "#ffffff" : "#000000";
}
