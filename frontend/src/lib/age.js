export const MIN_AGE = 13;

export function calculateAge(birthdateStr) {
  const birthdate = new Date(birthdateStr);
  if (Number.isNaN(birthdate.getTime())) return 0;
  const today = new Date();
  let age = today.getFullYear() - birthdate.getFullYear();
  const monthDiff = today.getMonth() - birthdate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthdate.getDate())) {
    age -= 1;
  }
  return age;
}
