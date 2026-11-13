"use strict";

const { OperationError } = require("./operations");

/**
 * Wraps an async route handler so a rejected promise becomes a JSON error
 * response instead of an unhandled rejection that hangs the request.
 *
 * OperationError carries an intended HTTP status; anything else is treated as
 * an unexpected fault and reported as a generic 500 without leaking internals.
 */
const handle = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch((error) => {
    if (error instanceof OperationError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    if (error?.name === "MulterError") {
      const message =
        error.code === "LIMIT_FILE_SIZE" ? "Image must be 5 MB or smaller" : "Upload rejected";
      return res.status(400).json({ success: false, message });
    }
    console.error(`${req.method} ${req.originalUrl} failed:`, error);
    return res.status(500).json({ success: false, message: "Server error" });
  });
};

module.exports = { handle, OperationError };
