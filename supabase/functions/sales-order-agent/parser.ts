// Free, rule-based request parser for the sales order agent (no paid API).
// Reads requests like "Derby City Foods wants 10 Chef Coats and 5 hard hats from Kentucky"
// and matches them against the real customer and product lists.

export interface Customer { account_id: string; account_name: string; home_warehouse_id: string | null }
export interface Product { sku: string; product_name: string }
export interface ParsedLine { sku: string; product_name: string; qty: number }
export interface ParsedRequest {
  customer: Customer | null
  warehouse_id: string | null
  lines: ParsedLine[]
  questions: string[]
}

// Words that say little about which customer or product is meant.
const GENERIC = new Set([
  'a', 'an', 'the', 'of', 'for', 'to', 'from', 'and', 'with', 'in', 'at', 'on', 'by', 'please', 'need', 'needs', 'want', 'wants',
  'order', 'raise', 'create', 'new', 'unit', 'units', 'pc', 'pcs', 'piece', 'pieces', 'box', 'boxes', 'case', 'cases', 'pack', 'packs',
  'co', 'inc', 'llc', 'company', 'services', 'service', 'partners', 'group', 'work', 'works', 'safety', 'warehouse', 'dc',
])

const WAREHOUSE_WORDS: [RegExp, string][] = [
  [/\b(kentucky|ky|louisville|lexington|bowling green|covington)\b/, 'KY-DC-01'],
  [/\b(ohio|columbus|cleveland|cincinnati|toledo|dayton)\b/, 'OH-DC-01'],
  [/\b(tennessee|tn|nashville|memphis|knoxville|chattanooga|gatlinburg)\b/, 'TN-DC-01'],
]

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, dozen: 12,
}

const stem = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
const words = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z0-9]+/).filter(Boolean)
const keyWords = (s: string) => words(s).filter((w) => !GENERIC.has(w) && !/^\d+$/.test(w)).map(stem)

function bestUnique<T>(items: T[], score: (t: T) => number): { best: T | null; tied: T[] } {
  let top = 0
  let winners: T[] = []
  for (const it of items) {
    const s = score(it)
    if (s > top) { top = s; winners = [it] } else if (s === top && s > 0) winners.push(it)
  }
  return winners.length === 1 ? { best: winners[0], tied: [] } : { best: null, tied: winners }
}

export function parseRequest(text: string, customers: Customer[], products: Product[]): ParsedRequest {
  const questions: string[] = []
  const lower = ` ${text.toLowerCase()} `

  // Customer: account id, or the customer whose distinctive name words appear most.
  const textStems = new Set(words(text).map(stem))
  let customer: Customer | null = customers.find((c) => lower.includes(c.account_id.toLowerCase())) ?? null
  const customerStems = new Set<string>()
  if (!customer) {
    const { best, tied } = bestUnique(customers, (c) => keyWords(c.account_name).filter((w) => textStems.has(w)).length)
    customer = best
    if (!best && tied.length) questions.push(`Which customer did you mean: ${tied.map((c) => c.account_name).join(', ')}?`)
    else if (!best) questions.push('Which customer is this order for?')
  }
  if (customer) keyWords(customer.account_name).forEach((w) => customerStems.add(w))

  // Warehouse: explicit code, or a state / city name. Empty = customer's home warehouse.
  const code = lower.match(/\b(ky|oh|tn)-dc-0\d\b/)
  let warehouse_id: string | null = code ? code[0].toUpperCase() : null
  if (!warehouse_id) {
    // Ignore words that are part of the customer's name (e.g. "Lexington Health Partners").
    let rest = lower
    if (customer) rest = rest.replace(customer.account_name.toLowerCase(), ' ')
    warehouse_id = WAREHOUSE_WORDS.find(([re]) => re.test(rest))?.[1] ?? null
  }

  // Product lines: split on "and", commas, semicolons, "plus", "&", new lines.
  const segments = text.split(/,|;|\n|&|\band\b|\bplus\b|\balso\b/i).map((s) => s.trim()).filter(Boolean)
  const lines: ParsedLine[] = []
  for (const seg of segments) {
    const segLower = seg.toLowerCase()
    const segStems = words(seg).map(stem).filter((w) => !customerStems.has(w))
    const segSet = new Set(segStems)
    let product: Product | null = products.find((p) => new RegExp(`\\b${p.sku.toLowerCase()}\\b`).test(segLower)) ?? null
    if (!product) {
      const { best, tied } = bestUnique(products, (p) => {
        const kw = keyWords(p.product_name)
        const hits = kw.filter((w) => segSet.has(w)).length
        return hits ? hits * 10 + Math.round((hits / kw.length) * 9) : 0
      })
      product = best
      if (!best && tied.length) {
        questions.push(`"${seg}" could be ${tied.map((p) => `${p.product_name} (${p.sku})`).join(' or ')}. Which one?`)
        continue
      }
    }
    if (!product) continue // e.g. the customer part of the sentence

    // Quantity: a number in this segment that is not part of the product name or SKU.
    const nameNumbers = new Set((product.product_name + ' ' + product.sku).match(/\d+/g) ?? [])
    const cleaned = segLower.replace(new RegExp(`\\b${product.sku.toLowerCase()}\\b`, 'g'), ' ').replace(/\b(ky|oh|tn)-dc-0\d\b/g, ' ').replace(/\bacc-\d+\b/g, ' ')
    const nums = (cleaned.match(/\b\d{1,7}\b/g) ?? []).filter((n) => !nameNumbers.has(n)).map(Number)
    let qty = nums[0]
    if (qty === undefined) {
      const w = words(segLower).find((x) => x in NUMBER_WORDS)
      if (w) qty = NUMBER_WORDS[w]
    }
    if (!qty || qty <= 0) {
      questions.push(`How many ${product.product_name} (${product.sku})?`)
      continue
    }
    const existing = lines.find((l) => l.sku === product!.sku)
    if (existing) existing.qty += qty
    else lines.push({ sku: product.sku, product_name: product.product_name, qty })
  }
  if (!lines.length && !questions.some((q) => q.includes('could be') || q.startsWith('How many'))) {
    questions.push('Which product and how many? For example: "10 Chef Coats".')
  }
  return { customer, warehouse_id, lines, questions }
}
