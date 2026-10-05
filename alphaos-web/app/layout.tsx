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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
