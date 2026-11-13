"use strict";

const multer = require("multer");
const { RECEIPTS_DIR } = require("../lib/paths");
const { createImageUpload } = require("../lib/objectStorage");

module.exports = createImageUpload({
  multer,
  destination: RECEIPTS_DIR,
  prefix: "receipt-",
});
