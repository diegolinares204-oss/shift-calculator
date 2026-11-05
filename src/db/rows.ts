import type { Contract, Deduction, OtherComplement } from "@/lib/types";

/** Contrato tal como se guarda (los complementos van en su propia tabla). */
export type ContractRow = Omit<Contract, "otherComplements" | "deductions">;

export type ComplementRow =
  | (OtherComplement & { contractId: string; kind: "earning" })
  | (Deduction & { contractId: string; kind: "deduction" });

export function splitContract(c: Contract): { row: ContractRow; complements: ComplementRow[] } {
  const { otherComplements, deductions, ...row } = c;
  return {
    row,
    complements: [
      ...otherComplements.map((x) => ({ ...x, contractId: c.id, kind: "earning" as const })),
      ...deductions.map((x) => ({ ...x, contractId: c.id, kind: "deduction" as const })),
    ],
  };
}

export function joinContract(row: ContractRow, complements: ComplementRow[]): Contract {
  const mine = complements.filter((x) => x.contractId === row.id);
  const strip = <T extends { contractId: string; kind: string }>(x: T) => {
    const { contractId, kind, ...rest } = x;
    void contractId; void kind;
    return rest;
  };
  return {
    ...row,
    otherComplements: mine.filter((x): x is Extract<ComplementRow, { kind: "earning" }> => x.kind === "earning").map(strip) as OtherComplement[],
    deductions: mine.filter((x): x is Extract<ComplementRow, { kind: "deduction" }> => x.kind === "deduction").map(strip) as Deduction[],
  };
}
