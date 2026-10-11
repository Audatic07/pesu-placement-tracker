import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PESU Placement Tracker",
  description:
    "Placement statistics for PES University — tracked across batches, branches, tiers and companies.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
