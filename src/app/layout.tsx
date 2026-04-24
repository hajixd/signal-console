import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Signal Console",
  description: "Standalone live signal console, replay dashboard, and cron runner"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("signal-console-theme")||localStorage.getItem("trade-dashboard-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}}catch(e){}`
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
