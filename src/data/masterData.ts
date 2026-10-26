// Creating master data (products, suppliers). Reads live in products.ts / suppliers.ts.
import { db } from '../lib/supabaseClient'
import type { Product, Supplier } from '../lib/types'
import { toDataError } from './errors'

export async function createProduct(input: { sku: string; product_name: string; category: string; unit_cost: number | null }): Promise<Product> {
  const { data, error } = await db().rpc('create_product', {
    p_sku: input.sku,
    p_product_name: input.product_name,
    p_category: input.category,
    p_unit_cost: input.unit_cost,
  })
  if (error) throw toDataError(error, 'Creating the product')
  return data as Product
}

export async function createSupplier(input: { supplier_name: string; standard_lead_days: number | null }): Promise<Supplier> {
  const { data, error } = await db().rpc('create_supplier', {
    p_supplier_name: input.supplier_name,
    p_standard_lead_days: input.standard_lead_days,
  })
  if (error) throw toDataError(error, 'Creating the supplier')
  return data as Supplier
}
