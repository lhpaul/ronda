import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";

export function verifyGithubSignature(input: {
  body: Buffer;
  signatureHeader: string | string[] | undefined;
  secret: string;
}): boolean {
  const signatureHeader = Array.isArray(input.signatureHeader)
    ? input.signatureHeader[0]
    : input.signatureHeader;
  if (!signatureHeader?.startsWith(SIGNATURE_PREFIX) || input.secret.trim() === "") {
    return false;
  }

  const receivedHex = signatureHeader.slice(SIGNATURE_PREFIX.length);
  if (!/^[0-9a-f]{64}$/i.test(receivedHex)) {
    return false;
  }

  const expected = createHmac("sha256", input.secret).update(input.body).digest();
  const received = Buffer.from(receivedHex, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
