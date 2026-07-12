import { useId } from "react";

export function NumberSettingField(props: {
  label: string;
  description: string;
  unit: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  return <label className="number-setting-field" htmlFor={id}>
    <span className="number-setting-title">{props.label}</span>
    <span className="number-setting-control">
      <input id={id} aria-describedby={helpId} min={props.min} max={props.max} type="number" value={props.value}
        onChange={(event) => props.onChange(Math.min(props.max, Math.max(props.min, Number(event.target.value || props.min))))} />
      <span>{props.unit}</span>
    </span>
    <small id={helpId}>{props.description} ({props.min.toLocaleString()}–{props.max.toLocaleString()} {props.unit})</small>
  </label>;
}
