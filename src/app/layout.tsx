import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { LoadingFeedback } from "./loading-feedback";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "UaiFlow",
  applicationName: "UaiFlow",
  description: "Automações de Instagram em português para comentários, mensagens e links.",
  appleWebApp: {
    capable: true,
    title: "UaiFlow",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <LoadingFeedback />
      </body>
    </html>
  );
}
