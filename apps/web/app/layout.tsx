import type { Metadata } from "next";

import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { dashboardSourceLabel } from "@/lib/dashboard/server-repo";

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
      <body className="min-h-screen antialiased">
        <div className="flex min-h-screen flex-col">
          <SiteHeader />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
          <SiteFooter source={dashboardSourceLabel()} />
        </div>
      </body>
    </html>
  );
}
