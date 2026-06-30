import { describe, it, expect } from "vitest";
import { normalizeTitleKey, inferTrade, generateJD, type JdSectionKey } from "./generate.js";

describe("normalizeTitleKey", () => {
  it.each([
    ["Fire Sprinkler Fitter", "fire-sprinkler-fitter"],
    ["  Journeyman   Electrician ", "journeyman-electrician"],
    ["HVAC/Mechanic (Service)", "hvac-mechanic-service"],
    ["Project Manager - MEP", "project-manager-mep"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeTitleKey(input)).toBe(expected);
  });
  it("is stable (idempotent on its own output)", () => {
    const k = normalizeTitleKey("Low Voltage Technician");
    expect(normalizeTitleKey(k.replace(/-/g, " "))).toBe(k);
  });
});

describe("inferTrade picks the most specific trade", () => {
  it.each([
    ["Fire Sprinkler Fitter", "fire_sprinkler"],
    ["Fire Alarm Technician", "fire_alarm"],
    ["Low Voltage Installer", "low_voltage"],
    ["Building Automation Controls Tech", "controls"],
    ["Journeyman Plumber", "plumbing"],
    ["HVAC Service Mechanic", "hvac"],
    ["Solar PV Installer", "solar_ev"],
    ["Wireman / Electrician", "electrical"],
  ])("%s -> %s", (title, tradeId) => {
    expect(inferTrade(title).id).toBe(tradeId);
  });
  it("fire sprinkler is NOT misrouted to plumbing", () => {
    expect(inferTrade("Sprinkler Fitter").id).not.toBe("plumbing");
  });
});

describe("generateJD section selection", () => {
  it("returns ONLY the requested section keys", () => {
    const sections: JdSectionKey[] = ["jobSummary", "responsibilities"];
    const jd = generateJD({ jobTitle: "Journeyman Electrician", sections });
    expect(Object.keys(jd).sort()).toEqual(["flsa", "jobSummary", "responsibilities", "titleKey", "tradeId"].sort());
    expect(jd.requiredQualifications).toBeUndefined();
    expect(jd.physicalRequirements).toBeUndefined();
  });

  it("splits required vs preferred qualifications", () => {
    const jd = generateJD({ jobTitle: "Journeyman Plumber" });
    expect(Array.isArray(jd.requiredQualifications)).toBe(true);
    expect(Array.isArray(jd.preferredQualifications)).toBe(true);
    expect((jd.requiredQualifications as string[]).length).toBeGreaterThan(0);
    expect((jd.preferredQualifications as string[]).length).toBeGreaterThan(0);
  });

  it("does not leak another trade's jargon (electrical JD has no plumbing systems)", () => {
    const jd = generateJD({ jobTitle: "Journeyman Electrician" });
    const blob = JSON.stringify(jd).toLowerCase();
    expect(blob).toContain("conduit");
    expect(blob).not.toContain("sanitary waste");
    expect(blob).not.toContain("refrigerant");
  });

  it("sets FLSA from level (manager -> exempt, journeyman -> non-exempt)", () => {
    expect(generateJD({ jobTitle: "Operations Manager", levelId: "manager" }).flsa).toBe("exempt");
    expect(generateJD({ jobTitle: "Journeyman Electrician", levelId: "journeyman" }).flsa).toBe("non_exempt");
  });

  it("does not fabricate pay figures (no $ / wage strings in body)", () => {
    const jd = generateJD({ jobTitle: "Journeyman Plumber" });
    const blob = JSON.stringify(jd);
    expect(blob).not.toMatch(/\$\s?\d/);
    expect(blob.toLowerCase()).not.toMatch(/per hour|salary of|annual salary/);
  });
});
