import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "./activity-planner/planner.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SouthFarm — Command Center",
  description: "Centro de comando para warmups, scans y dispositivos móviles de tu agencia.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.variable} suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>{children}</body>
    </html>
  );
}
