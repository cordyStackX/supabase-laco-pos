import React from "react";
import { ReceiptIcon, UserIcon, ClockIcon } from "../Icons";

export default function ReceiptDetails({ sale, formatDate }) {
  const money = (n) => `₱${Number(n || 0).toFixed(2)}`;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden xl:sticky xl:top-6">
      <div className="bg-gradient-to-r from-blue-600 to-blue-500 px-5 py-4 text-white">
        <p className="text-xs uppercase tracking-wider text-blue-100">Receipt Details</p>
        <p className="text-lg font-bold mt-0.5">
          {sale ? `Receipt #${sale.receiptId}` : "Select a receipt"}
        </p>
      </div>

      {sale ? (
        <div className="p-5">
          <div className="flex items-center justify-between text-sm pb-3 border-b border-gray-100 gap-3">
            <span className="text-gray-500 flex items-center gap-1.5">
              <ClockIcon className="w-4 h-4 text-gray-400" />
              Date &amp; Time
            </span>
            <span className="text-gray-900 font-medium text-right">{formatDate(sale.created_at)}</span>
          </div>

          {sale.customer_name?.trim() && (
            <div className="flex items-center justify-between text-sm py-3 border-b border-gray-100 gap-3">
              <span className="text-gray-500 flex items-center gap-1.5">
                <UserIcon className="w-4 h-4 text-gray-400" />
                Customer
              </span>
              <span className="text-gray-900 font-medium text-right">{sale.customer_name.trim()}</span>
            </div>
          )}

          <div className="mt-4 flex items-center gap-2 text-gray-900">
            <ReceiptIcon className="w-4 h-4 text-blue-600" />
            <p className="text-sm font-semibold">
              Purchased Items ({sale.items.length})
            </p>
          </div>

          <div className="mt-3 space-y-3 max-h-[300px] overflow-y-auto pr-1">
            {sale.items.map((item) => {
              const unit = item.quantity ? Number(item.total) / item.quantity : 0;
              return (
                <div key={item.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800">{item.product_name}</p>
                    <p className="text-xs text-gray-400">
                      {item.quantity} × {money(unit)}
                      {item.department ? ` · ${item.department}` : ""}
                      {item.buyerType ? ` · ${item.buyerType}` : ""}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-gray-900 shrink-0">{money(item.total)}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-4 pt-4 border-t border-gray-200 flex justify-between items-center">
            <span className="text-sm text-gray-500 font-medium">Total Amount</span>
            <span className="text-xl font-bold text-emerald-600">{money(sale.total)}</span>
          </div>
        </div>
      ) : (
        <div className="p-10 text-center text-gray-400">
          <ReceiptIcon className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">No receipt selected</p>
          <p className="text-xs text-gray-400 mt-1">Click a transaction to view its details</p>
        </div>
      )}
    </div>
  );
}
