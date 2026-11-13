"use strict";

async function up(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS receipt_counters (
      name VARCHAR(32) NOT NULL PRIMARY KEY,
      value BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await pool.query("INSERT IGNORE INTO receipt_counters (name, value) VALUES ('pos', 1000)");

  const [[row]] = await pool.query(`
    SELECT MAX(receipt_id) AS max_receipt FROM (
      SELECT receipt_id FROM sales WHERE receipt_id IS NOT NULL
      UNION ALL
      SELECT CAST(receipt_id AS UNSIGNED) AS receipt_id FROM sales_items WHERE receipt_id IS NOT NULL
      UNION ALL
      SELECT receipt_id FROM inventory_logs WHERE receipt_id IS NOT NULL
    ) existing_receipts
  `);
  const highWaterMark = Math.max(1000, Number(row?.max_receipt) || 1000);

  await pool.query(
    "UPDATE receipt_counters SET value = GREATEST(value, ?) WHERE name = 'pos'",
    [highWaterMark]
  );
}

module.exports = { up };