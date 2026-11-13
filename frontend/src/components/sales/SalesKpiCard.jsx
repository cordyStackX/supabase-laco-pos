import React from "react";

export default function SalesKpiCard({ icon, label, value, sub, tileClass, chart }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex items-center justify-between gap-4 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5">
      <div className="flex items-center gap-4 min-w-0">
        <div
          className={`h-12 w-12 rounded-xl flex items-center justify-center shrink-0 ${tileClass}`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900 truncate mt-1">{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
        </div>
      </div>
      {chart && <div className="shrink-0">{chart}</div>}
    </div>
  );
}
