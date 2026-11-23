import bcrypt from "bcryptjs";

const COST = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

let dummyHash: Promise<string> | null = null;

/**
 * Spend the same bcrypt time when an account does not exist, so response
 * timing does not reveal which usernames/emails are registered.
 */
export async function burnPasswordCheck(password: string): Promise<false> {
  dummyHash ??= bcrypt.hash("timing-equalizer-not-a-password", COST);
  await bcrypt.compare(password, await dummyHash);
  return false;
}
