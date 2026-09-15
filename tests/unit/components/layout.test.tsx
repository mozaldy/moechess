import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import RootLayout from "@/app/layout";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next/font/google", () => ({
  Dela_Gothic_One: () => ({ variable: "display-font" }),
  Atkinson_Hyperlegible_Next: () => ({ variable: "body-font" }),
}));

describe("RootLayout", () => {
  test("every page links to credits and licenses from the footer", () => {
    const html = renderToStaticMarkup(
      <RootLayout params={Promise.resolve({})}>
        <p>Page</p>
      </RootLayout>,
    );
    const page = new DOMParser().parseFromString(html, "text/html");
    // Nodes from DOMParser live in another document, so check plain DOM properties.
    const link = page.querySelector("footer.mc-footer a");
    expect(link?.textContent).toBe("Credits and licenses");
    expect(link?.getAttribute("href")).toBe("/credits");
    // The footer follows the main content.
    expect(page.querySelector("main#main + footer.mc-footer")).not.toBeNull();
  });
});
