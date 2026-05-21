import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-outfit",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SouthFarm - Dashboard",
  description: "Automatizacion movil para Instagram",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={outfit.variable}>
      <body className="antialiased" style={{ fontFamily: "var(--font-outfit), 'Outfit', system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
