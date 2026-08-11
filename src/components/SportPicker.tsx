"use client";

export function SportPicker<T extends string>({
  sports,
  value,
  onChange,
}: {
  sports: Array<{ key: T; label: string }>;
  value: T;
  onChange: (sport: T) => void;
}) {
  return (
    <div className="sport-picker" role="tablist" aria-label="Sport">
      {sports.map((s) => (
        <button
          key={s.key}
          type="button"
          role="tab"
          aria-selected={value === s.key}
          className={value === s.key ? "sport-chip active" : "sport-chip"}
          onClick={() => onChange(s.key)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
