import React from "react";

export default function MiniDonut({ percent = 0, color = "#2563EB", size = 64, strokeWidth = 7 }) {
  const R = (size - strokeWidth) / 2;
  const C = 2 * Math.PI * R;
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const offset = C * (1 - clamped / 100);
  const c = size / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={c} cy={c} r={R} fill="none" stroke="#e2e8f0" strokeWidth={strokeWidth} />
      <circle
        cx={c}
        cy={c}
        r={R}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${c} ${c})`}
        className="transition-all duration-700"
      />
      <text
        x={c}
        y={c}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size / 5}
        fontWeight={700}
        fill="#475569"
      >
        {clamped}%
      </text>
    </svg>
  );
}
