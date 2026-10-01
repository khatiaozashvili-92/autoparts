import { describe, expect, it } from 'vitest'
import { difference, expectedCash, type CalcInput } from './calc'

const base: CalcInput = {
  previousCash: 100,
  turnover: 1000,
  tbc: 300,
  bog: 200,
  keepz: 50,
  receiptsTotal: 120.5,
  unreceiptedExpense: 20,
  salariesTotal: 150,
  cashOutTotal: 30,
  cashInTotal: 10,
  actualCash: null,
}

describe('cash calculation', () => {
  it('follows the agreed formula', () => {
    // 100+1000-300-200-50-120.5-20-150-30+10 = 239.5
    expect(expectedCash(base)).toBe(239.5)
  })
  it('has no difference until actual cash is entered', () => {
    expect(difference(base)).toBeNull()
  })
  it('negative when short, positive when over, zero when exact', () => {
    expect(difference({ ...base, actualCash: 230 })).toBe(-9.5)
    expect(difference({ ...base, actualCash: 240 })).toBe(0.5)
    expect(difference({ ...base, actualCash: 239.5 })).toBe(0)
  })
  it('avoids float noise', () => {
    expect(expectedCash({ ...base, previousCash: 0.1, turnover: 0.2, tbc: 0, bog: 0, keepz: 0, receiptsTotal: 0, unreceiptedExpense: 0, salariesTotal: 0, cashOutTotal: 0, cashInTotal: 0 })).toBe(0.3)
  })
})
