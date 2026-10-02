import type { MetadataRoute } from "next";

/** Lets staff "Add to Home Screen" / "Install app" on Android, iPhone and desktop. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MJGarcia Trading Payroll",
    short_name: "MJG Payroll",
    description: "Philippine payroll for MJGarcia Trading",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f6f7f9",
    theme_color: "#0f6b5c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
