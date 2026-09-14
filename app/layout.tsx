import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { Atkinson_Hyperlegible_Next, Dela_Gothic_One } from "next/font/google";
import { TopBar } from "@/components/nav/TopBar";
import { StorageBanner } from "@/components/workspace/StorageBanner";
import { WorkspaceProvider } from "@/components/workspace/Providers";
import { SETTINGS_KEY } from "@/lib/settings/types";
import { themeBootScript, themeCssVariables } from "@/lib/theme/apply";
import { BUILT_IN_THEMES, SUMMER_SKY } from "@/lib/theme/themes";
import "./globals.css";

const display = Dela_Gothic_One({ weight: "400", subsets: ["latin"], variable: "--mc-face-display" });
// Next can't compute fallback metrics for this family, so use a plain system fallback.
const body = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  variable: "--mc-face-body",
  adjustFontFallback: false,
  fallback: ["system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: { default: "Moechess", template: "%s | Moechess" },
  description: "Learn chess openings move by move, then drill them with spaced repetition.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme={SUMMER_SKY.id}
      className={`${display.variable} ${body.variable}`}
      style={themeCssVariables(SUMMER_SKY) as CSSProperties}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript(BUILT_IN_THEMES, SETTINGS_KEY) }} />
      </head>
      <body className="mc-body">
        <WorkspaceProvider>
          <a className="mc-skip-link" href="#main">Skip to content</a>
          <TopBar />
          <StorageBanner />
          <main id="main" className="mc-main">
            {children}
          </main>
        </WorkspaceProvider>
      </body>
    </html>
  );
}
