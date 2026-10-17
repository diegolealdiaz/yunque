import type { Metadata } from "next";
import type { ReactNode } from "react";
import { JetBrains_Mono, Montserrat } from "next/font/google";
import Script from "next/script";

import { THEME_BOOT_SCRIPT } from "@/src/ui/theme";

import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Yunque",
  description: "El agente que paga sin salirse de las reglas",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // El script pone el tema en <html> antes de pintar (Next lo sube al <head>); por eso React
  // no debe quejarse de que el atributo difiera del que salió del servidor.
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${montserrat.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Script id="tema" strategy="beforeInteractive">
          {THEME_BOOT_SCRIPT}
        </Script>
        {children}
      </body>
    </html>
  );
}
