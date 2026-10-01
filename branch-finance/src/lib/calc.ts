export interface CalcInput {
  previousCash: number // წინა დღის "მაქვს" (ან საწყისი ნაშთი)
  turnover: number
  tbc: number
  bog: number
  keepz: number
  receiptsTotal: number
  unreceiptedExpense: number
  salariesTotal: number
  cashOutTotal: number
  cashInTotal: number
  actualCash: number | null
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function expectedCash(i: CalcInput): number {
  return round2(
    i.previousCash +
      i.turnover -
      i.tbc -
      i.bog -
      i.keepz -
      i.receiptsTotal -
      i.unreceiptedExpense -
      i.salariesTotal -
      i.cashOutTotal +
      i.cashInTotal,
  )
}

/** შედეგი = რეალურად მაქვს − უნდა მქონდეს. მინუსი = ნაკლებობა, პლიუსი = ჭარბობა. */
export function difference(i: CalcInput): number | null {
  if (i.actualCash === null) return null
  return round2(i.actualCash - expectedCash(i))
}
