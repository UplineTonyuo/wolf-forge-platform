import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Wolf Forge",
    short_name: "Wolf Forge",
    description: "Your Wolf Forge workspace.",
    start_url: "/launch",
    scope: "/",
    display: "standalone",
    background_color: "#000d51",
    theme_color: "#000d51",
    icons: [
      { src: "/branding/app-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/branding/app-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/branding/app-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
