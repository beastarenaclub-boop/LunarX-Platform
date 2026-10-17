export type Role = "admin" | "agent" | "shop" | "user";
export type Game = "2D" | "3D" | "Titli";
export type Account = {
  id: string;
  name: string;
  role: Role;
  parent_id: string | null;
  balance: number;
  commission: number;
  active: number;
  created: number;
};
export type Settings = {
  brand: string;
  interval: number;
  unitPrice: number;
  seriesPrices?: Record<string, number>;
  maxTicket: number;
  payouts: Record<Game, number>;
  salesEnabled: boolean;
  timezone: string;
};
export type Draw = {
  id: string;
  closes: number;
  ends: number;
  status: "open" | "settled";
  commitment: string;
  seed?: string;
  results: Record<string, Record<Game, string>> | null;
  config: Settings;
};
export type Line = {
  series: string;
  number: string;
  quantity: number;
  unitPrice: number;
};
export type Ticket = {
  id: string;
  seller_id: string;
  seller_name?: string;
  agent_id: string | null;
  draw_id: string;
  game: Game;
  lines: Line[];
  total: number;
  payout: number;
  commission: number;
  status: "pending" | "won" | "lost" | "claimed" | "cancelled";
  customer: string;
  created: number;
  claimed: number | null;
  print_count: number;
};
export type Ledger = {
  id: string;
  account_id: string;
  account_name: string;
  kind: string;
  amount: number;
  balance: number;
  reference: string;
  created: number;
};
export type Complaint = {
  id: string;
  account_id: string;
  subject: string;
  message: string;
  status: string;
  reply: string;
  created: number;
};
export type Data = {
  account: Account;
  mode: "demo" | "local" | "wallet";
  serverTime: number;
  settings: Settings;
  draws: Draw[];
  tickets: Ticket[];
  accounts: Account[];
  ledger: Ledger[];
  complaints: Complaint[];
  audit: {
    id: string;
    actor_id: string;
    action: string;
    detail: string;
    created: number;
  }[];
  stats: {
    sales: number;
    tickets: number;
    prizes: number;
    commission: number;
    pendingClaims: number;
    cancelled: number;
  };
};
export type Receipt = Ticket & {
  shop: string;
  draw: { id: string; ends: number; closes: number };
  brand: string;
  demo: boolean;
};
