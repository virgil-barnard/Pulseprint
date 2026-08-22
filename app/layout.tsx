import type { Metadata } from "next";
import "./globals.css";
import "./evidence.css";
import "./beatbox.css";
import "./core.css";
import "./tracker.css";

export const metadata: Metadata = {
  title: "Pulseprint — Spectrotemporal Structure Laboratory",
  description: "Filter and inspect sound locally, track recurring time-frequency structures, and validate period and phase hypotheses through synchronized visual and audio folds.",
  openGraph: {
    title: "Pulseprint — Spectrotemporal Structure Laboratory",
    description: "From sound field to structure memory: transparent filtering, tracking, and audible period/phase validation.",
    images: ["https://pulseprint-rhythm-lab.virgil-barnard.chatgpt.site/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pulseprint",
    description: "From sound field to structure memory: transparent filtering, tracking, and audible period/phase validation.",
    images: ["https://pulseprint-rhythm-lab.virgil-barnard.chatgpt.site/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
