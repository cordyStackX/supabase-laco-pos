"use strict";

/**
 * Backfills inventory_logs from historical sales and restocks.
 *
 * This ran on every server boot before; moving it here means it happens once,
 * inside a migration, and stops competing with live requests for table locks.
 *
 * Guarded by a `WHERE NOT EXISTS` check rather than INSERT IGNORE, because
 * inventory_logs has no unique key to deduplicate against.
 */

async function up(pool) {
  const [salesBackfill] = await pool.query(`
    INSERT INTO inventory_logs (product_id, product_name, type, quantity, reason, staff, created_at)
    SELECT si.product_id, si.product_name, 'OUT', si.quantity, 'Sale', 'System', si.created_at
    FROM sales_items si
    WHERE si.product_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM inventory_logs il
        WHERE il.product_id = si.product_id
          AND il.type = 'OUT'
          AND il.quantity = si.quantity
          AND il.receipt_id <=> si.receipt_id
      )
  `);
  console.log(`   ${salesBackfill.affectedRows} sale entr(ies) backfilled`);

  const [restockBackfill] = await pool.query(`
    INSERT INTO inventory_logs (product_id, product_name, type, quantity, reason, staff, created_at)
    SELECT r.product_id, COALESCE(p.name, 'Unknown'), 'IN', r.quantity_added,
           COALESCE(NULLIF(r.reason, ''), 'Restock'), 'Admin', r.created_at
    FROM restocks r
    LEFT JOIN products p ON p.id = r.product_id
    WHERE NOT EXISTS (
      SELECT 1 FROM inventory_logs il
      WHERE il.product_id = r.product_id
        AND il.type = 'IN'
        AND il.quantity = r.quantity_added
    )
  `);
  console.log(`   ${restockBackfill.affectedRows} restock entr(ies) backfilled`);

  // The old schema could leave a stale unique index behind that blocks
  // duplicate ledger rows. Best effort: it is absent on a fresh install.
  await pool.query("ALTER TABLE inventory_logs DROP INDEX unique_log").catch(() => {});
}

module.exports = { up };
