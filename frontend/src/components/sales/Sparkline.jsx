import React from "react";

export default function Sparkline({ data, color = "#2563EB", width = 84, height = 40, strokeWidth = 2 }) {
  if (!data || data.length === 0) {
    return (
      <div className="w-20 h-10 flex items-center justify-center">
        <span className="text-[10px] text-gray-300">no data</span>
      </div>
    );
  }

  const nums = data.map(Number);
  const pts = nums.length === 1 ? [nums[0], nums[0]] : nums;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const stepX = width / Math.max(pts.length - 1, 1);
  const points = pts.map((n, i) => {
    const x = i * stepX;
    const y = height - ((n - min) / range) * (height - 4) - 2;
    return [x, y];
  });

  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,${height} ${line} ${width},${height}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polygon points={area} fill={color} opacity={0.12} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
