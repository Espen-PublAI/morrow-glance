import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const title = 'Morrow Glance';
const description =
  'A calm, open-source ambient display for browsers and paper screens.';

function publicOrigin(): URL {
  try {
    return new URL(process.env.MORROW_PUBLIC_URL ?? 'http://localhost:3000');
  } catch {
    return new URL('http://localhost:3000');
  }
}

export const metadata: Metadata = {
  metadataBase: publicOrigin(),
  title,
  description,
  // No favicon yet; an empty data URL keeps browsers from requesting /favicon.ico.
  icons: { icon: 'data:,' },
  openGraph: {
    title,
    description,
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: title }],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
