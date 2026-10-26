// Row shapes, matching the columns verified in Supabase on 2026-10-26.
// Columns that are nullable in the database are typed `| null`.

export interface Product {
  sku: string
  product_name: string
  category: string | null
  unit_cost: number | null
}

export interface Supplier {
  supplier_id: string
  supplier_name: string
  standard_lead_days: number | null
}

export interface PurchaseOrder {
  po_id: string
  supplier_id: string | null
  sku: string | null
  warehouse_id: string | null
  order_qty: number | null
  order_date: string | null // YYYY-MM-DD
  expected_date: string | null // YYYY-MM-DD
  status: string | null
}

export interface GoodsReceipt {
  receipt_id: string
  po_id: string | null
  sku: string | null
  warehouse_id: string | null
  received_qty: number | null
  receipt_date: string | null // YYYY-MM-DD
}

export interface SalesOrder {
  sales_order_id: string
  sku: string | null
  warehouse_id: string | null
  order_qty: number | null
  shipped_qty: number | null
  order_date: string | null
  status: string | null
}

export interface InventorySnapshot {
  snapshot_id: string
  sku: string | null
  warehouse_id: string | null
  snapshot_qty: number | null
  reserved_qty: number | null
  snapshot_at: string | null // timestamp without time zone, e.g. 2026-10-23T08:00:00
}

/** A row of reporting.vw_inventory_reconciliation. */
export interface ReconciliationRow {
  snapshot_id: string
  sku: string
  product_name: string
  warehouse_id: string | null
  snapshot_qty: number | null
  reserved_qty: number | null
  snapshot_at: string | null
  receipt_after_snapshot: number
  adjusted_on_hand: number | null
  adjusted_available: number | null
}

export interface NewPurchaseOrder {
  supplier_id: string
  sku: string
  warehouse_id: string
  order_qty: number
  expected_date: string
}

export interface NewGoodsReceipt {
  po_id: string
  received_qty: number
  receipt_date: string
}
