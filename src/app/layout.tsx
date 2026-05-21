import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geist = localFont({
  src: [
    { path: "../../node_modules/geist/dist/fonts/geist-sans/Geist-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../node_modules/geist/dist/fonts/geist-sans/Geist-Medium.woff2", weight: "500", style: "normal" },
    { path: "../../node_modules/geist/dist/fonts/geist-sans/Geist-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../../node_modules/geist/dist/fonts/geist-sans/Geist-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-geist",
  display: "swap",
});

const jetbrains = localFont({
  src: [
    { path: "../../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SouthFarm - Dashboard",
  description: "Automatizacion movil para Instagram",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${geist.variable} ${jetbrains.variable}`}>
      <body className="antialiased" style={{ fontFamily: "var(--font-geist), system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
