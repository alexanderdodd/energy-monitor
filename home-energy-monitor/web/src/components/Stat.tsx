interface StatProps {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}

export function Stat({ label, value, hint, accent }: StatProps) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={accent ? "value accent" : "value"}>{value}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}
