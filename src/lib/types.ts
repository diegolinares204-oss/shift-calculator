/**
 * Tipos de dominio de SHIFT CALCULATOR.
 *
 * Convenciones:
 *  - Fechas de calendario: "YYYY-MM-DD" (fecha local).
 *  - Fechas y horas de turnos: "YYYY-MM-DDTHH:mm" (hora local de pared).
 *  - Fichajes: marcas de tiempo absolutas en milisegundos (epoch).
 *  - Importes: céntimos enteros (nunca decimales flotantes).
 *  - Duraciones: minutos enteros.
 */

export type ID = string;

/** 0 = lunes ... 6 = domingo */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type ShiftStatus = "planned" | "done" | "cancelled";

export type ShiftKind =
  | "normal"
  | "morning"
  | "afternoon"
  | "night"
  | "split"
  | "weekend"
  | "holiday"
  | "oncall"
  | "training"
  | "other";

export interface BreakInterval {
  /** "YYYY-MM-DDTHH:mm" */
  start: string;
  /** "YYYY-MM-DDTHH:mm" */
  end: string;
  paid: boolean;
}

export interface TimeBlock {
  /** "YYYY-MM-DDTHH:mm" */
  start: string;
  /** "YYYY-MM-DDTHH:mm" */
  end: string;
  breaks: BreakInterval[];
}

/** Un empleo. Cada trabajo tiene sus contratos, turnos, fichajes, nóminas y bolsa de horas. */
export interface Job {
  id: ID;
  name: string;
  company: string;
  position: string;
  /** Color identificativo (paleta fija, por orden) */
  color: string;
  order: number;
  archived: boolean;
  annualVacationDays: number;
  vacationCountMode: "working" | "natural";
  bankStartDate: string;
  bankInitialMinutes: number;
  createdAt: number;
  updatedAt: number;
}

export interface Shift {
  id: ID;
  jobId: ID;
  /** Fecha de inicio previsto (clave de agrupación por día). */
  date: string;
  planned: TimeBlock;
  /** Horario realmente trabajado si difiere del previsto. */
  actual?: TimeBlock | null;
  kind: ShiftKind;
  status: ShiftStatus;
  notes: string;
  tags: string[];
  templateId?: ID | null;
  seriesId?: ID | null;
  /** El usuario confirmó que puede solaparse con otro turno. */
  overlapConfirmed?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ContractType =
  | "indefinido"
  | "temporal"
  | "fijo-discontinuo"
  | "practicas"
  | "formacion"
  | "obra"
  | "autonomo"
  | "otro";

export type PremiumMode = "percent" | "fixed";

export interface PremiumRule {
  enabled: boolean;
  /** percent: % adicional sobre el precio/hora ordinario; fixed: céntimos por hora. */
  mode: PremiumMode;
  /** Para percent: porcentaje (p. ej. 25 = +25 %). Para fixed: céntimos/hora. */
  value: number;
}

export type ExcessPayMode = "multiplier" | "fixed" | "unpaid";

export interface ExcessRule {
  enabled: boolean;
  /** multiplier: % del precio hora ordinario (100 = igual, 175 = +75 %). fixed: céntimos/hora. unpaid: no se paga (se compensa con descanso). */
  payMode: ExcessPayMode;
  value: number;
}

export type ReferencePeriod = "weekly" | "monthly" | "custom";

export interface OtherComplement {
  id: ID;
  name: string;
  type: "monthly_fixed" | "per_hour" | "per_day" | "percent_base";
  /** céntimos para importes; porcentaje para percent_base */
  amount: number;
  enabled: boolean;
}

export interface Deduction {
  id: ID;
  name: string;
  type: "percent" | "fixed";
  /** porcentaje (p. ej. 6.35) o céntimos */
  value: number;
  enabled: boolean;
}

export interface Contract {
  id: ID;
  jobId: ID;
  /** Fecha desde la que aplica (YYYY-MM-DD). */
  validFrom: string;
  contractType: ContractType;
  /** Minutos semanales contratados. */
  weeklyMinutes: number;
  /** Minutos mensuales de referencia (0 = calcular a partir de los semanales). */
  monthlyMinutes: number;
  fullTime: boolean;
  /** Minutos de jornada completa semanal de referencia (para umbral de horas extraordinarias). */
  fullTimeWeeklyMinutes: number;
  /** Distribución por día (lunes..domingo) en minutos; null = sin distribución fija. */
  distribution: number[] | null;
  scheduleType: "fixed" | "variable";
  workDays: Weekday[];
  weeklyRestDays: Weekday[];
  agreement: string;
  category: string;

