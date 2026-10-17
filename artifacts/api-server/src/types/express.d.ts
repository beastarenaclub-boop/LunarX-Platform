import type { User, Session, Partner, PartnerApiKey } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      session?: Session;
      partner?: Partner;
      partnerApiKey?: PartnerApiKey;
      rawBody?: string;
    }
  }
}

export {};
