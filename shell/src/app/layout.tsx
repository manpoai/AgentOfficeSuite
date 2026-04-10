import type { Metadata } from 'next';
import './globals.css';
import '@/components/editor/editor-styles.css';
import { Providers } from './providers';
import { Inter, Instrument_Serif } from 'next/font/google';
import { cn } from '@/lib/utils';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const instrumentSerif = Instrument_Serif({ subsets: ['latin'], weight: '400', variable: '--font-instrument-serif' });

export const metadata: Metadata = {
  title: 'ASuite',
  description: 'Human-Agent Workspace',
  icons: {
    icon: '/favicon.svg',
  },
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    viewportFit: 'cover',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ASuite',
  },
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${instrumentSerif.variable}`} suppressHydrationWarning>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
