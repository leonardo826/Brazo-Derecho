import type { Metadata } from "next";
import { Fraunces, Poppins, Source_Sans_3 } from "next/font/google";
import { headers } from "next/headers";
import { CsrfProvider } from "@/components/csrf-field";
import { CSRF_HEADER } from "@/lib/csrf-token";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const sans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Brazo Derecho",
    template: "%s · Brazo Derecho",
  },
  description: "Agentes para atender, cotizar y preparar las redes de tu pyme en Chile.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headerStore = await headers();
  const csrf = headerStore.get(CSRF_HEADER) ?? "";
  return (
    <html lang="es-CL">
      <body className={`${display.variable} ${sans.variable} ${poppins.variable}`}>
        <CsrfProvider token={csrf}>{children}</CsrfProvider>
      </body>
    </html>
  );
}
