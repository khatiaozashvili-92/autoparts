import type { Metadata } from 'next';
import './globals.css';
import { SessionProvider } from '../lib/session';
import { Shell } from '../components/shell';

export const metadata: Metadata = {
  title: 'autoparts — ნაწილები შენი ავტომობილისთვის',
  description:
    'შეიყვანე VIN ერთხელ და აღარასოდეს იფიქრო, მოერგება თუ არა ნაწილი შენს მანქანას.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ka">
      <body>
        <SessionProvider>
          <Shell>{children}</Shell>
        </SessionProvider>
      </body>
    </html>
  );
}
