import './globals.css';
import type { ReactNode } from 'react';

// The document every page in this export is wrapped in. Deliberately bare: each page is
// loaded into a window of its own, and three of them (the toasts stack, the compose
// picker, the mail-drop modal) paint their own transparent background, so anything set
// here would have to be undone there.

export const metadata = { title: 'Gmail Desktop' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
