export function generateOrderId(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2); // 26
  const mm = String(now.getMonth() + 1).padStart(2, "0"); // 04
  const dd = String(now.getDate()).padStart(2, "0"); // 10
  const datePart = `${yy}${mm}${dd}`;
  const randomPart = Math.random().toString(16).slice(2, 10); // 8 hex chars
  return `od${datePart}${randomPart}`;
}

export function generateIssueId(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2); // 26
  const mm = String(now.getMonth() + 1).padStart(2, "0"); // 04
  const dd = String(now.getDate()).padStart(2, "0"); // 10
  const datePart = `${yy}${mm}${dd}`;
  const randomPart = Math.random().toString(16).slice(2, 10); // 8 hex chars
  return `iss${datePart}${randomPart}`;
}
