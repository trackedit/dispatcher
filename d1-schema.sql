-- D1 Database Schema for UI/Campaign Management
-- Run this on Cloudflare D1 database
-- Use: wrangler d1 execute DB_NAME --file=./d1-schema.sql

-- Platforms table (Traffic Sources)
-- Defines ad platforms and their click ID parameter names for inbound tracking
-- When traffic comes in, dispatcher looks for these params to capture platform click IDs
CREATE TABLE IF NOT EXISTS platforms (
    id TEXT PRIMARY KEY,              -- 'facebook', 'google', 'tiktok', 'bing', 'taboola', etc.
    name TEXT NOT NULL,               -- "Facebook Ads", "Google Ads", "TikTok Ads"
    click_id_param TEXT NOT NULL,     -- 'fbclid', 'gclid', 'ttclid', 'msclkid', etc.
    cost_param TEXT,                  -- Optional: param name for cost data (e.g., 'cost')
    icon TEXT,                        -- Icon name for UI (e.g., 'facebook', 'google')
    macros TEXT,                      -- JSON array of tracking macros/parameters for this platform
    status TEXT DEFAULT 'active',     -- 'active', 'inactive'
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
);

-- Seed default platforms with pre-baked tracking macros
INSERT OR IGNORE INTO platforms (id, name, click_id_param, icon, macros) VALUES
    ('facebook', 'Meta', 'fbclid', 'facebook', '[
        {"param": "fbclid", "name": "Facebook Click ID", "category": "click_id"},
        {"param": "campaign_id", "name": "Campaign ID", "category": "campaign"},
        {"param": "adset_id", "name": "Ad Set ID", "category": "adset"},
        {"param": "ad_id", "name": "Ad ID", "category": "ad"},
        {"param": "campaign_name", "name": "Campaign Name", "category": "campaign"},
        {"param": "adset_name", "name": "Ad Set Name", "category": "adset"},
        {"param": "ad_name", "name": "Ad Name", "category": "ad"},
        {"param": "placement", "name": "Placement", "category": "placement"},
        {"param": "site_source_name", "name": "Site Source", "category": "source"}
    ]'),
    ('google', 'Google', 'gclid', 'google', '[
        {"param": "gclid", "name": "Google Click ID", "category": "click_id"},
        {"param": "campaignid", "name": "Campaign ID", "category": "campaign"},
        {"param": "adgroupid", "name": "Ad Group ID", "category": "adgroup"},
        {"param": "creative", "name": "Creative ID", "category": "creative"},
        {"param": "keyword", "name": "Keyword", "category": "keyword"},
        {"param": "matchtype", "name": "Match Type", "category": "keyword"},
        {"param": "network", "name": "Network", "category": "network"},
        {"param": "device", "name": "Device", "category": "device"}
    ]'),
    ('tiktok', 'TikTok', 'ttclid', 'tiktok', '[
        {"param": "ttclid", "name": "TikTok Click ID", "category": "click_id"},
        {"param": "campaign_id", "name": "Campaign ID", "category": "campaign"},
        {"param": "adgroup_id", "name": "Ad Group ID", "category": "adgroup"},
        {"param": "ad_id", "name": "Ad ID", "category": "ad"},
        {"param": "campaign_name", "name": "Campaign Name", "category": "campaign"},
        {"param": "adgroup_name", "name": "Ad Group Name", "category": "adgroup"},
        {"param": "ad_name", "name": "Ad Name", "category": "ad"},
        {"param": "placement", "name": "Placement", "category": "placement"}
    ]'),
    ('taboola', 'Taboola', 'tblci', 'taboola', '[
        {"param": "tblci", "name": "Taboola Click ID", "category": "click_id"},
        {"param": "campaign_id", "name": "Campaign ID", "category": "campaign"},
        {"param": "campaign_name", "name": "Campaign Name", "category": "campaign"},
        {"param": "site", "name": "Site ID", "category": "site"},
        {"param": "site_domain", "name": "Site Domain", "category": "site"},
        {"param": "item_id", "name": "Item ID", "category": "item"},
        {"param": "thumbnail_id", "name": "Thumbnail ID", "category": "item"}
    ]'),
    ('outbrain', 'Outbrain', 'obclid', 'outbrain', '[
        {"param": "obclid", "name": "Outbrain Click ID", "category": "click_id"},
        {"param": "campaign_id", "name": "Campaign ID", "category": "campaign"},
        {"param": "section_id", "name": "Section ID", "category": "section"},
        {"param": "section_name", "name": "Section Name", "category": "section"},
        {"param": "ad_id", "name": "Ad ID", "category": "ad"},
        {"param": "ad_title", "name": "Ad Title", "category": "ad"},
        {"param": "publisher_id", "name": "Publisher ID", "category": "publisher"},
        {"param": "publisher_name", "name": "Publisher Name", "category": "publisher"}
    ]'),
    ('bing', 'Microsoft', 'msclkid', 'microsoft', '[
        {"param": "msclkid", "name": "Microsoft Click ID", "category": "click_id"},
        {"param": "campaignid", "name": "Campaign ID", "category": "campaign"},
        {"param": "adgroupid", "name": "Ad Group ID", "category": "adgroup"},
        {"param": "keyword", "name": "Keyword", "category": "keyword"},
        {"param": "matchtype", "name": "Match Type", "category": "keyword"},
        {"param": "device", "name": "Device", "category": "device"},
        {"param": "network", "name": "Network", "category": "network"}
    ]'),
    ('twitter', 'X', 'twclid', 'twitter', '[
        {"param": "twclid", "name": "Twitter Click ID", "category": "click_id"},
        {"param": "campaign_id", "name": "Campaign ID", "category": "campaign"},
        {"param": "ad_id", "name": "Ad ID", "category": "ad"}
    ]'),
    ('snapchat', 'Snapchat', 'ScCid', 'snapchat', '[
        {"param": "ScCid", "name": "Snapchat Click ID", "category": "click_id"},
        {"param": "campaign_id", "name": "Campaign ID", "category": "campaign"},
        {"param": "ad_id", "name": "Ad ID", "category": "ad"}
    ]');

