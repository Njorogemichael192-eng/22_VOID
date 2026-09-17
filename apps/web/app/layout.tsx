import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "22_VOID — Football-First Arbitrage Detection",
  description:
    "Cloud-hosted sports-arbitrage research platform. Every opportunity is proven against settlement states before it is displayed.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}