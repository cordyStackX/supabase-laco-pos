import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChartIcon } from "../Icons";

const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
  fontSize: 13,
};

export default function SalesChart({ data }) {
  const hasData = data.length > 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-5">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Sales Analytics</h3>
          <p className="text-sm text-gray-500">Daily revenue from filtered transactions</p>
        </div>
        {hasData && (
          <span className="text-xs font-medium px-3 py-1 rounded-full bg-blue-50 text-blue-700">
            {data.length} active day{data.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {hasData ? (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
              minTickGap={28}
            />
            <YAxis
              tick={{ fontSize: 12, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
              width={72}
              tickFormatter={(v) => `₱${v}`}
            />
            <Tooltip
              cursor={{ fill: "#eff6ff" }}
              formatter={(value) => [`₱${Number(value).toFixed(2)}`, "Revenue"]}
              contentStyle={TOOLTIP_STYLE}
            />
            <Bar dataKey="revenue" fill="#2563EB" radius={[6, 6, 0, 0]} maxBarSize={42} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <div className="h-14 w-14 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
            <ChartIcon className="w-7 h-7" />
          </div>
          <p className="text-sm font-medium text-gray-500">No sales data to chart</p>
          <p className="text-xs text-gray-400 mt-1">Adjust the filters to view analytics</p>
        </div>
      )}
    </div>
  );
}
