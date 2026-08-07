import { describe, expect, it } from "vitest";
import { readsbToStateVector } from "../lib/opensky-ingestor";

describe("free ADS-B fallback normalization", () => {
  it("maps the aircraft registration before the operator callsign", () => {
    const vector = readsbToStateVector({
      hex: "a1b2c3",
      r: "N123AB",
      flight: "UAL123",
      ownOp: "United Airlines",
      lat: 40.1,
      lon: -73.9,
      alt_baro: 12000,
      gs: 250,
      track: 180,
      on_ground: false,
      squawk: "1200",
    });

    expect(vector[0]).toBe("a1b2c3");
    expect(vector[1]).toBe("N123AB");
    expect(vector[5]).toBe(-73.9);
    expect(vector[6]).toBe(40.1);
    expect(vector[8]).toBe(false);
    expect(vector[14]).toBe("1200");
  });

  it("falls back to the flight callsign when registration is absent", () => {
    const vector = readsbToStateVector({ hex: "abc123", flight: "UAL123" });
    expect(vector[1]).toBe("UAL123");
  });
});