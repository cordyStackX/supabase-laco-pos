import React, { useEffect, useState } from "react";
import Layout from "./Layout";
import { api } from "../lib/api";

export default function ManageStaff() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role] = useState("sub");
  const [canViewInventoryLogs, setCanViewInventoryLogs] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");

  const loadStaff = async () => {
    setLoading(true);
    setError("");

    try {
      const data = await api.get("/admin/staff");
      setStaff(data.staff || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStaff();
  }, []);

  const createStaff = async (event) => {
    event.preventDefault();
    setFormError("");
    setFormSuccess("");
    setCreating(true);

    try {
      const data = await api.post("/admin/staff", {
        username: username.trim(),
        password,
        role: "sub",
        canViewInventoryLogs,
      });
      setStaff((current) => [...current, data.staff].sort((a, b) => a.username.localeCompare(b.username)));
      setUsername("");
      setPassword("");
      setCanViewInventoryLogs(false);
      setFormSuccess(data.message || "Account created");
    } catch (err) {
      setFormError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const toggleAccess = async (id, allow) => {
    try {
      await api.put(`/admin/staff/${id}/access`, { allow });

      setStaff((prev) =>
        prev.map((member) =>
          member.id === id
            ? { ...member, canViewInventoryLogs: allow }
            : member
        )
      );
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-screen bg-gray-100 flex items-center justify-center">
        <p className="text-gray-600">Loading staff members...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen w-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-6 shadow-lg text-center">
          <p className="text-red-600 font-semibold">{error}</p>
          <button
            onClick={loadStaff}
            className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <Layout title="Manage Staff">
      <main className="flex-1 overflow-y-auto p-6">
        <div className="bg-white rounded-3xl shadow-lg border border-gray-200 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-xl font-semibold">Staff Members</h2>
              <p className="text-sm text-gray-500">
                Only sub-admin accounts can be created here.
              </p>
            </div>
          </div>

          <form onSubmit={createStaff} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 border-b border-gray-200 pb-6 mb-6">
            <div>
              <label htmlFor="staff-username" className="block mb-1.5 text-sm font-medium text-gray-700">Username</label>
              <input
                id="staff-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="off"
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                placeholder="Enter username"
              />
            </div>
            <div>
              <label htmlFor="staff-password" className="block mb-1.5 text-sm font-medium text-gray-700">Password</label>
              <input
                id="staff-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                placeholder="At least 8 characters"
              />
            </div>
            <div className="flex items-end">
              <div className="w-full rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700">
                Sub-admin account
              </div>
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={creating}
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {creating ? "Creating..." : "Create Account"}
              </button>
            </div>
            <label className="sm:col-span-2 lg:col-span-4 flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={canViewInventoryLogs}
                onChange={(event) => setCanViewInventoryLogs(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Allow this sub-admin to view Inventory Logs
            </label>
            {(formError || formSuccess) && (
              <p role="status" className={`sm:col-span-2 lg:col-span-4 text-sm ${formError ? "text-red-600" : "text-emerald-700"}`}>
                {formError || formSuccess}
              </p>
            )}
          </form>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Username
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Inventory Log Access
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {staff.map((member) => (
                  <tr key={member.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {member.username}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {member.role === "sub" ? "Sub-admin" : "Admin"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {member.canViewInventoryLogs ? (
                        <span className="inline-flex rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
                          Allowed
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-800">
                          Denied
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => toggleAccess(member.id, !member.canViewInventoryLogs)}
                        className="inline-flex items-center rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                      >
                        {member.canViewInventoryLogs ? "Revoke" : "Grant"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </Layout>
  );
}
