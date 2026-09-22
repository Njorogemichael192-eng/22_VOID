import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, type Cursor } from "./cursor.js";

const cursor: Cursor = { value: "2026-09-22T15:00:00.000Z", direction: -1, id: "evt_0123" };

describe("cursor codec", () => {
  it("round-trips a cursor", () => {
    const encoded = encodeCursor(cursor);
    expect(encoded).toMatch(/^22v\.[A-Za-z0-9_-]+$/);
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  it("round-trips an ascending id cursor", () => {
    const idCursor: Cursor = { value: "sel_999", direction: 1, id: "sel_999" };
    expect(decodeCursor(encodeCursor(idCursor))).toEqual(idCursor);
  });

  it("rejects values without the prefix", () => {
    expect(decodeCursor("eyJ2IjoibiJ9")).toBeNull();
  });

  it("rejects garbage base64", () => {
    expect(decodeCursor("22v.%%%not-json%%%")).toBeNull();
  });

  it("rejects well-formed but invalid payloads", () => {
    expect(decodeCursor("22v." + Buffer.from(JSON.stringify({ v: 42, d: 1, id: "x" }), "utf8").toString("base64url"))).toBeNull();
    expect(decodeCursor("22v." + Buffer.from(JSON.stringify({ v: "a", d: 0, id: "x" }), "utf8").toString("base64url"))).toBeNull();
    expect(decodeCursor("22v." + Buffer.from(JSON.stringify({ v: "a", d: 1 }), "utf8").toString("base64url"))).toBeNull();
    expect(decodeCursor("22v." + Buffer.from("null", "utf8").toString("base64url"))).toBeNull();
  });

  it("is url-safe (no padding or + / characters)", () => {
    const encoded = encodeCursor(cursor);
    expect(encoded).not.toContain("=");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
  });
});