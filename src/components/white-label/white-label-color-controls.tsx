"use client";

import { useId, useState, type Dispatch, type SetStateAction } from "react";
import { WHITE_LABEL_COLOR_TEMPLATES, colorContrast, parseHexColor } from "../../domain/white-label/colors";
import type { WhiteLabelPreviewState } from "../../domain/white-label/preview";
import styles from "./white-label-builder.module.css";

type ColorKey = "primaryColor" | "accentColor";

function ColorField({ label, help, value, onChange, onValidityChange }: {
  label: string;
  help: string;
  value: string;
  onChange: (value: string) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const id = useId();
  const [edit, setEdit] = useState<{ source: string; raw: string } | null>(null);
  const hex = edit?.source === value ? edit.raw : value;
  const invalid = parseHexColor(hex) === null;
  return (
    <div className={styles.customColor}>
      <div className={styles.colorLabel}><label htmlFor={`${id}-hex`}>{label}</label><small id={`${id}-help`}>{help}</small></div>
      <div className={styles.colorInputs}>
        <input className={styles.colorPicker} type="color" value={value} aria-label={`${label} picker`} onChange={(event) => {
          setEdit(null);
          onChange(event.target.value.toLowerCase());
          onValidityChange(true);
        }} />
        <input id={`${id}-hex`} className={styles.hexInput} type="text" value={hex} maxLength={7} spellCheck={false} autoComplete="off"
          aria-invalid={invalid || undefined} aria-describedby={`${id}-help${invalid ? ` ${id}-error` : ""}`}
          onChange={(event) => {
            const raw = event.target.value;
            setEdit({ source: value, raw });
            const parsed = parseHexColor(raw);
            onValidityChange(parsed !== null);
            if (parsed) onChange(parsed);
          }} />
      </div>
      {invalid ? <p className={styles.colorError} id={`${id}-error`}>Enter six hex digits, for example #000D51. The preview keeps the last valid color.</p> : null}
    </div>
  );
}

export function WhiteLabelColorControls({ state, onStateChange, readOnly, onValidityChange }: {
  state: WhiteLabelPreviewState;
  onStateChange: Dispatch<SetStateAction<WhiteLabelPreviewState>>;
  readOnly: boolean;
  onValidityChange?: (valid: boolean) => void;
}) {
  const [validity, setValidity] = useState({ primaryColor: true, accentColor: true });
  const [reset, setReset] = useState(0);
  const selected = WHITE_LABEL_COLOR_TEMPLATES.find((template) => template.primaryColor === state.primaryColor && template.accentColor === state.accentColor);
  function apply(template: typeof WHITE_LABEL_COLOR_TEMPLATES[number]) {
    onStateChange((current) => ({ ...current, primaryColor: template.primaryColor, accentColor: template.accentColor }));
    setReset((current) => current + 1);
    setValidity({ primaryColor: true, accentColor: true });
    onValidityChange?.(true);
  }
  function valid(key: ColorKey, value: boolean) {
    const next = { ...validity, [key]: value };
    setValidity(next);
    onValidityChange?.(next.primaryColor && next.accentColor);
  }
  return (
    <fieldset className={styles.group} disabled={readOnly}>
      <legend>Brand colors</legend>
      <section aria-label="Color templates" className={styles.templates}>
        <div className={styles.templateHeader}><h3>Color templates</h3><span>{selected?.name ?? "Custom colors"}</span></div>
        <div className={styles.templateGrid}>
          {WHITE_LABEL_COLOR_TEMPLATES.map((template) => (
            <button type="button" key={template.name} className={styles.templateButton} aria-pressed={selected === template} onClick={() => apply(template)}>
              <span className={styles.templateSwatches} aria-hidden="true"><i style={{ backgroundColor: template.primaryColor }} /><i style={{ backgroundColor: template.accentColor }} /></span>
              <span>{template.name}</span>
            </button>
          ))}
        </div>
        <p className={styles.hint}>Start with a template, then adjust either color.</p>
      </section>
      <div className={styles.customColors}>
        {([['primaryColor', 'Primary color', 'Sidebar and brand surfaces'], ['accentColor', 'Accent color', 'Active items and actions']] as const).map(([key, label, help]) => (
          <ColorField key={`${key}-${reset}`} label={label} help={help} value={state[key]} onChange={(value) => onStateChange((current) => ({ ...current, [key]: value }))} onValidityChange={(value) => valid(key, value)} />
        ))}
      </div>
      <button type="button" className={styles.resetColors} onClick={() => apply(WHITE_LABEL_COLOR_TEMPLATES[0])}>Reset to Wolf Forge Default</button>
      <div role="status" aria-live="polite">
        {colorContrast(state.primaryColor, "#ffffff") < 7 ? <p className={styles.warning}>Sidebar text may be hard to read in white. The preview adapts its text; a darker primary color keeps the familiar brand treatment.</p> : null}
        {colorContrast(state.primaryColor, state.accentColor) < 3 ? <p className={styles.warning}>Primary and accent colors are very similar. Choose more contrast so active navigation is easy to distinguish.</p> : null}
      </div>
    </fieldset>
  );
}
