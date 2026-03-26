import type { Metadata } from "next";
import { Providers } from "@/app/providers";
import { AppShell } from "@/components/layout/app-shell";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Letáky Admin",
  description: "Kontrola letáků, OCR a staging před databází",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="cs" className={`${inter.variable} h-full antialiased`}>
      <body
        className={`${inter.className} min-h-full bg-slate-50 text-slate-800`}
      >
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}


