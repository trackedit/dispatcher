-- PlanetScale PostgreSQL Database Schema for Analytics/Events
-- Run this on your PlanetScale PostgreSQL database
-- Converted from MySQL syntax to PostgreSQL
-- Unified events table replaces separate impressions, clicks, and conversions tables

-- Events table
-- Stores all events (impressions, clicks, conversions) in a single unified table
-- Uses boolean flags to indicate event type: is_impression, is_click, is_conversion
-- For redirect campaigns: one row with is_impression=true AND is_click=true
-- For folder/proxy campaigns: separate rows for impression and click
-- Conversions: separate rows linked via click_id
CREATE TABLE IF NOT EXISTS events (
    event_id VARCHAR(255) NOT NULL PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL,           -- Fingerprint-based (stable per browser/device)
    campaign_id VARCHAR(255),                   -- Which campaign/rule was matched
    
    -- Event type flags (can be multiple true)
    is_impression BOOLEAN DEFAULT FALSE,
    is_click BOOLEAN DEFAULT FALSE,
    is_conversion BOOLEAN DEFAULT FALSE,
    
    -- Shared metadata (stored ONCE, not duplicated)
    domain VARCHAR(255),
    path TEXT,
    ip VARCHAR(45),                             -- IPv6 can be up to 45 chars
    country VARCHAR(2),                         -- ISO country code
    city VARCHAR(255),
    continent VARCHAR(2),                        -- Continent code
    latitude DECIMAL(10, 8),                    -- Geo latitude
    longitude DECIMAL(11, 8),                    -- Geo longitude
    region VARCHAR(255),                         -- State/province name
    region_code VARCHAR(10),                    -- State/province code
    postal_code VARCHAR(20),                    -- ZIP/postal code
    timezone VARCHAR(50),                        -- User timezone
    device VARCHAR(50),                          -- Mobile, Desktop, Tablet
    browser VARCHAR(100),                        -- Chrome, Firefox, Safari, etc.
    browser_version VARCHAR(50),                 -- Browser version number
    os VARCHAR(100),                            -- Windows, macOS, iOS, Android, etc.
    os_version VARCHAR(50),                     -- OS version
    brand VARCHAR(100),                         -- Device brand (Apple, Samsung, etc.)
    referrer TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    query_params JSONB,                         -- JSON object of query parameters (JSONB for PostgreSQL)
    rule_key VARCHAR(500),                      -- KV key that matched (e.g., "example.com" or "example.com/path")
    landing_page TEXT,                          -- Which landing page was shown (folder path or URL)
    landing_page_mode VARCHAR(20),              -- How it was served: 'hosted', 'proxy', 'redirect', or NULL
    user_agent_raw TEXT,                        -- Full user agent string
    asn INTEGER,                                -- ASN number (PostgreSQL doesn't have UNSIGNED)
    as_organization VARCHAR(255),               -- AS organization name
    colo VARCHAR(10),                           -- Cloudflare datacenter code
    client_trust_score SMALLINT,                -- Cloudflare trust score (0-255) - SMALLINT instead of TINYINT UNSIGNED
    http_protocol VARCHAR(10),                  -- HTTP/1.1, HTTP/2, HTTP/3
    tls_version VARCHAR(20),                    -- TLS version
    tls_cipher VARCHAR(100),                    -- TLS cipher suite
    
    -- Click-specific fields (nullable, only populated when is_click=true)
    destination_url TEXT,                        -- Where the user was redirected
    destination_id VARCHAR(255),                -- Which destination was selected (from clickDestinations array)
    matched_flags JSONB,                        -- JSON array of matched rule flags (for debugging)
    platform_id VARCHAR(50),                    -- 'facebook', 'google', 'tiktok', etc.
    platform_click_id VARCHAR(500),             -- The actual fbclid/gclid/ttclid value captured from URL
    
    -- Conversion-specific fields (nullable, only populated when is_conversion=true)
    click_id VARCHAR(255),                       -- Links to the click event (for conversions)
    payout DECIMAL(10, 2),                      -- Payout amount from postback for THIS conversion
    conversion_type VARCHAR(50) DEFAULT 'lead', -- 'lead', 'lead2', 'lead3', 'sale', 'signup', 'trial', etc.
    postback_data JSONB                         -- JSON object of all postback parameters
);

-- Create indexes for events
-- Event type flags
CREATE INDEX IF NOT EXISTS idx_events_is_impression ON events(is_impression) WHERE is_impression = true;
CREATE INDEX IF NOT EXISTS idx_events_is_click ON events(is_click) WHERE is_click = true;
CREATE INDEX IF NOT EXISTS idx_events_is_conversion ON events(is_conversion) WHERE is_conversion = true;

-- Common query patterns
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_campaign_id ON events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_domain ON events(domain);
CREATE INDEX IF NOT EXISTS idx_events_country ON events(country);
CREATE INDEX IF NOT EXISTS idx_events_city ON events(city);
CREATE INDEX IF NOT EXISTS idx_events_landing_page ON events(landing_page);
CREATE INDEX IF NOT EXISTS idx_events_session_timestamp ON events(session_id, timestamp);

-- Click-specific indexes
CREATE INDEX IF NOT EXISTS idx_events_click_id ON events(click_id) WHERE click_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_destination_id ON events(destination_id) WHERE destination_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_platform_id ON events(platform_id) WHERE platform_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_platform_click_id ON events(platform_click_id) WHERE platform_click_id IS NOT NULL;

-- Conversion-specific indexes
CREATE INDEX IF NOT EXISTS idx_events_conversion_type ON events(conversion_type) WHERE conversion_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_click_conversion ON events(click_id, timestamp) WHERE is_conversion = true;

-- Composite indexes for common analytics queries
CREATE INDEX IF NOT EXISTS idx_events_campaign_impression ON events(campaign_id, timestamp) WHERE is_impression = true;
CREATE INDEX IF NOT EXISTS idx_events_campaign_click ON events(campaign_id, timestamp) WHERE is_click = true;
CREATE INDEX IF NOT EXISTS idx_events_campaign_conversion ON events(campaign_id, timestamp) WHERE is_conversion = true;

-- Note: PlanetScale PostgreSQL doesn't support foreign keys by default
-- But the indexes above provide fast lookups for common query patterns
