import { db } from '../lib/supabaseClient'
import type { Supplier } from '../lib/types'
import { toDataError } from './errors'

export async function listSuppliers(): Promise<Supplier[]> {
  const { data, error } = await db().from('suppliers').select('supplier_id, supplier_name, standard_lead_days').order('supplier_id')
  if (error) throw toDataError(error, 'Loading suppliers')
  return data ?? []
}
