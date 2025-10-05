import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Neil – NASA Bioscience Intelligence Chat Interface",
  description: "Neil, An AI-powered conversational interface to explore, query, and summarize NASA bioscience experiment publications",
  keywords: ["Neil", "AI", "NASA", "bioscience", "experiment", "publications"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${spaceGrotesk.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
