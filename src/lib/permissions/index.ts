/**
 * RBAC (§12). Yetki kontrolü her zaman sunucuda yapılır; UI yalnız yansıtır.
 */
export type Role = "owner" | "admin" | "editor" | "analyst" | "viewer" | "client" | "billing";

export type Permission =
  | "workspace.read"
  | "workspace.update"
  | "workspace.delete"
  | "workspace.transfer"
  | "members.manage"
  | "billing.manage"
  | "billing.read"
  | "brand.read"
  | "brand.manage"
  | "prompts.write"
  | "runs.start"
  | "opportunities.write"
  | "actions.draft"
  | "actions.approve"
  | "actions.publish"
  | "integrations.manage"
  | "commerce.read"
  | "ads.read"
  | "ads.draft"
  | "ads.approve"
  | "export"
  | "reports.manage"
  | "apikeys.manage"
  | "webhooks.manage"
  | "privacy.manage"
  | "jobs.manage";

const ALL: Permission[] = [
  "workspace.read", "workspace.update", "workspace.delete", "workspace.transfer", "members.manage",
  "billing.manage", "billing.read", "brand.read", "brand.manage", "prompts.write", "runs.start",
  "opportunities.write", "actions.draft", "actions.approve", "actions.publish", "integrations.manage",
  "commerce.read", "ads.read", "ads.draft", "ads.approve", "export", "reports.manage", "apikeys.manage",
  "webhooks.manage", "privacy.manage", "jobs.manage",
];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ALL,
  admin: ALL.filter((p) => p !== "workspace.delete" && p !== "workspace.transfer"),
  editor: [
    "workspace.read", "brand.read", "prompts.write", "runs.start", "opportunities.write", "actions.draft",
    "commerce.read", "ads.read", "ads.draft", "export", "reports.manage",
  ],
  analyst: ["workspace.read", "brand.read", "runs.start", "export", "commerce.read", "ads.read"],
  viewer: ["workspace.read", "brand.read", "ads.read"],
  client: ["brand.read"],
  billing: ["workspace.read", "billing.manage", "billing.read"],
};

/** Editor publish/budget yalnız ayrıca Approver grant varsa. */
const APPROVER_EXTRA: Permission[] = ["actions.approve", "actions.publish", "ads.approve"];

export interface AccessContext {
  role: Role;
  isApprover: boolean;
}

export function can(ctx: AccessContext, permission: Permission): boolean {
  if (ROLE_PERMISSIONS[ctx.role].includes(permission)) return true;
  return ctx.role === "editor" && ctx.isApprover && APPROVER_EXTRA.includes(permission);
}

export function permissionsFor(ctx: AccessContext): Permission[] {
  return ALL.filter((p) => can(ctx, p));
}

/** Workspace-wide erişimi olan roller; diğerleri (viewer/client) yalnız BrandGrant ile. */
export function hasWorkspaceWideBrandAccess(role: Role): boolean {
  return role === "owner" || role === "admin" || role === "editor" || role === "analyst";
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Hesap sahibi",
  admin: "Yönetici",
  editor: "Editör",
  analyst: "Analist",
  viewer: "Görüntüleyici",
  client: "Müşteri",
  billing: "Faturalama",
};