-- Migration: Add macros column to existing platforms table (run this if table already exists)
-- ALTER TABLE platforms ADD COLUMN macros TEXT;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,              -- Internal user UUID
    clerk_id TEXT UNIQUE,             -- Clerk user ID (auth source of truth)
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
);

-- Sites table
-- Domains that users add/manage
-- Users add domains here (e.g., "example.com")
-- We track all visits to this domain regardless of path
CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    status TEXT DEFAULT 'active', -- 'active', 'paused', 'archived'
    integration_type TEXT,        -- 'dns_proxy', 'js_snippet'
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, domain)  -- One user can't have duplicate domains
);

-- Campaigns table
-- Marketing campaigns that belong to a site
-- ONE campaign = ONE KV key (domain+path)
-- One site can have MULTIPLE campaigns (different paths = different campaigns)
-- Example: Site "example.com" can have:
--   - Campaign "Homepage" → KV key: "example.com"
--   - Campaign "Product Page" → KV key: "example.com/products"
CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    site_id TEXT NOT NULL,        -- Which site/domain this campaign belongs to
    platform_id TEXT,             -- Which ad platform this campaign runs on (facebook, google, etc.)
    kv_key TEXT NOT NULL UNIQUE,  -- KV key = domain or domain+path (ONE campaign = ONE KV key)
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'active',  -- 'active', 'paused', 'archived'
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (site_id) REFERENCES sites(id),
    FOREIGN KEY (platform_id) REFERENCES platforms(id)
);

-- Conversion types table
-- Defines conversion types and their order for each campaign
-- Example: Campaign 1 might have: lead (order: 1), lead2 (order: 2), sale (order: 3)
CREATE TABLE IF NOT EXISTS conversion_types (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    conversion_type TEXT NOT NULL,  -- 'lead', 'lead2', 'sale', 'signup', etc.
    display_name TEXT,              -- Human-readable name (e.g., "First Lead", "Second Lead", "Sale")
    order_index INTEGER NOT NULL,   -- Order/sequence (1, 2, 3, etc.)
    default_payout Decimal(10, 2),  -- Default payout amount (can be overridden in postback)
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
    UNIQUE(campaign_id, conversion_type)  -- Each conversion type can only appear once per campaign
);

-- NOTE: kv_key is now stored directly in campaigns table (simpler design)
-- Removed rule_mappings table - no longer needed

-- Destinations table (scoped per user)
-- Stores outgoing destinations/offers (reusable across campaigns)
-- KV stores only UUIDs + weights, URLs are looked up from here
CREATE TABLE IF NOT EXISTS destinations (
    id TEXT PRIMARY KEY,              -- UUIDv7 (global, reusable)
    user_id TEXT NOT NULL,            -- Owner of the destination
    name TEXT NOT NULL,               -- Display name (e.g., "Offer 1", "Premium Offer")
    url TEXT NOT NULL,                -- Redirect URL
    status TEXT DEFAULT 'active',      -- 'active', 'paused'
    tags TEXT,                        -- JSON array of tags (e.g., '["insurance", "auto", "us"]')
    group_name TEXT,                  -- Optional group name (e.g., "Company A", "Insurance Offers")
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_site_id ON campaigns(site_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_platform_id ON campaigns(platform_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_sites_user_id ON sites(user_id);
CREATE INDEX IF NOT EXISTS idx_sites_domain ON sites(domain);
CREATE INDEX IF NOT EXISTS idx_campaigns_kv_key ON campaigns(kv_key);
CREATE INDEX IF NOT EXISTS idx_conversion_types_campaign_id ON conversion_types(campaign_id);
CREATE INDEX IF NOT EXISTS idx_conversion_types_order ON conversion_types(campaign_id, order_index);
CREATE INDEX IF NOT EXISTS idx_destinations_status ON destinations(status);
CREATE INDEX IF NOT EXISTS idx_destinations_group ON destinations(group_name);
CREATE INDEX IF NOT EXISTS idx_destinations_user_id ON destinations(user_id);
