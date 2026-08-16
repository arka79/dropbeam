import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DropBeam — Private P2P File Sharing',
  description:
    'Send huge files directly between browsers. No server storage. End-to-end peer transfer.',
  themeColor: '#06070a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