  // Salario
  payType: "hourly" | "monthly";
  hourlyRateCents: number;
  monthlyGrossCents: number;
  annualGrossCents: number;
  numPayments: number;
  extraPaysProrated: boolean;
  /** Meses (1-12) en que se cobran las pagas extra no prorrateadas. */
  extraPayMonths: number[];
  /** Importe de cada paga extra (0 = igual al salario mensual). */
  extraPayAmountCents: number;

  night: PremiumRule & { start: string; end: string };
  holiday: PremiumRule;
  weekend: PremiumRule & { days: Weekday[] };
  /** Si varios pluses coinciden en el mismo minuto: acumular o aplicar solo el mayor. */
  stackPremiums: boolean;

  referencePeriod: ReferencePeriod;
  /** Para periodo personalizado: duración en días y fecha ancla. */
  customPeriodDays: number;
  customPeriodAnchor: string;
  complementary: ExcessRule & { maxMinutesPerPeriod: number };
  overtime: ExcessRule;
  /** Cómo tratar la diferencia que no se ha clasificado. */
  unclassifiedPay: "ordinary" | "unpaid";

  otherComplements: OtherComplement[];
  deductions: Deduction[];
  /** Día del mes en que empieza el periodo de nómina (1 = mes natural). */
  payPeriodStartDay: number;
  /** Los festivos, vacaciones y ausencias justificadas reducen las horas esperadas. */
  absencesReduceExpected: boolean;
  /**
   * true: las horas de un turno que cruza la medianoche cuentan en el día en que empieza
   * (para totales diarios, semanas, meses y periodo de nómina). false/ausente: cada hora en su día real.
   */
  crossMidnightToStartDay?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Profile {
  id: "main";
  name: string;
  /** Heredado de la versión 2 (antes de admitir varios trabajos); ahora vive en Job */
  company: string;
  /** Heredado de la versión 2; ahora vive en Job */
  position: string;
  country: string;
  region: string;
  currency: string;
  startDate: string;
  annualVacationDays: number;
  vacationCountMode: "working" | "natural";
  bankStartDate: string;
  bankInitialMinutes: number;
  updatedAt: number;
}

export interface ClockSession {
  id: ID;
  jobId: ID;
  startAt: number;
  endAt: number | null;
  notes: string;
  source: "live" | "manual";
  /** Turno vinculado (creado o actualizado al cerrar el fichaje). */
  shiftId?: ID | null;
  createdAt: number;
  updatedAt: number;
}

export interface ClockBreak {
  id: ID;
  sessionId: ID;
  startAt: number;
  endAt: number | null;
}

export interface AuditEntry {
  id: ID;
  at: number;
  entity: "clockSession" | "clockBreak" | "shift";
  entityId: ID;
  action: "create" | "update" | "delete";
  summary: string;
  reason: string;
}

export type AbsenceType = "vacation" | "dayoff" | "permit" | "absence" | "sick";
export type AbsenceStatus = "requested" | "approved" | "taken" | "rejected";

export interface Absence {
  id: ID;
  /** null = afecta a todos los trabajos */
  jobId: ID | null;
  type: AbsenceType;
  startDate: string;
  endDate: string;
  status: AbsenceStatus;
  justified: boolean;
  paid: boolean;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export type HolidayScope = "national" | "regional" | "local";

export interface Holiday {
  id: ID;
  date: string;
  name: string;
  scope: HolidayScope;
}

export interface Payslip {
  id: ID;
  jobId: ID;
  /** "YYYY-MM" */
  period: string;
  grossCents: number;
  netCents: number | null;
  concepts: { name: string; amountCents: number }[];
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface ShiftSpec {
  /** "HH:mm" */
  start: string;
  /** "HH:mm" */
  end: string;
  breaks: { start: string; end: string; paid: boolean }[];
  kind: ShiftKind;
  tags: string[];
}

export interface Template {
  id: ID;
  name: string;
  kind: "shift" | "week";
  shift?: ShiftSpec;
  /** 7 posiciones (lunes..domingo), cada una con 0..n turnos */
  week?: ShiftSpec[][];
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface HourAdjustment {
  id: ID;
  jobId: ID;
  date: string;
  minutes: number;
  reason: string;
  createdAt: number;
}

export interface Settings {
  id: "app";
  onboardingDone: boolean;
  theme: "system" | "light" | "dark";
  reminders: {
    enabled: boolean;
    shiftMinutesBefore: number;
    openClockHours: number;
    vacationDaysBefore: number;
    weeklyHoursGoal: number;
  };
  lastBackupAt: number | null;
  /** Trabajo seleccionado en la interfaz ("all" = todos) */
  activeJobId: string;
  updatedAt: number;
}
