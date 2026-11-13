import React from "react";
import { ReceiptIcon, UserIcon, ClockIcon } from "../Icons";

export default function ReceiptCard({ sale, selected, onSelect, formatDate }) {
  const money = (n) => `₱${Number(n || 0).toFixed(2)}`;

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left bg-white rounded-2xl border p-5 transition-all duration-200 group cursor-pointer ${
        selected
          ? "border-blue-500 ring-2 ring-blue-500/20 shadow-md"
          : "border-gray-200 hover:border-blue-300 hover:shadow-md hover:-translate-y-0.5"
      }`}
    >
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 transition ${
                selected ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-600 group-hover:bg-blue-100"
              }`}
            >
              <ReceiptIcon className="w-4 h-4" />
            </span>
            <div>
              <p className="font-semibold text-gray-900">Receipt #{sale.receiptId}</p>
              <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                <ClockIcon className="w-3.5 h-3.5" />
                {formatDate(sale.created_at)}
              </p>
            </div>
          </div>

          {sale.customer_name?.trim() && (
            <p className="mt-2.5 text-sm text-gray-600 flex items-center gap-1.5">
              <UserIcon className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="truncate">{sale.customer_name.trim()}</span>
            </p>
          )}

          <div className="mt-3 space-y-1.5">
            {sale.items.slice(0, 4).map((item) => (
              <div key={item.id} className="flex justify-between text-sm gap-3">
                <span className="text-gray-700 truncate">
                  {item.product_name} <span className="text-gray-400">× {item.quantity}</span>
                </span>
                <span className="text-gray-500 shrink-0">{money(item.total)}</span>
              </div>
            ))}
            {sale.items.length > 4 && (
              <p className="text-xs text-gray-400">+{sale.items.length - 4} more item(s)</p>
            )}
          </div>
        </div>

        <div className="text-right shrink-0">
          <p className="text-xs text-gray-400 font-medium">Total</p>
          <p className="text-xl font-bold text-emerald-600">{money(sale.total)}</p>
        </div>
      </div>
    </button>
  );
}
