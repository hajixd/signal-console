import type { Metadata } from "next";
import AppSessionProvider from "@/components/auth/app-session-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trading Bot",
  description: "Live signal dashboard, strategy backtests, and alert console"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("trading-bot-theme")||localStorage.getItem("signal-console-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}}catch(e){}`
          }}
        />
      </head>
      <body><AppSessionProvider>{children}</AppSessionProvider></body>
    </html>
  );
}
