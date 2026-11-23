import { badRequest } from "./errors";

// bcrypt only uses the first 72 bytes of a password; anything longer would be
// silently truncated, so reject it instead.
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_MIN_LENGTH = 8;

const COMMON = new Set([
  "password", "password1", "password123", "passw0rd", "12345678", "123456789",
  "1234567890", "qwerty123", "qwertyuiop", "11111111", "00000000", "iloveyou1",
  "abc12345", "abcd1234", "admin123", "welcome1", "letmein1", "india123",
  "crypto777", "crypto123", "lunar123", "asdf1234", "zxcv1234", "1q2w3e4r",
]);

/** Returns a user-facing problem with the password, or null when acceptable. */
export function passwordProblem(
  password: string,
  context: { username?: string | null } = {},
): string | null {
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES)
    return `Password must be at most ${PASSWORD_MAX_BYTES} bytes.`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password))
    return "Password must contain at least one letter and one number.";
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return "This password is too common. Choose another.";
  if (/^(.)\1+$/.test(password)) return "This password is too easy to guess.";
  if (context.username && lower.includes(context.username.toLowerCase()))
    return "Password must not contain your username.";
  return null;
}

export function assertPasswordAllowed(
  password: string,
  context: { username?: string | null } = {},
): void {
  const problem = passwordProblem(password, context);
  if (problem) throw badRequest(problem);
}
