"use client";

import { useWorkspace } from "@/components/workspace/Providers";
import { SESSION_SIZE_MAX, SESSION_SIZE_MIN } from "@/lib/settings/types";
import { BUILT_IN_THEMES } from "@/lib/theme/themes";
import { ThemePicker } from "./ThemePicker";

export function SettingsForm() {
  const { settings, updateSettings } = useWorkspace();

  return (
    <form className="mc-settings" onSubmit={(event) => event.preventDefault()}>
      <fieldset>
        <legend>Theme</legend>
        <ThemePicker themes={BUILT_IN_THEMES} value={settings.themeId} onChange={(themeId) => updateSettings({ themeId })} />
      </fieldset>

      <fieldset>
        <legend>Play as</legend>
        <div className="mc-radio-row">
          {(["white", "black"] as const).map((side) => (
            <label key={side}>
              <input
                type="radio"
                name="moechess-settings-side"
                value={side}
                checked={settings.side === side}
                onChange={() => updateSettings({ side })}
              />{" "}
              {side === "white" ? "White" : "Black"}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Review session</legend>
        <label>
          Positions per session{" "}
          <input
            type="number"
            min={SESSION_SIZE_MIN}
            max={SESSION_SIZE_MAX}
            value={settings.sessionSize}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isInteger(value) && value >= SESSION_SIZE_MIN && value <= SESSION_SIZE_MAX) {
                updateSettings({ sessionSize: value });
              }
            }}
          />
        </label>
        <p className="mc-muted">
          Between {SESSION_SIZE_MIN} and {SESSION_SIZE_MAX}. Changes save automatically.
        </p>
      </fieldset>
    </form>
  );
}
