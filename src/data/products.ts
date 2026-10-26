import { db } from '../lib/supabaseClient'
import type { Product } from '../lib/types'
import { toDataError } from './errors'

export async function listProducts(): Promise<Product[]> {
  const { data, error } = await db().from('products').select('sku, product_name, category, unit_cost').order('sku')
  if (error) throw toDataError(error, 'Loading products')
  return data ?? []
}
