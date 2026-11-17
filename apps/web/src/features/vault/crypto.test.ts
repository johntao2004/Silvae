// 覆盖错误密钥、篡改、分块重排/截断和笔记归属认证，区分保密性与完整性校验。
// Covers wrong keys, tampering, reordered/truncated chunks and note ownership authentication, separating secrecy from integrity.
import { describe, it, expect, vi, afterAll } from "vitest";
import { webcrypto } from "node:crypto";
vi.stubGlobal("crypto", webcrypto);
afterAll(() => vi.unstubAllGlobals());
import { b64, unb64, seal, open, sealJson, openJson, fileKey, chunkAad, createDeviceEnvelope, unlock } from "./crypto";
describe("vault authenticated encryption", () => {
  it("creates a password-free device vault with a portable recovery key", async () => {
    const created = await createDeviceEnvelope();
    expect(created.envelope.version).toBe(2);
    expect(await unlock(created.envelope, created.recovery, true)).toEqual(created.master);
    await expect(unlock(created.envelope, b64Key(), true)).rejects.toThrow("解密恢复密钥不正确");
    await expect(unlock(created.envelope, "password", false)).rejects.toThrow("恢复密钥");
  });
  it("round trips and rejects the wrong password key, tampering, reordered or truncated chunks", async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const aad = chunkAad("id", 0, 2, 1500000),
      plain = new TextEncoder().encode("私有正文");
    const box = await seal(key, plain, aad);
    expect(Array.from(await open(key, box, aad))).toEqual(Array.from(plain));
    await expect(open(new Uint8Array(32), box, aad)).rejects.toThrow();
    await expect(
      open(key, box, chunkAad("id", 1, 2, 1500000)),
    ).rejects.toThrow();
    await expect(
      open(key, box, chunkAad("id", 0, 1, 1500000)),
    ).rejects.toThrow();
    await expect(open(key, box.slice(0, -1), aad)).rejects.toThrow();
    box[15] ^= 1;
    await expect(open(key, box, aad)).rejects.toThrow();
  });
  it("uses random nonces, separates file keys, and authenticates note ownership", async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    expect(await sealJson(key, {}, "a")).not.toEqual(
      await sealJson(key, {}, "a"),
    );
    expect(await fileKey(key, "a")).not.toEqual(await fileKey(key, "b"));
    const note = await sealJson(key, { note: "私人笔记" }, "state:a");
    expect(await openJson(key, note, "state:a")).toEqual({ note: "私人笔记" });
    await expect(openJson(key, note, "state:b")).rejects.toThrow();
  });
});
function b64Key() { return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"); }

it("decrypts released recovery and file fixtures after the Humite rename", async () => {
  const master = Uint8Array.from({ length: 32 }, (_, i) => i);
  const restored = await unlock({ version: 2, kind: "device", recoveryBox: "BwcHBwcHBwcHBwcHWbqPnGx0+R5/412Gms996S0pFFmUGeRShpcLi+9rnQZ/wCAFrJK/aeElZGsLbaYH" }, "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk=", true);
  expect(restored).toEqual(master);
  const derived = await fileKey(restored, "legacy-book");
  expect(b64(derived)).toBe(Buffer.from("f1b8f85e6ce0954bed12cb3f118585bef148bf1c7d0079189f7d926035274fdc", "hex").toString("base64"));
  const chunk = unb64("BwcHBwcHBwcHBwcHrKXSfw/S0em+Pu9I5EpyBQw2vByzFA==");
  expect(new TextDecoder().decode(await open(derived, chunk, chunkAad("legacy-book", 0, 1, 6)))).toBe("secret");
  await expect(open(derived, chunk, chunkAad("legacy-book", 1, 1, 6))).rejects.toThrow();
});
