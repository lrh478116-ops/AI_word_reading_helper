export const MIN_PASSWORD_LENGTH = 8;

export function isAcceptableNewPassword(value: unknown) {
  return typeof value === "string" && value.length >= MIN_PASSWORD_LENGTH;
}
