import "@fontsource-variable/inter";
import "./globals.css";
import type { Metadata } from "next";
import { SpeedInsights } from "../components/observability/speed-insights";

export const metadata: Metadata = {
  title: { default: "Wolf Forge", template: "%s · Wolf Forge" },
  description: "Wolf Forge internal operating workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
