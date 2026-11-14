/** SMB banking org models — Mercury / Relay style. */

export type OrgRole = "owner" | "admin" | "bookkeeper" | "employee" | "viewer";

export type MemberStatus = "active" | "invited" | "disabled";

/** Org Approvals recipients are USDC-only from the Treasury Safe. */
export type PaymentMethod = "usdc";

export interface OrgMember {
  id: string;
  name: string;
  email: string;
  role: OrgRole;
  status: MemberStatus;
  invitedAt: string;
  /** Signer EOA address used as Safe owner when canSign. */
  walletAddress?: string;
  /**
   * Desired signing privilege. On-chain Safe owners are the source of truth;
   * this flag tracks intent for members pending add/remove.
   */
  canSign?: boolean;
}

export interface OrgRecipient {
  id: string;
  name: string;
  email?: string;
  method: PaymentMethod;
  walletAddress?: string;
  createdAt: string;
}

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  bookkeeper: "Bookkeeper",
  employee: "Employee",
  viewer: "View only",
};

export const ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
  owner: "Full access to money movement, team, and settings",
  admin: "Manage payments, cards, and most settings",
  bookkeeper: "Categorize, sync books, and prepare bills — no send money",
  employee: "Submit bills and expenses for approval",
  viewer: "Read-only access to balances and reports",
};
