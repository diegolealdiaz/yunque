import type { Metadata } from "next";
import type { ReactNode } from "react";
import { JetBrains_Mono, Montserrat } from "next/font/google";
import { headers } from "next/headers";

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

export default async function RootLayout({ children }: { children: ReactNode }) {
  // El script pone el tema y el velo de la entrada en <html> antes de la primera pintura: va
  // en <head> como script en línea, con el nonce de la política de contenido. (Con
  // `next/script` y `beforeInteractive` corre recién al cargar el JavaScript de Next, después
  // de pintar: la portada se veía, se ocultaba y volvía a aparecer.) React no debe quejarse
  // de que los atributos de <html> difieran de los que salieron del servidor.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${montserrat.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        {/* eslint-disable-next-line react/no-danger -- constante propia, no contenido de nadie: como texto, React escaparía sus `&&` */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
