// Type definitions for ClickHouse tables
// These match the schema in clickhouse-schema.sql

export interface ClickHouseImpression {
  impression_id: string;
  session_id: string;
  campaign_id: string;
  domain: string;
  path: string;
  ip: string;
  country: string;
  city: string;
  continent: string;
  latitude: string;
  longitude: string;
  region: string;
  region_code: string;
  postal_code: string;
  timezone: string;
  device: string;
  browser: string;
  browser_version: string;
  os: string;
  os_version: string;
  brand: string;
  referrer: string;
  query_params: string; // JSON string
  rule_key: string;
  user_agent_raw: string;
  asn: number;
  as_organization: string;
  colo: string;
  client_trust_score: number | null;
  http_protocol: string;
  tls_version: string;
  tls_cipher: string;
}

export interface ClickHouseClick {
  click_id: string;
  impression_id: string;
  session_id: string;
  campaign_id: string;
  domain: string;
  path: string;
  destination_url: string;
  destination_id: string;
  matched_flags: string; // JSON string
  ip: string;
  country: string;
  city: string;
  continent: string;
  latitude: string;
  longitude: string;
  region: string;
  region_code: string;
  postal_code: string;
  timezone: string;
  device: string;
  browser: string;
  browser_version: string;
  os: string;
  os_version: string;
  brand: string;
  query_params: string; // JSON string
  rule_key: string;
  user_agent_raw: string;
  asn: number;
  as_organization: string;
  colo: string;
  client_trust_score: number | null;
  http_protocol: string;
  tls_version: string;
  tls_cipher: string;
}

export interface ClickHouseConversion {
  conversion_id: string;
  click_id: string;
  impression_id: string;
  session_id: string;
  campaign_id: string;
  payout: number;
  conversion_type: string;
  postback_data: string; // JSON string
}

// Query result types
export interface ClickDataResult {
  click_id: string;
  impression_id: string;
  session_id: string;
  campaign_id: string;
}

