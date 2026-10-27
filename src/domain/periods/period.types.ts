export type Period = '1M' | '3M' | '6M' | '9M' | '1Y';

export interface PeriodRange {
  from: Date;
  to: Date;
}
