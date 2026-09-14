import type { Theme } from "./themes";
import { TOKEN_NAMES, cssVar } from "./tokens";

export function themeCssVariables(theme: Theme): Record<string, string> {
  return Object.fromEntries(TOKEN_NAMES.map((name) => [cssVar(name), theme.tokens[name]]));
}

export function applyTheme(root: HTMLElement, theme: Theme): void {
  for (const [name, value] of Object.entries(themeCssVariables(theme))) {
    root.style.setProperty(name, value);
  }
  root.setAttribute("data-theme", theme.id);
}

// Runs in <head> before paint so a saved theme never flashes the default one.
// It reads the settings record directly because React hasn't loaded yet.
export function themeBootScript(themes: Theme[], settingsKey: string): string {
  const variables = Object.fromEntries(themes.map((theme) => [theme.id, themeCssVariables(theme)]));
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
  return `(function(){try{var t=${json(variables)};var s=JSON.parse(localStorage.getItem(${json(settingsKey)})||"null");var id=s&&typeof s.themeId==="string"&&Object.prototype.hasOwnProperty.call(t,s.themeId)?s.themeId:null;if(!id)return;var r=document.documentElement,v=t[id];for(var k in v)r.style.setProperty(k,v[k]);r.setAttribute("data-theme",id)}catch(e){}})()`;
}
