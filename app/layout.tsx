import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sora Local Studio",
  description: "A quiet local workstation for video generation experiments.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
