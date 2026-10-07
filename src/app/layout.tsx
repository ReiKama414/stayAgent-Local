import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stay Agent – Accommodation Search",
  description: "Local browser automation for accommodation search across Booking, Agoda, Airbnb, and Trip.com",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
      </head>
      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla) inject attributes like cz-shortcut-listen onto <body> */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
