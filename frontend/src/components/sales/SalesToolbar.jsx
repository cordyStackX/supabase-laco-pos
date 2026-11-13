import React, { useState } from "react";
import {
  SearchIcon,
  CalendarIcon,
  FilterIcon,
  ResetIcon,
  XIcon,
  ChevronDownIcon,
} from "../Icons";

const FILTER_OPTIONS = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "month", label: "This Month" },
];

const FILTER_LABELS = { all: "All Time", today: "Today", month: "This Month", custom: "Custom Date" };

const controlClass =
  "h-10 rounded-lg border border-gray-300 bg-gray-50 text-sm text-gray-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition";

const wrapClass =
  "flex items-center gap-2.5 pl-3 pr-2 h-10 rounded-lg border border-gray-300 bg-gray-50 text-sm focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-500/40 focus-within:border-blue-500 transition";

const buttonClass = "h-10 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-800 transition";

export default function SalesToolbar({
  customDate,
  onDateChange,
  search,
  onSearchChange,
  filter,
  onFilterChange,
  departments,
  departmentFilter,
  onDepartmentChange,
  onReset,
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
      {/* Search */}
      <div className="flex-1 min-w-[200px]">
        <div className={wrapClass}>
          <SearchIcon className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search receipt, customer, or product…"
            className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-gray-400 text-gray-800"
          />
          {search && (
            <button
              onClick={() => onSearchChange("")}
              className="text-gray-400 hover:text-gray-600 transition shrink-0"
              aria-label="Clear search"
            >
              <XIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Date picker */}
      <div className={wrapClass}>
        <CalendarIcon className="w-4 h-4 text-gray-400 shrink-0" />
        <input
          type="date"
          value={customDate}
          onChange={onDateChange}
          className="flex-1 min-w-0 bg-transparent outline-none text-gray-800"
        />
      </div>

      {/* Filter dropdown */}
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className={`inline-flex items-center justify-center gap-2 px-3.5 ${controlClass} ${
            filter !== "all" ? "border-blue-500 text-blue-700 bg-blue-50" : ""
          }`}
        >
          <FilterIcon className="w-4 h-4" />
          <span>{FILTER_LABELS[filter] || "All Time"}</span>
          <ChevronDownIcon className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-44 bg-white rounded-xl border border-gray-200 shadow-lg p-1 z-20">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  onFilterChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                  filter === opt.value
                    ? "bg-blue-50 text-blue-700 font-semibold"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Department select */}
      {filter === "all" && departments.length > 0 && (
        <select
          value={departmentFilter}
          onChange={onDepartmentChange}
          className={`px-3 ${controlClass}`}
        >
          <option value="all">All Departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      )}

      {/* Reset */}
      <button
        onClick={onReset}
        className={`inline-flex items-center justify-center gap-1.5 px-3.5 ${buttonClass}`}
      >
        <ResetIcon className="w-4 h-4" />
        Reset
      </button>
    </div>
  );
}
