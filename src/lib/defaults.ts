import type { Contract, Profile, Settings } from "./types";
import { uid } from "./id";
import { MAIN_JOB_ID } from "./jobs";

/**
 * Estructuras iniciales vacías. No contienen datos del trabajador: todas las cifras
 * salariales empiezan en 0 y todas las reglas de pluses/excesos empiezan desactivadas
 * hasta que el usuario las configure.
 */
export function defaultContract(validFrom: string, jobId: string = MAIN_JOB_ID): Contract {
  const now = Date.now();
  return {
    id: uid(),
    jobId,
    validFrom,
    contractType: "indefinido",
    weeklyMinutes: 0,
    monthlyMinutes: 0,
    fullTime: false,
    fullTimeWeeklyMinutes: 40 * 60,
    distribution: null,
    scheduleType: "variable",
    workDays: [0, 1, 2, 3, 4],
    weeklyRestDays: [5, 6],
    agreement: "",
    category: "",
    payType: "hourly",
    hourlyRateCents: 0,
    monthlyGrossCents: 0,
    annualGrossCents: 0,
    numPayments: 12,
    extraPaysProrated: true,
    extraPayMonths: [6, 12],
    extraPayAmountCents: 0,
    night: { enabled: false, mode: "percent", value: 0, start: "22:00", end: "06:00" },
    holiday: { enabled: false, mode: "percent", value: 0 },
    weekend: { enabled: false, mode: "percent", value: 0, days: [5, 6] },
    stackPremiums: true,
    referencePeriod: "weekly",
    customPeriodDays: 14,
    customPeriodAnchor: validFrom,
    complementary: { enabled: false, payMode: "multiplier", value: 100, maxMinutesPerPeriod: 0 },
    overtime: { enabled: false, payMode: "multiplier", value: 100 },
    unclassifiedPay: "ordinary",
    otherComplements: [],
    deductions: [],
    payPeriodStartDay: 1,
    absencesReduceExpected: true,
    crossMidnightToStartDay: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function defaultProfile(): Profile {
  return {
    id: "main",
    name: "",
    company: "",
    position: "",
    country: "España",
    region: "",
    currency: "EUR",
    startDate: "",
    annualVacationDays: 0,
    vacationCountMode: "working",
    bankStartDate: "",
    bankInitialMinutes: 0,
    updatedAt: Date.now(),
  };
}

export function defaultSettings(): Settings {
  return {
    id: "app",
    onboardingDone: false,
    theme: "system",
    reminders: { enabled: false, shiftMinutesBefore: 60, openClockHours: 12, vacationDaysBefore: 7, weeklyHoursGoal: 0 },
    lastBackupAt: null,
    activeJobId: "all",
    updatedAt: Date.now(),
  };
}
