// Loads every table the app needs once (the data set is small) and shares it
// with all pages. reload() re-reads everything after a successful write.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { summarizePurchaseOrders, todayISO, type PoSummary } from '../lib/logic'
import type { GoodsReceipt, InventorySnapshot, Product, PurchaseOrder, ReconciliationRow, SalesOrder, Supplier } from '../lib/types'
import { listGoodsReceipts } from './goodsReceipts'
import { listProducts } from './products'
import { listPurchaseOrders } from './purchaseOrders'
import { listInventoryReconciliation, listInventorySnapshots } from './reporting'
import { listSalesOrders } from './salesOrders'
import { listSuppliers } from './suppliers'

export interface ErpData {
  suppliers: Supplier[]
  products: Product[]
  purchaseOrders: PurchaseOrder[]
  receipts: GoodsReceipt[]
  salesOrders: SalesOrder[]
  snapshots: InventorySnapshot[]
  reconciliation: ReconciliationRow[]
  poSummaries: PoSummary[]
  warehouses: string[]
  today: string
}

interface ErpDataState {
  data: ErpData | null
  loading: boolean
  error: string | null
  loadedAt: Date | null
  reload: () => Promise<void>
}

const Ctx = createContext<ErpDataState | null>(null)

export function ErpDataProvider({ children }: { children: ReactNode }) {
  const [raw, setRaw] = useState<Omit<ErpData, 'poSummaries' | 'warehouses' | 'today'> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [suppliers, products, purchaseOrders, receipts, salesOrders, snapshots, reconciliation] = await Promise.all([
        listSuppliers(),
        listProducts(),
        listPurchaseOrders(),
        listGoodsReceipts(),
        listSalesOrders(),
        listInventorySnapshots(),
        listInventoryReconciliation(),
      ])
      setRaw({ suppliers, products, purchaseOrders, receipts, salesOrders, snapshots, reconciliation })
      setLoadedAt(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const data = useMemo<ErpData | null>(() => {
    if (!raw) return null
    const today = todayISO()
    const warehouses = [
      ...new Set([...raw.purchaseOrders, ...raw.salesOrders, ...raw.snapshots, ...raw.receipts].map((r) => r.warehouse_id).filter((w): w is string => !!w)),
    ].sort()
    return { ...raw, today, warehouses, poSummaries: summarizePurchaseOrders(raw.purchaseOrders, raw.receipts, today) }
  }, [raw])

  return <Ctx.Provider value={{ data, loading, error, loadedAt, reload }}>{children}</Ctx.Provider>
}

export function useErpData(): ErpDataState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useErpData must be used inside ErpDataProvider')
  return v
}
