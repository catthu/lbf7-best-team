import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Script from "next/script";
import SiteFooter from "@/components/SiteFooter";
import MainNav from "@/components/MainNav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Locality Explorer",
    template: "%s | Locality Explorer",
  },
  description:
    "Interactive explorer for the Baker Lab protein–protein interaction network, with global graph, locality views, and pathway context.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head></head>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100`}
      >
        <div className="min-h-screen flex flex-col">
          <header className="sticky top-0 z-20 bg-gray-50 text-gray-900 border-b border-gray-200 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-800">
            <MainNav />
          </header>
          <main className="relative flex-1 overflow-hidden">{children}</main>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
