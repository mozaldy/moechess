"use client";

import type { Theme } from "@/lib/theme/themes";

export interface ThemePickerProps {
  themes: Theme[];
  value: string;
  onChange: (themeId: string) => void;
}

const SWATCH_TOKENS = ["bg", "board-light", "board-dark", "accent-course"] as const;

export function ThemePicker({ themes, value, onChange }: ThemePickerProps) {
  return (
    <div className="mc-theme-options">
      {themes.map((theme) => (
        <label key={theme.id} className="mc-theme-option" data-theme-id={theme.id}>
          <input
            type="radio"
            name="moechess-theme"
            value={theme.id}
            checked={value === theme.id}
            onChange={() => onChange(theme.id)}
          />
          <span className="mc-theme-swatch" aria-hidden="true">
            {SWATCH_TOKENS.map((token) => (
              <span key={token} style={{ background: theme.tokens[token] }} />
            ))}
          </span>
          <span>{theme.name}</span>
        </label>
      ))}
    </div>
  );
}
