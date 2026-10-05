import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AlphaOS | Token Intelligence", template: "%s | AlphaOS" },
  description: "Research tokens with promotion events, recorded market evidence and creator intelligence. Understand the token before you trade.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col"><aside aria-label="Research disclaimer" className="relative z-50 border-b border-emerald-400/15 bg-[#0d1422] px-4 py-3 text-xs leading-relaxed text-zinc-300 lg:pl-[274px]"><strong className="text-emerald-300">Research only — not a buy/sell signal bot.</strong> AlphaOS provides information for your own analysis. Verify current data and risks independently; returns are not guaranteed.</aside>{children}</body>
    </html>
  );
}
