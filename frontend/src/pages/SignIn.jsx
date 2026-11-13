import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import logo from "../assets/LCCB-Logo.jpeg";
import cover from "../assets/gg.jpg";
import { api } from "../lib/api";
import {
  UserIcon,
  LockIcon,
  ShoppingBagIcon,
  ChartIcon,
  PackageIcon,
} from "../components/Icons";

const fieldClass =
  "w-full h-11 pl-10 text-sm rounded-xl border border-gray-300 bg-white " +
  "focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition " +
  "m-0 box-border";

export default function SignUp() {
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const flashError = (message) => {
    setError(message);
    setTimeout(() => setError(""), 4000);
  };

  const handleSignUp = async (e) => {
    e.preventDefault();

    if (!username || !password || !confirmPassword) {
      flashError("Please fill in all fields.");
      return;
    }

    if (password.length < 8) {
      flashError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      flashError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      // Bootstrap only: the server rejects this once any admin exists, and
      // always creates an admin. Additional staff accounts are created by a
      // signed-in admin from Manage Staff.
      const data = await api.post("/register", { username, password });

      if (data.success) {
        setSuccess("Administrator account created successfully!");
        setTimeout(() => navigate("/login"), 1200);
      } else {
        flashError(data.message || "Registration failed.");
      }
    } catch (err) {
      flashError(err.message || "Server error. Try again later.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-screen h-screen flex bg-slate-50 overflow-hidden">
      {/* LEFT SIDE BRANDING */}
      <div className="hidden lg:flex w-1/2 relative">
        <img
          src={cover}
          alt="Signup Cover"
          className="absolute inset-0 w-full h-full object-cover"
        />

        <div className="absolute inset-0 bg-gradient-to-br from-blue-950/90 via-blue-800/80 to-blue-500/70"></div>

        <div className="relative z-10 flex flex-col justify-center px-14 text-white">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-14 h-14 rounded-2xl overflow-hidden bg-white shadow-lg ring-4 ring-white/20">
              <img
                src={logo}
                alt="LCCB Logo"
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">LCCB Bookstore</h1>
              <p className="text-sm text-blue-100/80">Point of Sale System</p>
            </div>
          </div>

          <h2 className="text-4xl font-bold mb-4 leading-tight">
            Create Your Account
          </h2>
          <p className="text-lg text-blue-100/90 mb-10 max-w-md">
            Set up the initial administrator account. An administrator can add sub-admins later.
          </p>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
                <ShoppingBagIcon className="w-5 h-5" />
              </div>
              <span className="text-sm text-blue-50/90">Track sales and transactions</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
                <PackageIcon className="w-5 h-5" />
              </div>
              <span className="text-sm text-blue-50/90">Manage inventory and stock</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
                <ChartIcon className="w-5 h-5" />
              </div>
              <span className="text-sm text-blue-50/90">View analytics and reports</span>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT SIDE FORM */}
      <div className="w-full lg:w-1/2 h-full overflow-y-auto flex items-center justify-center px-4 sm:px-8">
        <div className="w-full max-w-md py-10">
          {/* Header */}
          <div className="flex items-center gap-3 mb-8">
            <div className="lg:hidden w-11 h-11 rounded-xl overflow-hidden shadow-lg bg-white border border-gray-100">
              <img
                src={logo}
                alt="LCCB Logo"
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                Sign Up
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Create the initial administrator account
              </p>
            </div>
          </div>

          {/* Notification Banners */}
          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
              {error}
            </div>
          )}
          {success && (
            <div className="mb-5 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
              {success}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSignUp} className="space-y-5">
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs leading-relaxed">
              First-run setup only. This form creates the initial administrator
              account and stops working once one exists. To add staff later, sign
              in as an administrator and use <strong>Manage Staff</strong>.
            </div>

            <div>
              <label className="block mb-1.5 text-sm font-medium text-gray-700">
                Username
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  className={`${fieldClass} pr-3`}
                />
              </div>
            </div>

            <div>
              <label className="block mb-1.5 text-sm font-medium text-gray-700">
                Password
              </label>
              <div className="relative">
                <LockIcon className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className={`${fieldClass} pr-16`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="m-0 absolute right-2 top-1/2 -translate-y-1/2 px-2 h-7 flex items-center justify-center text-blue-600 hover:text-blue-800 text-xs font-semibold"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <div>
              <label className="block mb-1.5 text-sm font-medium text-gray-700">
                Confirm Password
              </label>
              <div className="relative">
                <LockIcon className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className={`${fieldClass} pr-16`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="m-0 absolute right-2 top-1/2 -translate-y-1/2 px-2 h-7 flex items-center justify-center text-blue-600 hover:text-blue-800 text-xs font-semibold"
                >
                  {showConfirmPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="m-0 w-full h-11 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white text-sm font-semibold shadow-lg shadow-blue-600/25 hover:brightness-105 active:scale-[0.99] transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? "Creating..." : "Create Administrator"}
            </button>
          </form>

          {/* Links */}
          <div className="mt-6 flex flex-col gap-1.5 text-sm">
            <button
              onClick={() => navigate("/")}
              className="text-blue-600 hover:underline text-left w-max"
            >
              ← Back to Home
            </button>

            <button
              onClick={() => navigate("/login")}
              className="text-emerald-600 hover:underline text-left w-max"
            >
              Already have an account? Log in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
