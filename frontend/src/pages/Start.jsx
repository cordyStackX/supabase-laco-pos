import React from "react";
import { useNavigate } from "react-router-dom";
import logo from "../assets/LCCB-Logo.jpeg";
import cover from "../assets/cover.jpg";

export default function StartPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex">

      {/* LEFT SIDE - IMAGE WITH BLUE GRADIENT */}
      <div className="w-1/2 h-screen relative">
        <img
          src={cover}
          alt="Cover"
          className="w-full h-full object-cover"
        />

        {/* Blue Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/80 via-blue-700/70 to-blue-500/60"></div>

        {/* Optional Text Over Image */}
        <div className="absolute inset-0 flex items-center justify-center text-white px-10 text-center">
          <div>
            <h2 className="text-4xl font-bold mb-4">
              Welcome to LCCB Bookstore
            </h2>
            <p className="text-lg opacity-90">
              Manage inventory, sales, and reports efficiently.
            </p>
          </div>
        </div>
      </div>

      {/* RIGHT SIDE - LOGIN PANEL */}
      <div className="w-1/2 h-screen flex items-center justify-center bg-gray-50 px-12">
        <div className="w-full max-w-md">

          {/* Logo + Title */}
          <div className="flex items-center gap-4 mb-8">
            <div className="w-14 h-14 rounded-2xl bg-white shadow-lg overflow-hidden">
              <img
                src={logo}
                alt="LCCB Logo"
                className="w-full h-full object-contain"
              />
            </div>

            <h1 className="text-2xl font-bold text-gray-900">
              LCCB Bookstore
            </h1>
          </div>

          {/* Subtitle */}
          <p className="text-gray-500 mb-10">
            Welcome to your bookstore register system.
          </p>

          {/* Buttons */}
          <div className="space-y-5">
            <button
              onClick={() => navigate("/signin")}
              className="w-full py-4 rounded-full 
                bg-gradient-to-r from-blue-600 to-blue-700 
                text-white text-lg font-bold 
                shadow-lg hover:brightness-105 active:scale-[0.98] transition"
            >
              Sign Up
            </button>

            <button
              onClick={() => navigate("/login")}
              className="w-full py-4 rounded-full 
                border border-blue-200 text-blue-600 
                text-lg font-bold bg-white 
                hover:bg-blue-50 active:scale-[0.98] transition"
            >
              Log In
            </button>
          </div>

        </div>
      </div>

    </div>
  );
}
