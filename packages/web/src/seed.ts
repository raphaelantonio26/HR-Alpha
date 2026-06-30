/**
 * Synthetic seed data — for the empty-state demo only. Every value is clearly
 * fake (Sample / .example), so no real person is ever depicted in the UI (§2
 * invariant 3). Worksites mirror AMPAM's offices (config, not entities).
 */
import type { PayBand, Worker } from "@hr-os/contracts";

export const WORKSITES = [
  { id: "carson", name: "Carson HQ", region: "LA County" },
  { id: "jurupa", name: "Jurupa Valley", region: "Inland Empire" },
  { id: "elcajon", name: "El Cajon", region: "San Diego County" },
  { id: "poway", name: "Poway", region: "San Diego County" },
  { id: "fremont", name: "Fremont", region: "Bay Area" },
];

export const SAMPLE_WORKERS: Array<Worker & { title: string; pay: number }> = [
  { id: "w1", tenantId: "AMPAM", fileNumber: "0001", firstName: "Sample", lastName: "Rivera", status: "active", worksiteId: "carson", positionId: "p1", managerId: null, employmentType: "open_shop", hireDate: "2021-03-01", hoursPerWeek: 40, title: "Journeyman Electrician", pay: 47 },
  { id: "w2", tenantId: "AMPAM", fileNumber: "0002", firstName: "Sample", lastName: "Nguyen", status: "active", worksiteId: "jurupa", positionId: "p2", managerId: "w1", employmentType: "open_shop", hireDate: "2022-07-15", hoursPerWeek: 40, title: "Fire Sprinkler Fitter", pay: 41 },
  { id: "w3", tenantId: "AMPAM", fileNumber: "0003", firstName: "Sample", lastName: "Okafor", status: "leave", worksiteId: "elcajon", positionId: "p3", managerId: "w1", employmentType: "open_shop", hireDate: "2020-01-20", hoursPerWeek: 40, title: "Low Voltage Technician", pay: 36 },
  { id: "w4", tenantId: "AMPAM", fileNumber: "0004", firstName: "Sample", lastName: "Castillo", status: "active", worksiteId: "poway", positionId: "p4", managerId: "w1", employmentType: "open_shop", hireDate: "2019-11-05", hoursPerWeek: 40, title: "HVAC Service Mechanic", pay: 44 },
];

/** Sample composite band (annual) for the comp demo. */
export const SAMPLE_BAND: PayBand = { unit: "hourly", p10: 32, p25: 36, p50: 42, p75: 50, p90: 58, confidence: 72, locked: false };
