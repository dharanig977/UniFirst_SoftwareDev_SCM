import { describe, expect, it } from 'vitest'
import { parseRequest } from './parser.ts'

const C = [
  ['ACC-1001', 'Bluegrass Metal Works', 'KY-DC-01'], ['ACC-1002', 'Derby City Foods', 'KY-DC-01'], ['ACC-1004', 'Lexington Health Partners', 'KY-DC-01'],
  ['ACC-1005', 'Ohio River Logistics', 'KY-DC-01'], ['ACC-1006', 'Buckeye Steel Fabricators', 'OH-DC-01'], ['ACC-1007', 'Lake Erie Seafood Co', 'OH-DC-01'],
  ['ACC-1008', 'Queen City Hospitality', 'OH-DC-01'], ['ACC-1011', 'Music City Builders', 'TN-DC-01'],
].map(([account_id, account_name, home_warehouse_id]) => ({ account_id, account_name, home_warehouse_id }))
const P = [
  ['FAC-3002', 'Hand Soap Refill'], ['PPE-2001', 'Safety Gloves'], ['PPE-2002', 'Safety Glasses'], ['PPE-2003', 'Hard Hat'],
  ['PPE-2004', 'Ear Plugs (box of 200)'], ['PPE-2005', 'Nitrile Gloves (box of 100)'], ['UFS-1001', 'Industrial Work Shirt'],
  ['UFS-1003', 'Flame-Resistant Coverall'], ['UFS-1004', 'High-Visibility Vest'], ['UFS-1005', 'Chef Coat'], ['UFS-1006', 'Insulated Work Jacket'],
].map(([sku, product_name]) => ({ sku, product_name }))
const run = (t: string) => {
  const r = parseRequest(t, C, P)
  return { customer: r.customer?.account_id ?? null, wh: r.warehouse_id, lines: r.lines.map((l) => [l.sku, l.qty]), questions: r.questions }
}

describe('sales order agent parser', () => {
  it('reads customer, qty, product and state', () => {
    expect(run('Bluegrass Metal Works needs 40 Flame-Resistant Coveralls from Kentucky')).toEqual({ customer: 'ACC-1001', wh: 'KY-DC-01', lines: [['UFS-1003', 40]], questions: [] })
  })
  it('uses the home warehouse when none is given', () => {
    expect(run('Derby City Foods wants 10 Chef Coats')).toMatchObject({ customer: 'ACC-1002', wh: null, lines: [['UFS-1005', 10]] })
  })
  it('reads several lines and ignores numbers in product names', () => {
    expect(run('Queen City Hospitality: 12 chef coats, 30 hand soap refills and 5 boxes of ear plugs').lines).toEqual([['UFS-1005', 12], ['FAC-3002', 30], ['PPE-2004', 5]])
  })
  it('does not treat a city in the customer name as the warehouse', () => {
    expect(run('Ohio River Logistics wants 6 jackets')).toMatchObject({ customer: 'ACC-1005', wh: null, lines: [['UFS-1006', 6]] })
  })
  it('accepts account ids, SKUs and warehouse codes', () => {
    expect(run('ACC-1007 wants 20 PPE-2002 from TN-DC-01')).toMatchObject({ customer: 'ACC-1007', wh: 'TN-DC-01', lines: [['PPE-2002', 20]] })
  })
  it('asks back when the quantity or customer is missing or ambiguous', () => {
    expect(run('Music City Builders needs hard hats').questions[0]).toMatch(/How many Hard Hat/)
    expect(run('Need 10 vests').questions[0]).toMatch(/Which customer/)
    expect(run('City customer 10 shirts').questions[0]).toMatch(/Which customer did you mean/)
  })
})
