export const VISITOR_CONSENT_VERSION = "visitor-photo-v1";
export const VISITOR_CONSENT =
  "I agree to save one camera photo, my current approximate location, connection IP and device details for visitor check-in, visible only to site administrators. Records stay until deleted. I can delete my check-in from this browser for 24 hours. This is not face recognition or identity verification.";
export type VisitorRecord = {
  id: string;
  name: string;
  size: number;
  ip: string;
  country: string | null;
  city: string | null;
  location: string;
  user_agent: string;
  consent_version: string;
  consent_at: string;
  created_at: string;
};
