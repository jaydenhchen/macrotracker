import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BlueJay Fuel — JHU Dining Macro Tracker",
  description: "A local-first nutrition tracker for Johns Hopkins students.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
