const departmentStyles = {
  Students: "bg-purple-100 text-purple-700 border-purple-200",
  Teachers: "bg-amber-100 text-amber-700 border-amber-200",
  Personnel: "bg-emerald-100 text-emerald-700 border-emerald-200",
  General: "bg-slate-100 text-slate-600 border-slate-200",
  BSIT: "bg-indigo-100 text-indigo-700 border-indigo-200",
  SHTM: "bg-pink-100 text-pink-700 border-pink-200",
  ARFIEN: "bg-yellow-100 text-yellow-700 border-yellow-200",
  SSLATE: "bg-teal-100 text-teal-700 border-teal-200",
};

export function getDepartmentInfo(value) {
  const raw = String(value ?? "").toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9]/g, "");

  if (cleaned.includes("student") || cleaned.includes("students")) {
    return { label: "Students", badgeClass: departmentStyles.Students };
  }

  if (cleaned.includes("teacher") || cleaned.includes("teachers")) {
    return { label: "Teachers", badgeClass: departmentStyles.Teachers };
  }

  if (cleaned.includes("personnel") || cleaned.includes("staff") || cleaned.includes("office")) {
    return { label: "Personnel", badgeClass: departmentStyles.Personnel };
  }

  // specific department codes (match even with punctuation/spaces)
  if (cleaned.includes("bsit")) return { label: "BSIT", badgeClass: departmentStyles.BSIT };
  if (cleaned.includes("shtm")) return { label: "SHTM", badgeClass: departmentStyles.SHTM };
  if (cleaned.includes("arfien")) return { label: "ARFIEN", badgeClass: departmentStyles.ARFIEN };
  if (cleaned.includes("sslate")) return { label: "SSLATE", badgeClass: departmentStyles.SSLATE };

  return { label: "General", badgeClass: departmentStyles.General };
}
