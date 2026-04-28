export const metadata = {
  title: "Nova Outreach",
  description: "Cold outreach for Nova Intel",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <meta name="referrer" content="no-referrer" />
      </head>
      <body style={{ margin: 0, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", background: "#0b0d12", color: "#e5e7eb" }}>
        {children}
      </body>
    </html>
  );
}
