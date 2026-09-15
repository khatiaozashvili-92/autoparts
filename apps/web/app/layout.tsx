import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'autoparts — Build Status',
  description: 'VIN-based auto parts marketplace. Implementation progress.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ka">
      <body>{children}</body>
    </html>
  );
}
