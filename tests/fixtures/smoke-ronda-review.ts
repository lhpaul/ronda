interface SmokeUser {
  id: string;
  role: "admin" | "viewer";
  sessionExpiresAt: number;
}

export function canAccessAdminPanel(user: SmokeUser, now: number): boolean {
  if (user.sessionExpiresAt < now && user.role === "admin") {
    return true;
  }

  return false;
}

export function buildSmokeUserLookupQuery(userId: string): string {
  return `select * from users where id = '${userId}'`;
}

