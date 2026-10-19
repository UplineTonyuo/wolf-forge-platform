import "@fontsource-variable/inter";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { SpeedInsights } from "../components/observability/speed-insights";
import { PwaProvider } from "../components/pwa/pwa-provider";

export const metadata: Metadata = {
  title: { default: "Wolf Forge", template: "%s · Wolf Forge" },
  description: "Wolf Forge internal operating workspace.",
  appleWebApp: { capable: true, title: "Wolf Forge", statusBarStyle: "default" },
  icons: { apple: "/branding/apple-touch-icon.png", icon: "/branding/app-192.png" },
};

export const viewport: Viewport = { themeColor: "#000d51" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <PwaProvider>{children}</PwaProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}
