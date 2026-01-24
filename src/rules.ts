import { env } from "cloudflare:workers";
import coloLocations from "./colo-locations.json";

// Type for Cloudflare colo location data
interface ColoLocation {
  cca2?: string;
  city?: string;
  country?: string;
  lat?: number;
  lon?: number;
  name?: string;
  region?: string;
}

// Type for the colo locations map
const COLO_LOCATIONS: Record<string, ColoLocation> = coloLocations;

// Type for click data returned from database lookup
interface ClickDataResult {
  click_id: string;
  impression_id: string | null;
  session_id: string;
  campaign_id: string;
  platform_id: string | null;
  platform_click_id: string | null;
}

// Helper to extract landing page info from finalAction
function extractLandingPageInfo(finalAction: { type: string; payload: string | any[] }): { landingPage: string | null; landingPageMode: 'hosted' | 'proxy' | 'redirect' | null } {
  if (finalAction.type === 'modifications') {
    // Modifications use the origin URL as the landing page
    return { landingPage: null, landingPageMode: null }; // Will be set from origin URL in call site
  } else if (finalAction.type === 'proxy') {
    return { landingPage: typeof finalAction.payload === 'string' ? finalAction.payload : null, landingPageMode: 'proxy' };
  } else if (finalAction.type === 'redirect') {
    return { landingPage: typeof finalAction.payload === 'string' ? finalAction.payload : null, landingPageMode: 'redirect' };
  } else if (finalAction.type === 'folder') {
    return { landingPage: typeof finalAction.payload === 'string' ? finalAction.payload : null, landingPageMode: 'hosted' };
  }
  return { landingPage: null, landingPageMode: null };
}

// Helper to look up landing page from impression (for clicks)
async function getLandingPageFromImpression(impressionId: string): Promise<{ landingPage: string | null; landingPageMode: 'hosted' | 'proxy' | 'redirect' | null; queryParams: Record<string, string> | null } | null> {
  const hyperdrive = (env as any).HYPERDRIVE;
  if (!hyperdrive) {
    return null; // Can't look up without Hyperdrive
  }
  
  try {
    const { Client } = await import('pg');
    const client = new Client({
      connectionString: hyperdrive.connectionString,
      ssl: { rejectUnauthorized: false }
    });
    await client.connect();
    
    try {
      const result = await client.query(
        'SELECT landing_page, landing_page_mode, query_params FROM events WHERE event_id = $1 AND is_impression = true LIMIT 1',
        [impressionId]
      );
      
      await client.end();
      
      if (result.rows.length > 0) {
        const row = result.rows[0];
        let queryParams: Record<string, string> | null = null;
        
        // Parse query_params JSON if it exists
        if (row.query_params) {
          try {
            queryParams = typeof row.query_params === 'string' 
              ? JSON.parse(row.query_params) 
              : row.query_params;
          } catch (e) {
            console.error(`Failed to parse query_params for impression ${impressionId}:`, e);
          }
        }
        
        return {
          landingPage: row.landing_page || null,
          landingPageMode: row.landing_page_mode || null,
          queryParams: queryParams || null,
        };
      }
    } catch (queryError: any) {
      await client.end();
      throw queryError;
    }
  } catch (error: any) {
    console.error(`Failed to look up landing page for impression ${impressionId}:`, error.message);
  }
  return null;
}

// PlanetScale client helper (using Hyperdrive + pg)
// Unified events table storage
async function storeInPlanetScale(data: Record<string, any>): Promise<void> {
  const hyperdrive = (env as any).HYPERDRIVE;
  if (!hyperdrive) {
    console.error('PlanetScale not configured - HYPERDRIVE binding not found');
    return;
  }
  
  try {
    const { Client } = await import('pg');
    const client = new Client({
      connectionString: hyperdrive.connectionString,
      ssl: { rejectUnauthorized: false }
    });
    await client.connect();
    
    try {
      const eventType = data.is_conversion ? 'conversion' : data.is_click ? 'click' : 'impression';
      console.log(`[PSQL] inserting ${eventType}`, data.event_id);
      
      await client.query(`
        INSERT INTO events (
          event_id, session_id, campaign_id, is_impression, is_click, is_conversion,
          domain, path, ip, country, city, continent, latitude, longitude, region, region_code,
          postal_code, timezone, device, browser, browser_version, os, os_version, brand,
          referrer, query_params, rule_key, landing_page, landing_page_mode,
          user_agent_raw, asn, as_organization, colo, client_trust_score,
          http_protocol, tls_version, tls_cipher,
          destination_url, destination_id, matched_flags, platform_id, platform_click_id,
          click_id, payout, conversion_type, postback_data, is_bot, bot_score
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29,
          $30, $31, $32, $33, $34, $35, $36, $37,
          $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48
        )
        ON CONFLICT (event_id) DO NOTHING
      `, [
        data.event_id, data.session_id, data.campaign_id,
        data.is_impression || false, data.is_click || false, data.is_conversion || false,
        data.domain || null, data.path, data.ip || null, data.country || null,
        data.city || null, data.continent || null, data.latitude || null, data.longitude || null,
        data.region || null, data.region_code || null, data.postal_code || null,
        data.timezone || null, data.device || null, data.browser || null,
        data.browser_version || null, data.os || null, data.os_version || null,
        data.brand || null, data.referrer || null, data.query_params || null,
        data.rule_key, data.landing_page || null, data.landing_page_mode || null,
        data.user_agent_raw || null, data.asn || null, data.as_organization || null,
        data.colo || null, data.client_trust_score || null, data.http_protocol || null,
        data.tls_version || null, data.tls_cipher || null,
        data.destination_url || null, data.destination_id || null, data.matched_flags || null,
        data.platform_id || null, data.platform_click_id || null,
        data.click_id || null, data.payout || null, data.conversion_type || null,
        data.postback_data || null, data.is_bot || false, data.bot_score || null
      ]);
      
      await client.end();
    } catch (queryError: any) {
      await client.end();
      throw queryError;
    }
  } catch (error: any) {
    console.error(`Exception storing event in PlanetScale:`, error.message);
  }
}

// Unified event storage function
// Replaces separate storeImpression/storeClick functions
async function storeEvent(data: {
  eventId: string;
  sessionId: string;
  campaignId: string;
  isImpression: boolean;
  isClick: boolean;
  domain: string | null;
  path: string;
  landingPage: string | null;
  landingPageMode: 'hosted' | 'proxy' | 'redirect' | null;
  ip: string | null;
  country: string | null;
  city: string | null;
  continent: string | null;
  latitude: string | null;
  longitude: string | null;
  region: string | null;
  regionCode: string | null;
  postalCode: string | null;
  timezone: string | null;
  device: string | null;
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  brand: string | null;
  referrer: string | null;
  queryParams: Record<string, string>;
  ruleKey: string;
  userAgentRaw: string | null;
  isBot?: boolean;  // Bot detection flag (from isbot library)
  botScore?: number | null; // Cloudflare Bot Management Score
  asn: number | null;
  asOrganization: string | null;
  colo: string | null;
  clientTrustScore: number | null;
  httpProtocol: string | null;
  tlsVersion: string | null;
  tlsCipher: string | null;
  // Click-specific fields (optional)
  destinationUrl?: string | null;
  destinationId?: string | null;
  matchedFlags?: string[];
  platformId?: string | null;
  platformClickId?: string | null;
}): Promise<void> {
  // GUARD: Reject orphan events without a valid campaign_id
  if (!data.campaignId || data.campaignId.trim() === '') {
    const eventType = data.isClick ? 'click' : 'impression';
    console.warn(`[STORE] Rejecting orphan ${eventType} - no campaign_id provided`, { eventId: data.eventId, sessionId: data.sessionId });
    return;
  }
  
  const eventType = data.isImpression && data.isClick ? 'impression+click' : data.isClick ? 'click' : 'impression';
  console.log(`[STORE] Storing ${eventType} for session`, data.sessionId, 'campaign', data.campaignId, 'eventId', data.eventId);
  
  // Store in PlanetScale events table
  await storeInPlanetScale({
    event_id: data.eventId,
    session_id: data.sessionId,
    campaign_id: data.campaignId,
    is_impression: data.isImpression,
    is_click: data.isClick,
    is_conversion: false,
    domain: data.domain || null,
    path: data.path,
    landing_page: data.landingPage || null,
    landing_page_mode: data.landingPageMode || null,
    ip: data.ip || null,
    country: data.country || null,
    city: data.city || null,
    continent: data.continent || null,
    latitude: data.latitude ? parseFloat(data.latitude) : null,
    longitude: data.longitude ? parseFloat(data.longitude) : null,
    region: data.region || null,
    region_code: data.regionCode || null,
    postal_code: data.postalCode || null,
    timezone: data.timezone || null,
    device: data.device || null,
    browser: data.browser || null,
    browser_version: data.browserVersion || null,
    os: data.os || null,
    os_version: data.osVersion || null,
    brand: data.brand || null,
    referrer: data.referrer || null,
    query_params: JSON.stringify(data.queryParams),
    rule_key: data.ruleKey,
    user_agent_raw: data.userAgentRaw || null,
    bot_score: data.botScore || null,
    asn: data.asn || null,
    as_organization: data.asOrganization || null,
    colo: data.colo || null,
    client_trust_score: data.clientTrustScore || null,
    http_protocol: data.httpProtocol || null,
    tls_version: data.tlsVersion || null,
    tls_cipher: data.tlsCipher || null,
    destination_url: data.destinationUrl || null,
    destination_id: data.destinationId || null,
    matched_flags: data.matchedFlags ? JSON.stringify(data.matchedFlags) : null,
    platform_id: data.platformId || null,
    platform_click_id: data.platformClickId || null,
    is_bot: data.isBot || false,
  });
}

export async function storeConversion(data: {
  conversionId: string;
  clickId: string;
  impressionId: string;
  sessionId: string;
  campaignId: string;
  payout: number;
  conversionType: string;
  postbackData: Record<string, string>;
}): Promise<void> {
  // Store conversion as event in PlanetScale
  console.log('[PSQL] inserting conversion', data.conversionId, 'for click', data.clickId);
  await storeInPlanetScale({
    event_id: data.conversionId,
    session_id: data.sessionId || null,
    campaign_id: data.campaignId || null,
    is_impression: false,
    is_click: false,
    is_conversion: true,
    click_id: data.clickId,  // Links to the click event
    payout: data.payout,
    conversion_type: data.conversionType,
    postback_data: JSON.stringify(data.postbackData),
    // Minimal metadata - most fields are null for conversions
    domain: null,
    path: null,
    query_params: null,
    rule_key: null,
  });
}

/**
 * Enrich an existing event with client-side detected data
 * This is called by the /t/enrich beacon endpoint
 */
export async function enrichEvent(impressionId: string, data: {
  screen?: string;
  dpr?: number;
  gpu?: string;
  tz?: string;
  model?: string;
  osVersion?: string;
  arch?: string;
}): Promise<void> {
  const hyperdrive = (env as any).HYPERDRIVE;
  if (!hyperdrive) {
    console.error('PlanetScale not configured - HYPERDRIVE binding not found');
    return;
  }
  
  try {
    const { Client } = await import('pg');
    const client = new Client({
      connectionString: hyperdrive.connectionString,
      ssl: { rejectUnauthorized: false }
    });
    await client.connect();
    
    try {
      console.log(`[PSQL] enriching event`, impressionId, data);
      
      await client.query(`
        UPDATE events 
        SET 
          screen_resolution = COALESCE($2, screen_resolution),
          device_pixel_ratio = COALESCE($3, device_pixel_ratio),
          gpu_renderer = COALESCE($4, gpu_renderer),
          client_timezone = COALESCE($5, client_timezone),
          device_model_guess = COALESCE($6, device_model_guess),
          os_version_client = COALESCE($7, os_version_client)
        WHERE event_id = $1
      `, [
        impressionId, 
        data.screen || null, 
        data.dpr || null, 
        data.gpu || null, 
        data.tz || null, 
        data.model || null,
        data.osVersion || null
      ]);
      
      await client.end();
    } catch (queryError: any) {
      await client.end();
      throw queryError;
    }
  } catch (error: any) {
    console.error(`Exception enriching event ${impressionId}:`, error.message);
  }
}

/**
 * Generates a fast redirect page with device detection
 * The beacon fires in parallel with the redirect (non-blocking)
 */
export function getRedirectWithDetection(impressionId: string, redirectUrl: string): string {
  // Minimal HTML that fires beacon and redirects simultaneously
  // sendBeacon is non-blocking so redirect happens immediately
  // Includes Chrome's high-entropy API for accurate OS version when available
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>(function(){var d={impressionId:'${impressionId}',screen:screen.width+'x'+screen.height,dpr:window.devicePixelRatio||1,tz:Intl.DateTimeFormat().resolvedOptions().timeZone};try{var c=document.createElement('canvas').getContext('webgl');if(c){var x=c.getExtension('WEBGL_debug_renderer_info');if(x)d.gpu=c.getParameter(x.UNMASKED_RENDERER_WEBGL);}}catch(e){}if(/iPhone/.test(navigator.userAgent)){var s=d.screen;if(s==='393x852')d.model=d.dpr===3?'iPhone 14/15 Pro':'iPhone 14/15';else if(s==='430x932')d.model='iPhone 14/15 Plus/Max';else if(s==='390x844')d.model='iPhone 12/13/14';else if(s==='428x926')d.model='iPhone 12/13 Pro Max';}if(navigator.userAgentData&&navigator.userAgentData.getHighEntropyValues){navigator.userAgentData.getHighEntropyValues(['platformVersion','model','architecture']).then(function(ua){d.osVersion=ua.platformVersion;d.model=d.model||ua.model;d.arch=ua.architecture;navigator.sendBeacon('/t/enrich',JSON.stringify(d));}).catch(function(){navigator.sendBeacon('/t/enrich',JSON.stringify(d));});}else{navigator.sendBeacon('/t/enrich',JSON.stringify(d));}location.href='${redirectUrl}';})()</script></body></html>`;
}

/**
 * Generates the minified JS snippet to detect device info and send it to the beacon
 */
export function getDeviceDetectionScript(impressionId: string): string {
  // We use a self-invoking function and navigator.sendBeacon for non-blocking reporting
  // Includes Chrome's high-entropy API for accurate OS version when available
  return `
<script>(function(){
  try {
    var d={
      impressionId:'${impressionId}',
      screen:screen.width+'x'+screen.height,
      dpr:window.devicePixelRatio||1,
      tz:Intl.DateTimeFormat().resolvedOptions().timeZone
    };
    var canvas=document.createElement('canvas');
    var gl=canvas.getContext('webgl')||canvas.getContext('experimental-webgl');
    if(gl){
      var debugInfo=gl.getExtension('WEBGL_debug_renderer_info');
      if(debugInfo) d.gpu=gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
    }
    if(/iPhone/.test(navigator.userAgent)){
      var s=d.screen;
      if(s==='393x852') d.model=d.dpr===3?'iPhone 14/15 Pro':'iPhone 14/15';
      else if(s==='430x932') d.model='iPhone 14/15 Plus/Max';
      else if(s==='390x844') d.model='iPhone 12/13/14';
      else if(s==='428x926') d.model='iPhone 12/13 Pro Max';
    }
    function send(){
      if(navigator.sendBeacon) navigator.sendBeacon('/t/enrich', JSON.stringify(d));
      else fetch('/t/enrich', {method:'POST',body:JSON.stringify(d),keepalive:true});
    }
    if(navigator.userAgentData&&navigator.userAgentData.getHighEntropyValues){
      navigator.userAgentData.getHighEntropyValues(['platformVersion','model','architecture']).then(function(ua){
        d.osVersion=ua.platformVersion;
        d.model=d.model||ua.model;
        d.arch=ua.architecture;
        send();
      }).catch(send);
    } else { send(); }
  } catch(e) {}
})();</script>`.replace(/\n\s*/g, '');
}

/**
 * Helper to inject the device detection script into an HTML response
 * Latency Optimized: Only injects when server-side signals are insufficient
 */
export function injectDeviceDetection(response: Response, data: RequestData): Response {
  if (!data.impressionId) return response;
  
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  // 1. Skip if it's a known bot (don't waste latency/resources)
  if (data.isBot || (data.botScore !== undefined && data.botScore !== null && data.botScore < 30)) {
    return response;
  }

  // 2. Skip for desktops with accurate OS version (desktops don't need model detection)
  const isDesktop = data.userAgent.device === 'desktop' || !data.userAgent.device;
  const hasAccurateOSVersion = data.userAgent.osVersion && data.userAgent.osVersion !== '10.15.7' && data.userAgent.osVersion !== '10.0';
  
  // 3. Always inject for Safari iOS (UA is useless for model detection)
  const isSafariIOS = (data.userAgent.browser === 'Safari' || data.userAgent.browser === 'Mobile Safari' || !data.userAgent.browser) && data.userAgent.os === 'iOS';
  
  // Skip injection for: Desktop with OS version, OR mobile with accurate signals (not Safari iOS)
  const skipInjection = isDesktop ? hasAccurateOSVersion : (hasAccurateOSVersion && !isSafariIOS);

  if (skipInjection) {
    return response;
  }
  
  return new HTMLRewriter()
    .on('body', {
      element(element) {
        element.append(getDeviceDetectionScript(data.impressionId!), { html: true });
      }
    })
    .transform(response);
}

// Query PlanetScale for click data (for postback lookup)
export async function getClickData(clickId: string): Promise<ClickDataResult | null> {
  const hyperdrive = (env as any).HYPERDRIVE;
  if (!hyperdrive) {
    console.error('PlanetScale not configured - HYPERDRIVE binding not found');
    return null;
  }

  try {
    const { Client } = await import('pg');
    const client = new Client({
      connectionString: hyperdrive.connectionString,
      ssl: { rejectUnauthorized: false }
    });
    await client.connect();

    try {
      // Query events table for click event
      const result = await client.query(
        `SELECT event_id, session_id, campaign_id, is_impression, platform_id, platform_click_id 
         FROM events 
         WHERE event_id = $1 AND is_click = true
         LIMIT 1`,
        [clickId]
      );
      await client.end();
      
      if (result.rows && result.rows.length > 0) {
        const row = result.rows[0];
        // For redirect campaigns: impression and click are same event_id
        // For folder/proxy campaigns: click is separate event, impression_id would be different
        return {
          click_id: row.event_id,
          impression_id: row.is_impression ? row.event_id : null,  // Same if redirect, null if separate click
          session_id: row.session_id,
          campaign_id: row.campaign_id,
          platform_id: row.platform_id || null,
          platform_click_id: row.platform_click_id || null,
        };
      }
      return null;
    } catch (queryError: any) {
      await client.end();
      throw queryError;
    }
  } catch (error: any) {
    console.error(`Exception querying PlanetScale for click ${clickId}:`, error.message);
    return null;
  }
}

// D1 Database functions for campaign lookups
async function getCampaignIdFromRuleKey(ruleKey: string): Promise<string | null> {
  try {
    const db = (env as any).DB; // D1 database binding
    if (!db) {
      console.error('D1 database not configured');
      return null;
    }

    const result = await db.prepare(
      'SELECT id FROM campaigns WHERE kv_key = ? LIMIT 1'
    ).bind(ruleKey).first() as { id: string } | null;

    return result?.id || null;
  } catch (error: any) {
    console.error(`Exception looking up campaign for rule key ${ruleKey}:`, error.message);
    return null;
  }
}

// Get user_id from campaign_id
async function getUserIdFromCampaignId(campaignId: string): Promise<string | null> {
  try {
    const db = (env as any).DB;
    if (!db || !campaignId) {
      return null;
    }

    const result = await db.prepare(
      'SELECT user_id FROM campaigns WHERE id = ? LIMIT 1'
    ).bind(campaignId).first() as { user_id: string } | null;

    return result?.user_id || null;
  } catch (error: any) {
    console.error(`Exception looking up user_id for campaign ${campaignId}:`, error.message);
    return null;
  }
}

// Convert display path to R2 key
// Display path: /DriveName/path/to/file.mp4
// R2 key: {userId}/DRIVE_DriveName/path/to/file.mp4
function buildR2Path(userId: string, displayPath: string): string {
  const pathParts = displayPath.split('/').filter(p => p);
  if (pathParts.length === 0) {
    return displayPath; // Can't parse, return as-is
  }
  const driveName = pathParts[0];
  const remainingPath = pathParts.slice(1).join('/');
  return remainingPath 
    ? `${userId}/DRIVE_${driveName}/${remainingPath}`
    : `${userId}/DRIVE_${driveName}`;
}

// In-memory cache for destination URLs (per-isolate, resets on deploy)
// Stores url, updated_at timestamp, and cache timestamp for invalidation
const destinationUrlCache = new Map<string, { url: string | null; updatedAt: number; cacheTimestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL (fallback)

// D1 Database function to lookup destination URL by UUID
// Cached to reduce D1 lookups, but invalidates immediately if destination was updated
async function getDestinationUrl(destinationId: string, c?: any): Promise<string | null> {
  try {
    const db = (env as any).DB; // D1 database binding
    if (!db) {
      console.error('D1 database not configured');
      return null;
    }

    // Check cache first
    const cached = destinationUrlCache.get(destinationId);
    if (cached) {
      // Fast path: if cache is very recent (< 100ms), use it without checking updated_at
      // This handles same-request scenarios (e.g., multiple rules using same destination)
      const cacheAge = Date.now() - cached.cacheTimestamp;
      if (cacheAge < 100) {
        return cached.url;
      }
      
      // Check if destination was updated since we cached it
      // This ensures changes apply immediately (within ~100ms)
      // Lightweight query - only fetches updated_at (single integer field)
      const currentUpdatedAt = await db.prepare(
        'SELECT updated_at FROM destinations WHERE id = ? LIMIT 1'
      ).bind(destinationId).first() as { updated_at: number } | null;
      
      if (currentUpdatedAt && currentUpdatedAt.updated_at === cached.updatedAt) {
        // Destination hasn't changed, use cache and refresh cache timestamp
        cached.cacheTimestamp = Date.now();
        return cached.url;
      }
      // Destination was updated, cache is invalid - will refetch below
    }

    // Fetch fresh data (either cache miss or cache invalidated)
    const result = await db.prepare(
      'SELECT url, updated_at FROM destinations WHERE id = ? AND status = ? LIMIT 1'
    ).bind(destinationId, 'active').first() as { url: string; updated_at: number } | null;

    const url = result?.url || null;
    const updatedAt = result?.updated_at || 0;
    
    // Cache the result with updated_at timestamp for future invalidation checks
    destinationUrlCache.set(destinationId, { 
      url, 
      updatedAt, 
      cacheTimestamp: Date.now() 
    });

    return url;
  } catch (error: any) {
    console.error(`Exception looking up destination URL for ${destinationId}:`, error.message);
    // Cache null result to avoid repeated failures
    destinationUrlCache.set(destinationId, { 
      url: null, 
      updatedAt: 0, 
      cacheTimestamp: Date.now() 
    });
    return null;
  }
}

export interface RuleFlags {
  country?: string | string[];      // Country code(s) that must match (OR if array)
  language?: string | string[];     // Browser language(s) (OR if array)
  time?: {
    start: number;       // UTC hour (0-23) or decimal (e.g., 9.5 = 9:30)
    end: number;         // UTC hour (0-23) or decimal (e.g., 17.5 = 17:30)
  };
  params?: {             // URL parameters that must all match (AND)
    [key: string]: string;
  };
  device?: string | string[];       // Device type(s)
  browser?: string | string[];      // Browser(s)
  os?: string | string[];          // OS name(s) (substring match)
  brand?: string | string[];       // Device brand(s)
  region?: string | string[];      // Region/state code(s)
  org?: string | string[];         // Organization wildcard(s)
  city?: string | string[];        // City name(s)
  continent?: string | string[];   // Continent(s)
  asn?: number | number[];         // ASN or list of ASNs
  colo?: string | string[];        // Cloudflare datacenter(s)
  ip?: string | string[];          // IP(s), range(s), or CIDR(s)
}

/**
 * Delivery mode for destinations:
 * - 'hosted': Serve from local assets on the platform (folder path like "campaigns/offer1")
 * - 'proxy': Fetch and serve from external URL (address bar unchanged, cloaked)
 * - 'redirect': HTTP 302 redirect to external URL with macro replacement
 */
export type DestinationMode = 'hosted' | 'proxy' | 'redirect';

export interface Destination {
  id: string;
  value: string;           // Folder path or URL
  weight: number;          // Traffic weight (1-100)
  mode?: DestinationMode;  // How to serve this destination (inferred from value if not set)
}

export interface Rule {
  flags?: RuleFlags;     // Conditions to match (legacy single-group)
  groups?: RuleFlags[];  // OR of groups; within each group, flags AND
  
  // --- ONE of the following actions ---
  folder?: string;           // ACTION 1 (legacy): Serve a page you uploaded to our platform.
  modifications?: Modification[]; // ACTION 2: Modify the user's current page.
  redirectUrl?: string;      // ACTION 3 (legacy): Redirect the user to a different URL.
  proxyUrl?: string;         // ACTION 4 (legacy): Seamlessly serve a different page (address bar does NOT change)
  fetchUrl?: string;         // Legacy alias for proxyUrl (backward compatibility)
  destinations?: Destination[];  // ACTION 5 (modern): Multiple weighted destinations with explicit mode
  // ---

  // --- Click-out handling (for paths ending with /click) ---
  clickUrl?: string;         // Single URL to redirect to when path ends with /click (backward compat, no D1 lookup)
  clickDestinations?: Array<{ // Multiple weighted click-out destinations (weighted split)
    id: string;              // Destination UUID (lookup URL from D1)
    weight: number;         // Relative weight (doesn't need to sum to 100)
    // NOTE: URL is stored in D1 destinations table, not in KV
  }>;
  // ---

  variables?: Record<string, string>; // Optional macros to replace in HTML
  operator?: 'AND' | 'OR'; // How to combine multiple flags (NOT YET IMPLEMENTED - always uses AND)
  weight?: number;      // Traffic split percentage (1-100) - used when multiple rules match
}

export interface Modification {
  selector: string; // CSS selector (e.g., '#headline', '.cta-button')
  action: 'setText' | 'setHtml' | 'setCss' | 'setAttribute' | 'remove';
  value: string | Record<string, string>; // The new content, style, or attribute
}

export interface KVRule {
  id?: string;                  // Campaign ID (UUIDv7) - stored in KV for fast tracking
  name?: string;                 // Campaign name (denormalized from D1 for macro access)
  siteName?: string;             // Site name (optional, denormalized from D1)
  rules: Rule[];                // List of rules to check in order
  defaultFolder?: string;       // Default folder/URL if no rules match (mutually exclusive with destinationId)
  destinationId?: string;        // Destination ID to lookup from D1 (mutually exclusive with defaultFolder)
  defaultFolderMode?: 'hosted' | 'proxy' | 'redirect';  // How to serve defaultFolder:
                                // 'hosted' = serve from local assets (default for paths without http)
                                // 'proxy' = fetch and serve from external URL (address bar unchanged)
                                // 'redirect' = HTTP redirect to external URL with macro replacement
  variables?: Record<string, string>; // Default macros for default folder
  blocks?: BlockRules;         // Blocking rules (always serve defaultFolder)
  // New array-based default destinations (takes precedence over single defaultFolder/destinationId)
  defaultDestinations?: Array<{
    id: string;
    value: string;  // folder path or URL
    weight: number;
    mode?: 'hosted' | 'proxy' | 'redirect';
    offers?: Array<{ id: string; weight: number }>;  // nested offers per LP
  }>;
  defaultOffers?: Array<{ id: string; weight: number }>;  // direct offers (no LP)
}

export interface RequestData {
  domain: string | null;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  ip: string | null;
  org: string | null;
  referrer?: string | null;
  isEmbedRequest?: boolean;
  sessionId?: string;      // Fingerprint-based stable ID (generated per request)
  impressionId?: string;   // Unique ID for page view (generated per request)
  botScore?: number | null; // Cloudflare Bot Management Score (1-99) - Enterprise only
  isVerifiedBot?: boolean; // Cloudflare Verified Bot (Googlebot, etc.) - Pro+
  clientTrustScore?: number | null; // Cloudflare Threat Score (0-100) - Pro+
   userAgent: {
     browser: string | null;    // "Chrome", "Firefox", "Bot", "Facebook Bot", etc
     browserVersion: string | null;
     os: string | null;        // "Windows", "iOS", etc
     osVersion: string | null;
     device: string | null;    // "Mobile", "Desktop", "Tablet"
     brand: string | null;     // "Apple", "Samsung", "Huawei", etc
     model: string | null;     // Device model (e.g., "iPhone", "Pixel 5")
     arch: string | null;      // CPU architecture (e.g., "arm64", "x86_64")
     raw: string | null;       // Full user-agent string (can derive model/arch from this)
   };
  isBot?: boolean;            // Bot detection flag (from isbot library) - optional, can also filter by browser containing "Bot"
  geo: {
    country: string | null;
    city: string | null;
    continent: string | null;
    latitude: string | null;
    longitude: string | null;
    region: string | null;    // State/province
    regionCode: string | null;
    timezone: string | null;
    postalCode?: string | null; // Added for postal/zip code
  };
  cf: {
    asn: number | null;       // AS number
    asOrganization: string | null;
    colo: string | null;      // Cloudflare datacenter
    clientTrustScore: number | null;
    httpProtocol: string | null;
    tlsVersion: string | null;
    tlsCipher: string | null;
  };
}

export interface ExtendedRequestData extends RequestData {
  isEmbedRequest?: boolean;
}

async function serveRemoteFile(c: any, url: string, data: RequestData, reason: string, variables?: Record<string, string>): Promise<Response> {
  console.log("SERVE_REMOTE_FILE_CALLED: url=", url, "reason=", reason);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': '*/*' }
    });

    if (!response.ok) {
      console.error(`Error fetching remote URL ${url}: ${response.statusText}`);
      return new Response(`Error: Could not fetch remote content (${response.status})`, { status: response.status });
    }

    let content = await response.text();
    const allReplaceableVariables = populateMacros(data, variables);

    content = replaceMacros(content, allReplaceableVariables);

    const newHeaders = new Headers(response.headers);
    addAcceptCHHeaders(newHeaders);
    const finalResponse = new Response(content, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
    
    return injectDeviceDetection(finalResponse, data);
  } catch (error: any) {
    console.error(`Exception fetching remote URL ${url}: ${error.message}`);
    return new Response("Error: Exception during remote content serving.", { status: 500 });
  }
}

async function serveAsJavaScript(c: any, data: ExtendedRequestData, reason: string, ruleVariables: Record<string, string> | undefined, options: { targetFolder?: string, fetchUrl?: string }): Promise<Response> {
  let content: string;
  let response: Response | undefined;

  const allReplaceableVariables = populateMacros(data, ruleVariables);

  if (options.targetFolder) {
    if (options.targetFolder.startsWith('http')) {
      const proxyData = { ...data, path: '/' };
      response = await handleInitialProxyRequest(c, options.targetFolder, proxyData, `JS Embed: ${reason}`, ruleVariables);
      content = await response.text();
    } else {
      const normalizedBaseDir = options.targetFolder.replace(/^\/+/, '').replace(/\/+$/, '');
      const fullAssetPath = `${normalizedBaseDir}/index.html`;
      try {
        const assetUrl = new URL(`/${fullAssetPath}`, c.req.url);
        const assetRequest = new Request(assetUrl.toString());
        const assetResponse = await env.ASSETS.fetch(assetRequest);
        if (!assetResponse.ok) throw new Error(`Asset not found: ${fullAssetPath}`);
        content = await assetResponse.text();
        content = replaceMacros(content, allReplaceableVariables);
      } catch (e: any) {
        console.error(`JS Embed: Failed to serve public file ${fullAssetPath}: ${e.message}`);
        content = `<h1>Error: Content not available</h1>`;
      }
    }
  } else if (options.fetchUrl) {
    response = await serveRemoteFile(c, options.fetchUrl, data, `JS Embed: ${reason}`, ruleVariables);
    content = await response.text();
  } else {
    const noContentHeaders = new Headers({ 'Content-Type': 'application/javascript' });
    addAcceptCHHeaders(noContentHeaders);
    return new Response("/* Tracked: No content to serve. */", { headers: noContentHeaders });
  }

  const contentType = response ? response.headers.get('content-type') || '' : 'text/html';

  if (contentType.includes('javascript')) {
    const headers = new Headers({ 'Content-Type': 'application/javascript; charset=utf-8' });
    addAcceptCHHeaders(headers);
    return new Response(content, { headers });
  }

  const escapedContent = JSON.stringify(content);
  const jsPayload = `
    (function() {
      try {
        document.open('text/html', 'replace');
        document.write(${escapedContent});
        document.close();
      } catch (e) {
        console.error('Tracked script failed:', e);
      }
    })();
  `;

  const jsHeaders = new Headers({ 'Content-Type': 'application/javascript; charset=utf-8' });
  addAcceptCHHeaders(jsHeaders);
  return new Response(jsPayload, { headers: jsHeaders });
}

// Helper function to serve a local file from /public
async function servePublicFile(c: any, baseDir: string, data: RequestData, reason: string, variables?: Record<string, string>, campaignId?: string): Promise<Response> {
  console.log("SERVE_PUBLIC_FILE_CALLED: baseDir=", baseDir, "path=", data.path, "reason=", reason);
  
  // Normalize the base directory: remove leading/trailing slashes for consistency
  let normalizedBaseDir = baseDir.replace(/^\/+/, '').replace(/\/+$/, '');
  const cleanBaseLastSegment = normalizedBaseDir.split('?')[0].split('#')[0];

  // Helper: get extension of a path
  const getExt = (p: string): string => {
    const last = p.split('/').pop() || '';
    const parts = last.split('.');
    if (parts.length <= 1) return '';
    return parts.pop()!.toLowerCase();
  };

  // If baseDir points to a specific file (e.g., folder/file.html or asset.svg), serve it directly
  const baseExt = getExt(cleanBaseLastSegment);
  const KNOWN_FILE_EXTS = new Set([
    'html','htm','css','js','mjs','jsx','ts','tsx','svg','png','jpg','jpeg','gif','webp','ico','json','map','woff','woff2','ttf','otf','eot','mp4','webm','ogg','mp3','wav','pdf','txt','xml','csv','wasm','zip','gz','br','avif','heic','webmanifest'
  ]);
  if (baseExt && KNOWN_FILE_EXTS.has(baseExt)) {
    const fullAssetPath = normalizedBaseDir; // exact file path under ASSETS
    try {
      const assetUrl = new URL(`/${fullAssetPath}`, c.req.url);
      const assetRequest = new Request(assetUrl.toString(), { method: 'GET', headers: { 'Accept': '*/*' } });
      const assetResponse = await env.ASSETS.fetch(assetRequest);
      if (!assetResponse.ok) {
        // Try R2
        const driveUs = (env as any).DRIVE_US;
        if (driveUs && campaignId) {
          try {
            const userId = await getUserIdFromCampaignId(campaignId);
            if (userId) {
              const r2Path = buildR2Path(userId, fullAssetPath);
              console.log(`R2 lookup: ${r2Path}`);
              const r2Object = await driveUs.get(r2Path);
              if (r2Object) {
                const r2Headers = new Headers();
                const ext = fullAssetPath.split('.').pop()?.toLowerCase();
                const contentTypeMap: Record<string, string> = {
                  'html': 'text/html',
                  'htm': 'text/html',
                  'css': 'text/css',
                  'js': 'application/javascript',
                  'json': 'application/json',
                  'png': 'image/png',
                  'jpg': 'image/jpeg',
                  'jpeg': 'image/jpeg',
                  'gif': 'image/gif',
                  'svg': 'image/svg+xml',
                  'webp': 'image/webp',
                  'mp4': 'video/mp4',
                  'webm': 'video/webm',
                  'mp3': 'audio/mpeg',
                  'woff': 'font/woff',
                  'woff2': 'font/woff2',
                };
                if (ext && contentTypeMap[ext]) {
                  r2Headers.set('Content-Type', contentTypeMap[ext]);
                }
                if (r2Object.httpMetadata?.contentType) {
                  r2Headers.set('Content-Type', r2Object.httpMetadata.contentType);
                }
                if (r2Object.httpMetadata?.cacheControl) {
                  r2Headers.set('Cache-Control', r2Object.httpMetadata.cacheControl);
                }
                addAcceptCHHeaders(r2Headers);
                
                // Handle macro replacement for HTML/CSS
                const contentType = r2Headers.get('content-type') || '';
                if (contentType.includes('text/html') || contentType.includes('text/css')) {
                  const content = await r2Object.text();
                  const allReplaceableVariables = populateMacros(data, variables);
                  const replacedContent = replaceMacros(content, allReplaceableVariables);
                  const r2Response = new Response(replacedContent, { headers: r2Headers });
                  return injectDeviceDetection(r2Response, data);
                }
                
                return new Response(r2Object.body, { headers: r2Headers });
              }
            }
          } catch (r2Error: any) {
            console.error(`R2 error: ${r2Error.message}`);
          }
        }
        return serveNotFoundPage(c, data, `Asset not found: ${fullAssetPath}`);
      }
      // Macro replacement for HTML/CSS
      if (fullAssetPath.endsWith('.html') || fullAssetPath.endsWith('.htm') || fullAssetPath.endsWith('.css')) {
        let content = await assetResponse.text();
        const allReplaceableVariables = populateMacros(data, variables);
        content = replaceMacros(content, allReplaceableVariables);
        const newHeaders = new Headers(assetResponse.headers);
        const htmlResponse = new Response(content, { status: assetResponse.status, statusText: assetResponse.statusText, headers: newHeaders });
        return injectDeviceDetection(htmlResponse, data);
      }
      return new Response(assetResponse.body, { status: assetResponse.status, statusText: assetResponse.statusText, headers: assetResponse.headers });
    } catch (e) {
      return serveNotFoundPage(c, data, `Exception serving exact file: ${fullAssetPath}`);
    }
  }
  
  // Get the requested path and remove any leading slash
  let requestedPath = data.path.replace(/^\/+/, '');
  if (requestedPath === '' || data.path === '/') { // Handle root path explicitly
    requestedPath = 'index.html';
  } else {
    // If the path looks like a directory or a non-asset extension, serve its index.html
    const ASSET_EXTENSIONS = new Set([
      'css','js','mjs','jsx','ts','tsx','png','jpg','jpeg','gif','svg','webp','ico','json','map','woff','woff2','ttf','otf','eot','mp4','webm','ogg','mp3','wav','pdf','txt','xml','csv','wasm','zip','gz','br','avif','heic','webmanifest'
    ]);
    const getPathExtension = (p: string): string => {
      const clean = p.split('?')[0].split('#')[0];
      const lastSegment = clean.split('/').pop() || '';
      const parts = lastSegment.split('.');
      if (parts.length <= 1) return '';
      return parts.pop()!.toLowerCase();
    };
    const ext = getPathExtension(requestedPath);
    const endsWithSlash = requestedPath.endsWith('/');
    const isHtml = requestedPath.endsWith('.html') || requestedPath.endsWith('.htm');
    // If path already ends with .html/.htm, serve it directly - don't append /index.html
    // Only append /index.html for directory-like paths (no extension or non-asset extension)
    const isLikelyDirectory = ext === '' || (ext && !ASSET_EXTENSIONS.has(ext) && !isHtml);
    if (isLikelyDirectory) {
      requestedPath = endsWithSlash ? `${requestedPath}index.html` : `${requestedPath}/index.html`;
    }
  }
  
  // Construct the full asset path
  const fullAssetPath = normalizedBaseDir ? `${normalizedBaseDir}/${requestedPath}` : requestedPath;
  
  // Only log main page requests, not assets
  if (data.path === '/' || data.path === '/index.html') {
    console.log(JSON.stringify({
      message: `Serving page: ${reason}`,
      timestamp: new Date().toISOString(),
      ip: data.ip,
      org: data.org,
      referrer: data.referrer,
      userAgent: data.userAgent,
      geo: data.geo,
      cf: data.cf,
      domain: data.domain,

      path: data.path,
      query: data.query
    }));
  }

  try {
    // Create a new request for the asset path
    const assetUrl = new URL(`/${fullAssetPath}`, c.req.url);
    const assetRequest = new Request(assetUrl.toString(), {
      method: 'GET',
      headers: { 'Accept': '*/*' }
    });

    const assetResponse = await env.ASSETS.fetch(assetRequest);

    if (!assetResponse.ok) {
      // Try to serve from the same folder as the main page
      // For alternateAssetPath, data.path still has its leading slash if not root.
      // We need a clean combination here too.
      let alternateRequestedPath = data.path.startsWith('/') ? data.path.substring(1) : data.path;
      if (alternateRequestedPath === '' || data.path === '/') {
        alternateRequestedPath = 'index.html'; // Should not happen if main page already failed, but good for safety.
      }
      const alternateAssetPath = normalizedBaseDir ? `${normalizedBaseDir}/${alternateRequestedPath}` : alternateRequestedPath;
      
      const alternateAssetUrl = new URL(`/${alternateAssetPath}`, c.req.url);
      const alternateAssetRequest = new Request(alternateAssetUrl.toString(), {
        method: 'GET',
        headers: { 'Accept': '*/*' }
      });

      const alternateAssetResponse = await env.ASSETS.fetch(alternateAssetRequest);
      
      if (!alternateAssetResponse.ok) {
        // Generic fallback for any folder structure - try common asset directory patterns
        const fileName = alternateRequestedPath.split('/').pop() || alternateRequestedPath;
        const originalDir = alternateRequestedPath.includes('/') ? alternateRequestedPath.split('/')[0] : '';
        
        // Common asset directory names to try as fallbacks
        const fallbackDirs = [
          'index_files',
          'assets', 
          'static',
          'files',
          'resources',
          '_files',
          'content',
          '', // Try directly in base folder
        ];
        
                 // If original was in a subdirectory, also try other common names for that type
         if (originalDir) {
           const dirMappings: Record<string, string[]> = {
             'css': ['styles', 'style', 'stylesheets'],
             'js': ['scripts', 'script', 'javascript'],
             'img': ['images', 'image', 'pics', 'pictures'],
             'font': ['fonts', 'typeface', 'css'],
             'fonts': ['font', 'typeface', 'css'], // handle plural key
             'media': ['video', 'audio']
           };
           
           if (originalDir in dirMappings) {
             fallbackDirs.unshift(...dirMappings[originalDir]);
           }
         }
        
        // Try each fallback directory
        for (const fallbackDir of fallbackDirs) {
          let fallbackPath;
          
          if (fallbackDir === '') {
            // Try file directly in base directory
            fallbackPath = fileName;
          } else if (originalDir && fallbackDir !== 'index_files') {
            // Keep original subdirectory structure but change parent dir
            fallbackPath = alternateRequestedPath.replace(originalDir, fallbackDir);
          } else {
            // Put file in fallback directory
            fallbackPath = `${fallbackDir}/${fileName}`;
          }
          
          const fallbackAssetPath = `${normalizedBaseDir}/${fallbackPath}`;
          const fallbackAssetUrl = new URL(`/${fallbackAssetPath}`, c.req.url);
          const fallbackAssetRequest = new Request(fallbackAssetUrl.toString(), {
            method: 'GET',
            headers: { 'Accept': '*/*' }
          });

          try {
            const fallbackAssetResponse = await env.ASSETS.fetch(fallbackAssetRequest);
            
            if (fallbackAssetResponse.ok) {
              console.log(`Asset found via fallback: ${alternateRequestedPath} → ${fallbackPath}`);
              return new Response(fallbackAssetResponse.body, {
                status: fallbackAssetResponse.status,
                statusText: fallbackAssetResponse.statusText,
                headers: fallbackAssetResponse.headers,
              });
            }
          } catch (e) {
            // Continue to next fallback
            continue;
          }
        }
        
        console.error(`Error serving asset ${fullAssetPath} and ${alternateAssetPath} - tried all fallbacks`);
        
        // Try R2
        const driveUs = (env as any).DRIVE_US;
        if (driveUs && campaignId) {
          try {
            const userId = await getUserIdFromCampaignId(campaignId);
            if (userId) {
              const r2Path = buildR2Path(userId, fullAssetPath);
              console.log(`R2 lookup: ${r2Path}`);
              const r2Object = await driveUs.get(r2Path);
              if (r2Object) {
                const r2Headers = new Headers();
                const ext = fullAssetPath.split('.').pop()?.toLowerCase();
                const contentTypeMap: Record<string, string> = {
                  'html': 'text/html',
                  'htm': 'text/html',
                  'css': 'text/css',
                  'js': 'application/javascript',
                  'json': 'application/json',
                  'png': 'image/png',
                  'jpg': 'image/jpeg',
                  'jpeg': 'image/jpeg',
                  'gif': 'image/gif',
                  'svg': 'image/svg+xml',
                  'webp': 'image/webp',
                  'mp4': 'video/mp4',
                  'webm': 'video/webm',
                  'mp3': 'audio/mpeg',
                  'woff': 'font/woff',
                  'woff2': 'font/woff2',
                };
                if (ext && contentTypeMap[ext]) {
                  r2Headers.set('Content-Type', contentTypeMap[ext]);
                }
                if (r2Object.httpMetadata?.contentType) {
                  r2Headers.set('Content-Type', r2Object.httpMetadata.contentType);
                }
                if (r2Object.httpMetadata?.cacheControl) {
                  r2Headers.set('Cache-Control', r2Object.httpMetadata.cacheControl);
                }
                addAcceptCHHeaders(r2Headers);
                
                const contentType = r2Headers.get('content-type') || '';
                if (contentType.includes('text/html') || contentType.includes('text/css')) {
                  const content = await r2Object.text();
                  const allReplaceableVariables = populateMacros(data, variables);
                  const replacedContent = replaceMacros(content, allReplaceableVariables);
                  const r2Response = new Response(replacedContent, { headers: r2Headers });
                  return injectDeviceDetection(r2Response, data);
                }
                
                return new Response(r2Object.body, { headers: r2Headers });
              }
            }
          } catch (r2Error: any) {
            console.error(`R2 error: ${r2Error.message}`);
          }
        }
        
        if (data.path === '/error.html') {
          // To prevent an infinite loop if error.html is missing, we stop here.
          return new Response('Not Found, and the error page is also missing.', { status: 500 });
        }
        return serveNotFoundPage(c, data, `Asset not found: ${fullAssetPath}`);
      }

      // Handle macro replacement for HTML and CSS content
      // Check content-type directly to handle extensionless paths like /redesign
      const contentType = alternateAssetResponse.headers.get('content-type') || '';
      if (contentType.includes('text/html') || contentType.includes('text/css')) {
        let content = await alternateAssetResponse.text();
        
        const allReplaceableVariables = populateMacros(data, variables);

        content = replaceMacros(content, allReplaceableVariables);
        
        const newHeaders = new Headers(alternateAssetResponse.headers);
        const altResponse = new Response(content, {
          status: alternateAssetResponse.status,
          statusText: alternateAssetResponse.statusText,
          headers: newHeaders,
        });
        return injectDeviceDetection(altResponse, data);
      }

      return new Response(alternateAssetResponse.body, {
        status: alternateAssetResponse.status,
        statusText: alternateAssetResponse.statusText,
        headers: alternateAssetResponse.headers,
      });
    }

    // Handle macro replacement for HTML and CSS content
    // Check content-type directly to handle extensionless paths like /redesign
    const contentType = assetResponse.headers.get('content-type') || '';
    if (contentType.includes('text/html') || contentType.includes('text/css')) {
      let content = await assetResponse.text();
      
      const allReplaceableVariables = populateMacros(data, variables);

      content = replaceMacros(content, allReplaceableVariables);
      
      const newHeaders = new Headers(assetResponse.headers);
      const finalAssetResponse = new Response(content, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers: newHeaders,
      });
      return injectDeviceDetection(finalAssetResponse, data);
    }

    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers: assetResponse.headers,
    });
  } catch (error: any) {
    console.error(`Exception serving asset ${fullAssetPath}: ${error.message}`);
    return new Response("Error: Exception during asset serving.", { status: 500 });
  }
}

function rewriteUrl(url: string, baseUrl: string): string {
    // Now just ensures the URL is absolute to the remote origin.
    return new URL(url, baseUrl).href;
}

// This function handles the initial request to a remote site, rewriting the HTML.
async function handleInitialProxyRequest(c: any, baseUrl: string, data: RequestData, reason: string, variables?: Record<string, string>): Promise<Response> {
  console.log("PROXY_REMOTE_REQUEST_CALLED: baseUrl=", baseUrl, "path=", data.path, "reason=", reason);

  try {
    // For external URLs (http/https), use the destination URL as-is (don't append the campaign path)
    // The campaign path is specific to the campaign domain, not the destination domain
    // If destination is "https://cnn.com/us", proxy that exact URL
    // If destination is "https://cnn.com", proxy the root "/"
    // For relative/local paths, use the request path
    const isExternalUrl = baseUrl.startsWith('http://') || baseUrl.startsWith('https://');
    let targetUrl: URL;
    if (isExternalUrl) {
      // Use the destination URL directly (preserves any path in the destination)
      // Don't append the campaign path - it's specific to the campaign domain
      targetUrl = new URL(baseUrl);
    } else {
      // Relative/local path, use the request path
      targetUrl = new URL(data.path, baseUrl);
    }
    // Preserve query params from the original request
    targetUrl.search = new URL(c.req.raw.url).search;

    const remoteRequest = new Request(targetUrl.toString(), {
      method: c.req.method,
      headers: c.req.headers,
      body: c.req.body,
      redirect: 'follow'
    });
    
    remoteRequest.headers.delete('host');

    const remoteResponse = await fetch(remoteRequest);
    const contentType = remoteResponse.headers.get('content-type') || '';

    // For HTML content, we need to rewrite asset URLs to be proxied
    if (contentType.includes('text/html')) {
        const rewriter = new HTMLRewriter()
            .on('a, link, iframe, form, embed', {
                element(element) {
                    const attributeMap = {
                        'a': 'href', 'link': 'href', 'iframe': 'src',
                        'form': 'action', 'embed': 'src'
                    };
                    const attribute = attributeMap[element.tagName as keyof typeof attributeMap];
                    if (attribute) {
                        const value = element.getAttribute(attribute);
                        if (value && !value.startsWith('mailto:') && !value.startsWith('tel:') && !value.startsWith('#')) {
                            element.setAttribute(attribute, rewriteUrl(value, baseUrl));
                        }
                    }
                },
            })
            .on('img, script, video, audio, source', {
                element(element) {
                    const src = element.getAttribute('src');
                    if (src) element.setAttribute('src', rewriteUrl(src, baseUrl));
                    
                    const poster = element.getAttribute('poster');
                    if (poster) element.setAttribute('poster', rewriteUrl(poster, baseUrl));

                    const srcset = element.getAttribute('srcset');
                    if (srcset) {
                        const newSrcset = srcset.split(',').map(part => {
                            const [url, descriptor] = part.trim().split(/\s+/);
                            return `${rewriteUrl(url, baseUrl)} ${descriptor || ''}`.trim();
                        }).join(', ');
                        element.setAttribute('srcset', newSrcset);
                    }
                },
            })
            .on('*', {
                 element(element) {
                    const style = element.getAttribute('style');
                    if (style) {
                        const newStyle = style.replace(/url\(([^)]+)\)/g, (match, url) => {
                            const trimmedUrl = url.trim().replace(/['"]/g, '');
                            return `url(${rewriteUrl(trimmedUrl, baseUrl)})`;
                        });
                        element.setAttribute('style', newStyle);
                    }
                }
            })
            .on('body', {
                element(element) {
                    // Latency optimization: skip injection for bots or if server signals are sufficient
                    const injected = injectDeviceDetection(new Response("", { headers: { 'content-type': 'text/html' } }), data);
                    if (injected.body && data.impressionId) {
                        element.append(getDeviceDetectionScript(data.impressionId), { html: true });
                    }
                }
            });

        const rewrittenResponse = rewriter.transform(remoteResponse);

        let bodyText = await rewrittenResponse.text();
        const allReplaceableVariables = populateMacros(data, variables);
        bodyText = replaceMacros(bodyText, allReplaceableVariables);

        const newHeaders = new Headers(remoteResponse.headers);
        newHeaders.delete('content-length');
        newHeaders.delete('content-security-policy');
        newHeaders.delete('strict-transport-security');

        return new Response(bodyText, {
            status: remoteResponse.status,
            statusText: remoteResponse.statusText,
            headers: newHeaders,
        });
    }
    
    return new Response(remoteResponse.body, {
      status: remoteResponse.status,
      statusText: remoteResponse.statusText,
      headers: remoteResponse.headers,
    });
  } catch (error: any) {
    console.error(`Exception during proxy request to ${baseUrl}: ${error.message}`);
    return new Response("Error: Exception during proxy request.", { status: 500 });
  }
}

// This function fetches and streams a single asset, rewriting CSS if necessary.
// Client Hints header to request high-entropy hints from browsers
const ACCEPT_CH_HEADER = 'sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, sec-ch-ua-platform-version, sec-ch-ua-full-version-list, sec-ch-ua-model, sec-ch-ua-arch';

// Helper to add Accept-CH header to any response
function addAcceptCHHeaders(headers: Headers): Headers {
  headers.set('Accept-CH', ACCEPT_CH_HEADER);
  return headers;
}

// Helper to check if browser is an in-app browser (Facebook, Instagram, TikTok, etc.)
export function isInAppBrowser(browser: string | null): boolean {
  if (!browser) return false;
  const inAppBrowsers = ['Facebook', 'Instagram', 'TikTok', 'Snapchat', 'Pinterest', 'Twitter', 'LINE', 'WeChat', 'Telegram'];
  return inAppBrowsers.includes(browser);
}

export async function fetchAndStreamAsset(c: any, targetUrl: string, baseUrl: string): Promise<Response> {
    const remoteRequest = new Request(targetUrl, {
        method: c.req.method,
        headers: c.req.headers,
        body: c.req.body,
        redirect: 'follow'
    });
    remoteRequest.headers.delete('host');

    const remoteResponse = await fetch(remoteRequest);
    const contentType = remoteResponse.headers.get('content-type') || '';

    if (contentType.includes('text/css')) {
        let cssText = await remoteResponse.text();
        const newCss = cssText.replace(/url\(([^)]+)\)/g, (match, url) => {
            const trimmedUrl = url.trim().replace(/['"]/g, '');
            // We use targetUrl as the base for resolving relative paths within the CSS file.
            return `url(${new URL(trimmedUrl, targetUrl).href})`;
        });

        const newHeaders = new Headers(remoteResponse.headers);
        newHeaders.delete('content-length');
        addAcceptCHHeaders(newHeaders);

        return new Response(newCss, {
            status: remoteResponse.status,
            statusText: remoteResponse.statusText,
            headers: newHeaders,
        });
    }

    const newHeaders = new Headers(remoteResponse.headers);
    newHeaders.set('Access-Control-Allow-Origin', '*');
    newHeaders.delete('Content-Security-Policy');
    newHeaders.delete('Strict-Transport-Security');
    addAcceptCHHeaders(newHeaders);

    return new Response(remoteResponse.body, {
        status: remoteResponse.status,
        statusText: remoteResponse.statusText,
        headers: newHeaders,
    });
}

interface MacroContext {
  campaignId?: string;
  campaignName?: string;  // Campaign name (denormalized from D1, stored in KV)
  siteName?: string;      // Site name (optional, denormalized from D1)
  clickId?: string;
  impressionId?: string;
  sessionId?: string;
  platformId?: string;    // Platform ID (e.g., UUID for Meta)
  platformName?: string;  // Platform name (e.g., "Meta Ads")
  platformClickId?: string; // Platform click ID value (e.g., the actual fbclid value)
}

function populateMacros(data: RequestData, variables?: Record<string, string>, context?: MacroContext): Record<string, string> {
    const allReplaceableVariables: Record<string, string> = { ...(variables || {}) };

    // Add variable with multiple case variants for maximum compatibility
    const addVariable = (key: string, value: string | number | null | undefined) => {
        const strValue = (value === null || value === undefined) ? '' : String(value);
        allReplaceableVariables[key] = strValue;
        // Also add lowercase version for case-insensitive matching
        allReplaceableVariables[key.toLowerCase()] = strValue;
    };

    // Campaign & Tracking IDs
    addVariable('campaign.id', context?.campaignId);
    addVariable('campaign.ID', context?.campaignId);  // Alias
    addVariable('campaign.name', context?.campaignName);
    addVariable('campaign.NAME', context?.campaignName);  // Alias
    addVariable('site.name', context?.siteName);
    addVariable('site.NAME', context?.siteName);  // Alias
    addVariable('click.id', context?.clickId);
    addVariable('click.ID', context?.clickId);  // Alias
    addVariable('impression.id', context?.impressionId);
    addVariable('impression.ID', context?.impressionId);  // Alias
    addVariable('session.id', context?.sessionId);
    addVariable('session.ID', context?.sessionId);  // Alias
    
    // Platform info
    addVariable('platform.id', context?.platformId);
    addVariable('platform.name', context?.platformName);
    addVariable('platform.click_id', context?.platformClickId);

    // User/Visitor Data - add both UPPER and lower case variants
    addVariable('user.IP', data.ip);
    addVariable('user.ip', data.ip);  // lowercase alias
    addVariable('user.CITY', data.geo.city);
    addVariable('user.city', data.geo.city);  // lowercase alias
    addVariable('user.City', data.geo.city);  // Title case alias
    addVariable('user.COUNTRY', data.geo.country);
    addVariable('user.country', data.geo.country);  // lowercase alias
    addVariable('user.Country', data.geo.country);  // Title case alias
    addVariable('user.GEO', data.geo.country);
    addVariable('user.COUNTRY_CODE', data.geo.country);
    addVariable('user.country_code', data.geo.country);  // lowercase alias
    addVariable('user.CONTINENT', data.geo.continent);
    addVariable('user.continent', data.geo.continent);  // lowercase alias
    addVariable('user.REGION_NAME', data.geo.region);
    addVariable('user.region_name', data.geo.region);  // lowercase alias
    addVariable('user.REGION_CODE', data.geo.regionCode);
    addVariable('user.region_code', data.geo.regionCode);  // lowercase alias
    addVariable('user.POSTAL_CODE', data.geo.postalCode);
    addVariable('user.postal_code', data.geo.postalCode);  // lowercase alias
    addVariable('user.LATITUDE', data.geo.latitude);
    addVariable('user.latitude', data.geo.latitude);  // lowercase alias
    addVariable('user.LONGITUDE', data.geo.longitude);
    addVariable('user.longitude', data.geo.longitude);  // lowercase alias
    addVariable('user.TIMEZONE', data.geo.timezone);
    addVariable('user.timezone', data.geo.timezone);  // lowercase alias
    addVariable('user.DEVICE', data.userAgent.device);
    addVariable('user.device', data.userAgent.device);  // lowercase alias
    addVariable('user.Device', data.userAgent.device);  // Title case alias
    addVariable('user.BROWSER', data.userAgent.browser);
    addVariable('user.browser', data.userAgent.browser);  // lowercase alias
    addVariable('user.Browser', data.userAgent.browser);  // Title case alias
    addVariable('user.BROWSER_VERSION', data.userAgent.browserVersion);
    addVariable('user.browser_version', data.userAgent.browserVersion);  // lowercase alias
    addVariable('user.OS', data.userAgent.os);
    addVariable('user.os', data.userAgent.os);  // lowercase alias
    addVariable('user.Os', data.userAgent.os);  // Title case alias
    addVariable('user.OS_VERSION', data.userAgent.osVersion);
    addVariable('user.os_version', data.userAgent.osVersion);  // lowercase alias
    addVariable('user.BRAND', data.userAgent.brand);
    addVariable('user.brand', data.userAgent.brand);  // lowercase alias
    addVariable('user.MODEL', data.userAgent.model);
    addVariable('user.model', data.userAgent.model);  // lowercase alias
    addVariable('user.ARCH', data.userAgent.arch);
    addVariable('user.arch', data.userAgent.arch);  // lowercase alias
    addVariable('user.BOT_SCORE', data.botScore?.toString() || '0');
    addVariable('user.bot_score', data.botScore?.toString() || '0');  // lowercase alias
    addVariable('user.THREAT_SCORE', data.clientTrustScore?.toString() || '0');
    addVariable('user.threat_score', data.clientTrustScore?.toString() || '0');  // lowercase alias
    addVariable('user.IS_VERIFIED_BOT', data.isVerifiedBot ? 'true' : 'false');
    addVariable('user.is_verified_bot', data.isVerifiedBot ? 'true' : 'false');  // lowercase alias
    addVariable('user.ORGANIZATION', data.org);
    addVariable('user.organization', data.org);  // lowercase alias
    addVariable('user.REFERRER', data.referrer);
    addVariable('user.referrer', data.referrer);  // lowercase alias
    addVariable('user.COLO', data.cf.colo);
    addVariable('user.colo', data.cf.colo);  // lowercase alias
    
    // Colo location data from mapping
    const coloData = data.cf.colo ? COLO_LOCATIONS[data.cf.colo] : null;
    addVariable('user.colo.city', coloData?.city);
    addVariable('user.COLO.CITY', coloData?.city);
    addVariable('user.colo.country', coloData?.country);
    addVariable('user.COLO.COUNTRY', coloData?.country);
    addVariable('user.colo.region', coloData?.region);
    addVariable('user.COLO.REGION', coloData?.region);
    addVariable('user.colo.name', coloData?.name);
    addVariable('user.COLO.NAME', coloData?.name);
    
    addVariable('user.ASN', data.cf.asn);
    addVariable('user.asn', data.cf.asn);  // lowercase alias

    // Request context
    addVariable('request.DOMAIN', data.domain);
    addVariable('request.domain', data.domain);  // lowercase alias
    addVariable('request.PATH', data.path);
    addVariable('request.path', data.path);  // lowercase alias

    // Query parameters (dynamic) - add both original and lowercase
    if (data.query) {
        for (const [queryKey, queryValue] of Object.entries(data.query)) {
            const sanitizedKey = queryKey.replace(/[^a-zA-Z0-9_]/g, '_');
            addVariable(`query.${sanitizedKey}`, queryValue);
            addVariable(`query.${sanitizedKey.toLowerCase()}`, queryValue);
        }
    }
    return allReplaceableVariables;
}

function isIpInRange(ip: string, range: string): boolean {
  // Handle CIDR notation (e.g., "192.168.1.0/24")
  if (range.includes('/')) {
    const [baseIp, bits] = range.split('/');
    const mask = parseInt(bits);
    const ipLong = ipToLong(ip);
    const rangeLong = ipToLong(baseIp);
    const maskLong = (0xffffffff << (32 - mask)) >>> 0;
    return (ipLong & maskLong) === (rangeLong & maskLong);
  }

  // Handle ranges with hyphens (e.g., "192.168.1.1-192.168.1.255")
  if (range.includes('-')) {
    const [start, end] = range.split('-');
    const ipLong = ipToLong(ip);
    const startLong = ipToLong(start);
    const endLong = ipToLong(end);
    return ipLong >= startLong && ipLong <= endLong;
  }

  // Handle wildcards (e.g., "192.168.1.*")
  if (range.includes('*')) {
    const pattern = range.replace(/\./g, '\\.').replace(/\*/g, '.*');
    const regex = new RegExp(`^${pattern}$`, 'i');
    return regex.test(ip);
  }

  // Exact match
  return ip === range;
}

function ipToLong(ip: string): number {
  return ip.split('.')
    .reduce((long, octet) => (long << 8) + parseInt(octet), 0) >>> 0;
}

function matchWildcard(text: string | null, pattern: string): boolean {
  if (!text) return false;
  
  // Convert wildcard to regex pattern
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except *
    .replace(/\*/g, '.*');                  // Convert * to .*
  
  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(text);
}

// Fetch platform info from D1 (cached via Cache API) for a campaign
async function getPlatformInfoForCampaign(campaignId: string | null | undefined): Promise<{ platformId: string | null; platformName: string | null; clickIdParam: string | null }> {
  if (!campaignId) return { platformId: null, platformName: null, clickIdParam: null };
  try {
    const cache = caches.default;
    const cacheKey = new Request(`https://platform-cache/campaign/${campaignId}`);
    const cached = await cache.match(cacheKey);
    if (cached) {
      return await cached.json();
    }

    const db = (env as any).DB;
    if (!db) return { platformId: null, platformName: null, clickIdParam: null };

    const row = await db.prepare(
      `SELECT p.id as platformId, p.name as platformName, p.click_id_param as clickIdParam
       FROM campaigns c
       LEFT JOIN platforms p ON c.platform_id = p.id
       WHERE c.id = ?
       LIMIT 1`
    ).bind(campaignId).first() as { platformId: string | null; platformName: string | null; clickIdParam: string | null } | null;

    const result = {
      platformId: row?.platformId || null,
      platformName: row?.platformName || null,
      clickIdParam: row?.clickIdParam || null,
    };

    await cache.put(
      cacheKey,
      new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
        cf: { cacheTtl: 900 }, // 15 minutes
      })
    );

    return result;
  } catch (e) {
    console.error('getPlatformInfoForCampaign failed', e);
    return { platformId: null, platformName: null, clickIdParam: null };
  }
}


// Helper function to detect if a path is a click-out request
function isClickOutPath(path: string): boolean {
  // Normalize path: remove trailing slash for comparison
  const normalized = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
  // Check if path ends with /click (case-sensitive)
  return normalized.endsWith('/click');
}

/**
 * Extract header order fingerprint
 * Different browsers send headers in different orders - this is hard to spoof
 */
function getHeaderOrderFingerprint(headers: Record<string, string>): string {
  // Get the first 10 header names in order (lowercase, sorted by when they appear)
  const headerNames = Object.keys(headers)
    .slice(0, 15)
    .map(h => h.toLowerCase())
    .filter(h => !h.startsWith('cf-') && h !== 'x-forwarded-for' && h !== 'x-real-ip') // Exclude proxy headers
    .join(',');
  return headerNames;
}

/**
 * Generate a stable session ID from browser fingerprint
 * Same browser/device will get same sessionId across visits
 * Uses multiple signals to create a unique device fingerprint without cookies
 */
export function generateSessionId(data: RequestData): string {
  // Build comprehensive fingerprint from multiple signals
  const components = [
    // Network identity
    data.ip || '',
    
    // Browser engine fingerprint (TLS cipher is unique per browser engine)
    data.cf?.tlsCipher || '',
    
    // HTTP protocol version (h2, h3, http/1.1)
    data.cf?.httpProtocol || '',
    
    // User-Agent (full string for version-level uniqueness)
    data.userAgent.raw || '',
    
    // Header order (browsers send headers in different orders - hard to spoof)
    getHeaderOrderFingerprint(data.headers),
    
    // Content negotiation headers (differ by browser)
    data.headers['accept'] || '',
    data.headers['accept-language'] || '',
    data.headers['accept-encoding'] || '',
    
    // Client hints (Chrome-specific, adds uniqueness)
    data.headers['sec-ch-ua'] || '',
    data.headers['sec-ch-ua-platform'] || '',
    data.headers['sec-ch-ua-mobile'] || '',
    
    // Connection preferences
    data.headers['connection'] || '',
    data.headers['upgrade-insecure-requests'] || '',
  ];
  
  const fingerprint = components.join('|');
  
  // Use a stronger hash (FNV-1a) for better distribution
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < fingerprint.length; i++) {
    hash ^= fingerprint.charCodeAt(i);
    hash = Math.imul(hash, 16777619); // FNV prime
  }
  
  // Convert to base36 string (more compact, 8 chars)
  return Math.abs(hash >>> 0).toString(36).padStart(8, '0').substring(0, 8);
}

/**
 * Generate a unique ID for events (impressions, clicks, conversions)
 * Uses crypto.randomUUID() available in Cloudflare Workers
 */
export function generateUniqueId(prefix: string = ''): string {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}-${uuid}` : uuid;
}

export interface BlockRules {
  orgs?: string[];      // Organization wildcards to block
  ips?: string[];       // IP ranges/wildcards to block
  hostnames?: string[]; // Hostname wildcards to block
  cities?: string[];    // City wildcards to block
  countries?: string[]; // Country codes (ISO 3166-1 alpha-2) to block
  devices?: string[];   // Device types to block (Mobile, Desktop, Tablet, TV)
  browsers?: string[];  // Browsers to block (Chrome, Firefox, etc)
  oses?: string[];      // Operating systems to block (Windows, iOS, etc)
}

// Helper function to check if a single rule's flags match the request data
function checkSingleRule(data: RequestData, flags: RuleFlags, isAssetRequest: boolean, _operator: 'AND' | 'OR' = 'AND'): {
  matched: boolean;
  matchedFlagsList: string[]; // Return list to allow flexible joining
} {
  const matchedFlags: string[] = [];
  const flagChecks: boolean[] = [];

  const anyOf = <T,>(candidate: T | null, expected: T | T[] | undefined, cmp: (a: T | null, b: T) => boolean): boolean => {
    if (expected === undefined) return true;
    if (Array.isArray(expected)) return expected.some((e) => cmp(candidate, e));
    return cmp(candidate, expected);
  };

  // Check params (sensitive to isAssetRequest)
  if (flags.params) {
    if (!isAssetRequest) { // Main page request
      let paramsMatch = true;
      for (const [key, value] of Object.entries(flags.params)) {
        if (data.query[key] !== value) {
          paramsMatch = false;
          break;
        }
      }
      if (paramsMatch) {
        matchedFlags.push(`params:${Object.entries(flags.params).map(([k,v]) => `${k}=${v}`).join('&')}`);
      }
      flagChecks.push(paramsMatch);
    } else { // Asset request
      flagChecks.push(false); // Rules with params are not directly matched by asset requests
    }
  }

  // Check country
  if (flags.country) {
    const countryMatch = anyOf<string>(data.geo.country, flags.country, (a, b) => a === b);
    if (countryMatch) matchedFlags.push(`country:${Array.isArray(flags.country) ? flags.country.join('|') : flags.country}`);
    flagChecks.push(countryMatch);
  }
  
  // Check region
  if (flags.region) {
    const regionMatch = anyOf<string>(data.geo.regionCode, flags.region, (a, b) => a === b);
    if (regionMatch) matchedFlags.push(`region:${Array.isArray(flags.region) ? flags.region.join('|') : flags.region}`);
    flagChecks.push(regionMatch);
  }

  // Check city
  if (flags.city) {
    const cityMatch = anyOf<string>(data.geo.city, flags.city, (a, b) => a === b);
    if (cityMatch) matchedFlags.push(`city:${Array.isArray(flags.city) ? flags.city.join('|') : flags.city}`);
    flagChecks.push(cityMatch);
  }

  // Check continent
  if (flags.continent) {
    const continentMatch = anyOf<string>(data.geo.continent, flags.continent, (a, b) => a === b);
    if (continentMatch) matchedFlags.push(`continent:${Array.isArray(flags.continent) ? flags.continent.join('|') : flags.continent}`);
    flagChecks.push(continentMatch);
  }

  // Check ASN
  if (flags.asn) {
    const asnMatch = anyOf<number>(data.cf.asn, flags.asn, (a, b) => a === b);
    if (asnMatch) matchedFlags.push(`asn:${Array.isArray(flags.asn) ? flags.asn.join('|') : flags.asn}`);
    flagChecks.push(asnMatch);
  }

  // Check Cloudflare datacenter
  if (flags.colo) {
    const coloMatch = anyOf<string>(data.cf.colo, flags.colo, (a, b) => a === b);
    if (coloMatch) matchedFlags.push(`colo:${Array.isArray(flags.colo) ? flags.colo.join('|') : flags.colo}`);
    flagChecks.push(coloMatch);
  }

  // Check IP address/range
  if (flags.ip && data.ip) {
    const ips = Array.isArray(flags.ip) ? flags.ip : [flags.ip];
    const ipMatch = ips.some((r) => isIpInRange(data.ip!, r));
    if (ipMatch) matchedFlags.push(`ip:${ips.join('|')}`);
    flagChecks.push(ipMatch);
  } else if (flags.ip) {
    flagChecks.push(false); // IP flag present but no IP data
  }
  
  // Check Organization
  if (flags.org) {
    const orgs = Array.isArray(flags.org) ? flags.org : [flags.org];
    const orgMatch = data.org ? orgs.some((p) => matchWildcard(data.org!, p)) : false;
    if (orgMatch) matchedFlags.push(`org:${orgs.join('|')}`);
    flagChecks.push(!!orgMatch);
  }

  // Check language
  if (flags.language) {
    const acceptLang = data.headers['accept-language'] || '';
    const primaryLang = acceptLang.split(',')[0].split('-')[0].toLowerCase();
    const expected = Array.isArray(flags.language) ? flags.language : [flags.language];
    const languageMatch = expected.some((l) => primaryLang === l);
    if (languageMatch) matchedFlags.push(`language:${expected.join('|')}`);
    flagChecks.push(languageMatch);
  }

  // Check time
  if (flags.time) {
    const now = new Date();
    const currentHourUTC = now.getUTCHours();
    const currentMinuteUTC = now.getUTCMinutes();
    const currentTimeInMinutes = currentHourUTC * 60 + currentMinuteUTC;

    const startHour = Math.floor(flags.time.start);
    const startMinutePart = flags.time.start - startHour;
    const startMinute = Math.round(startMinutePart * 60);
    const startTimeInMinutes = startHour * 60 + startMinute;

    const endHour = Math.floor(flags.time.end);
    const endMinutePart = flags.time.end - endHour;
    const endMinute = Math.round(endMinutePart * 60);
    const endTimeInMinutes = endHour * 60 + endMinute;

    const timeMatch = currentTimeInMinutes >= startTimeInMinutes && currentTimeInMinutes < endTimeInMinutes;
    if (timeMatch) {
      const formatTime = (h: number, m: number) => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      matchedFlags.push(`time:${formatTime(startHour, startMinute)}-${formatTime(endHour, endMinute)}`);
    }
    flagChecks.push(timeMatch);
  }

  // Check device
  if (flags.device) {
    const deviceMatch = anyOf<string>(data.userAgent.device, flags.device, (a, b) => a === b);
    if (deviceMatch) matchedFlags.push(`device:${Array.isArray(flags.device) ? flags.device.join('|') : flags.device}`);
    flagChecks.push(deviceMatch);
  }

  // Check browser
  if (flags.browser) {
    const browserMatch = anyOf<string>(data.userAgent.browser, flags.browser, (a, b) => a === b);
    if (browserMatch) matchedFlags.push(`browser:${Array.isArray(flags.browser) ? flags.browser.join('|') : flags.browser}`);
    flagChecks.push(browserMatch);
  }

  // Check OS
  if (flags.os) {
    const expected = Array.isArray(flags.os) ? flags.os : [flags.os];
    const osMatch = data.userAgent.os ? expected.some((e) => data.userAgent.os!.includes(e)) : false;
    if (osMatch) matchedFlags.push(`os:${expected.join('|')}`);
    flagChecks.push(!!osMatch);
  }

  // Check brand
  if (flags.brand) {
    const brandMatch = anyOf<string>(data.userAgent.brand, flags.brand, (a, b) => a === b);
    if (brandMatch) matchedFlags.push(`brand:${Array.isArray(flags.brand) ? flags.brand.join('|') : flags.brand}`);
    flagChecks.push(brandMatch);
  }
  
  // Across different fields we always AND; within each field, arrays were OR'ed above
  const finalMatch = flagChecks.every(check => check);
  
  return { matched: finalMatch, matchedFlagsList: matchedFlags };
}

async function applyKVRule(c: any, data: ExtendedRequestData, rule: KVRule, ruleKey: string): Promise<Response> {
  let selectedRule: Rule | null = null;
  let matchedFlags: string[] = [];
  let reason = "";
  
  // Generate IDs for tracking (if not already set)
  if (!data.sessionId) {
    data.sessionId = generateSessionId(data);
  }
  if (!data.impressionId && (data.path === '/' || data.path.endsWith('/') || data.path.endsWith('.html') || data.path.endsWith('.htm'))) {
    data.impressionId = generateUniqueId('imp');
  }

  // Detect if this is an asset request (not a page). Treat extensionless and non-asset extensions as pages.
  const ASSET_EXTENSIONS = new Set([
    'css','js','mjs','jsx','ts','tsx','png','jpg','jpeg','gif','svg','webp','ico','json','map','woff','woff2','ttf','otf','eot','mp4','webm','ogg','mp3','wav','pdf','txt','xml','csv','wasm','zip','gz','br','avif','heic','webmanifest'
  ]);
  const getPathExtension = (p: string): string => {
    const clean = p.split('?')[0].split('#')[0];
    const lastSegment = clean.split('/').pop() || '';
    const parts = lastSegment.split('.');
    if (parts.length <= 1) return '';
    return parts.pop()!.toLowerCase();
  };
  const ext = getPathExtension(data.path);
  const isPageLike = (
    data.path === '/' ||
    data.path.endsWith('.html') ||
    data.path.endsWith('.htm') ||
    ext === '' ||
    (ext && !ASSET_EXTENSIONS.has(ext))
  );
  const isAssetRequest = !isPageLike;

  // 0. Bot Detection - use ALL Cloudflare signals
  // If bot detected via any signal, skip matching rules and serve defaultFolder
  const isBotByScore = data.botScore !== undefined && data.botScore !== null && data.botScore < 30;
  const isBotByThreat = data.clientTrustScore !== undefined && data.clientTrustScore !== null && data.clientTrustScore > 50;
  const isLikelyBot = data.isBot || isBotByScore || isBotByThreat;
  
  // Note: Verified bots (Googlebot, Bingbot) also get the safe page unless specifically allowed
  if ((isLikelyBot || data.isVerifiedBot) && !isAssetRequest) {
    console.log(JSON.stringify({
      action: "BOT_DETECTED",
      domain: data.domain,
      ip: data.ip,
      botScore: data.botScore,
      clientTrustScore: data.clientTrustScore,
      isVerifiedBot: data.isVerifiedBot,
      isBotByUA: data.isBot,
      reason: data.isVerifiedBot ? "Verified Bot (Googlebot, etc.)" : 
              isBotByScore ? "Cloudflare Bot Score < 30" : 
              isBotByThreat ? "High Threat Score > 50" : "UA-based detection"
    }));
    
    // Serve default folder/page (safe page)
    const mode = rule.defaultFolderMode;
    const defaultFolder = rule.defaultFolder || '';
    const isUrl = defaultFolder.startsWith('http://') || defaultFolder.startsWith('https://');
    
    const botReason = `Bot detected (score: ${data.botScore})`;
    
    if (mode === 'redirect' && isUrl) {
      const macroContext: MacroContext = {
        campaignId: rule.id,
        campaignName: rule.name,
        siteName: rule.siteName,
        sessionId: data.sessionId,
        impressionId: data.impressionId,
      };
      const redirectUrl = replaceMacrosInUrl(defaultFolder, data, rule.variables, macroContext);
      return new Response(null, { status: 302, headers: { 'Location': redirectUrl } });
    } else if (mode === 'proxy' || (isUrl && mode !== 'hosted')) {
      return handleInitialProxyRequest(c, defaultFolder, data, botReason, rule.variables);
    } else {
      return servePublicFile(c, `${defaultFolder}/`, data, botReason, rule.variables, rule.id);
    }
  }

  // 1. Check blocks first
  if (rule.blocks) {
    // Helper to serve default folder based on mode
    const serveDefaultFolderForBlock = async (blockReason: string): Promise<Response> => {
      const mode = rule.defaultFolderMode;
      const defaultFolder = rule.defaultFolder || '';
      const isUrl = defaultFolder.startsWith('http://') || defaultFolder.startsWith('https://');
      
      if (mode === 'redirect' && isUrl) {
        const macroContext: MacroContext = {
          campaignId: rule.id,
          campaignName: rule.name,
          siteName: rule.siteName,
          sessionId: data.sessionId,
          impressionId: data.impressionId,
        };
        const redirectUrl = replaceMacrosInUrl(defaultFolder, data, rule.variables, macroContext);
        return new Response(null, { 
          status: 302, 
          headers: { 
            'Location': redirectUrl,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          } 
        });
      } else if (mode === 'proxy' || (isUrl && mode !== 'hosted')) {
        return handleInitialProxyRequest(c, defaultFolder, data, blockReason, rule.variables);
      } else {
        return servePublicFile(c, `${defaultFolder}/`, data, blockReason, rule.variables, rule.id);
      }
    };

    // Check IP blocks
    if (rule.blocks.ips && data.ip) {
      for (const ipRange of rule.blocks.ips) {
        if (isIpInRange(data.ip, ipRange)) {
          reason = `IP blocked: ${data.ip} matches ${ipRange}`;
          if (data.path === '/' || data.path === '/index.html') {
            console.log(JSON.stringify({
              action: "BLOCKED_IP",
              domain: data.domain,
              ip: data.ip,
              matchedRange: ipRange,
              reason: reason
            }));
          }
          return serveDefaultFolderForBlock(reason);
        }
      }
    }

    // Check org blocks
    if (rule.blocks.orgs && data.org) {
      for (const orgPattern of rule.blocks.orgs) {
        if (matchWildcard(data.org, orgPattern)) {
          reason = `Organization blocked: ${data.org} matches ${orgPattern}`;
          if (data.path === '/' || data.path === '/index.html') {
            console.log(JSON.stringify({
              action: "BLOCKED_ORG",
              domain: data.domain,
              ip: data.ip,
              org: data.org,
              matchedPattern: orgPattern,
              reason: reason
            }));
          }
          return serveDefaultFolderForBlock(reason);
        }
      }
    }

    // Check hostname blocks
    const hostname = data.headers['host'] || '';
    if (rule.blocks.hostnames && hostname) {
      for (const hostnamePattern of rule.blocks.hostnames) {
        if (matchWildcard(hostname, hostnamePattern)) {
          reason = `Hostname blocked: ${hostname} matches ${hostnamePattern}`;
          if (data.path === '/' || data.path === '/index.html') {
            console.log(JSON.stringify({
              action: "BLOCKED_HOSTNAME",
              domain: data.domain,
              hostname: hostname,
              matchedPattern: hostnamePattern,
              reason: reason
            }));
          }
          return serveDefaultFolderForBlock(reason);
        }
      }
    }

    // Check city blocks
    if (rule.blocks.cities && data.geo.city) {
      for (const cityPattern of rule.blocks.cities) {
        if (matchWildcard(data.geo.city, cityPattern)) {
          reason = `City blocked: ${data.geo.city} matches ${cityPattern}`;
          if (data.path === '/' || data.path === '/index.html') {
            console.log(JSON.stringify({
              action: "BLOCKED_CITY",
              domain: data.domain,
              ip: data.ip,
              city: data.geo.city,
              matchedPattern: cityPattern,
              reason: reason
            }));
          }
          return serveDefaultFolderForBlock(reason);
        }
      }
    }

    // Check country blocks
    if (rule.blocks.countries && data.geo.country) {
      for (const countryCode of rule.blocks.countries) {
        // Countries are exact ISO codes, no wildcard needed, but matchWildcard handles exact match too and is case-insensitive
        if (matchWildcard(data.geo.country, countryCode)) { 
          reason = `Country blocked: ${data.geo.country} matches ${countryCode}`;
          if (data.path === '/' || data.path === '/index.html') {
            console.log(JSON.stringify({
              action: "BLOCKED_COUNTRY",
              domain: data.domain,
              ip: data.ip,
              country: data.geo.country,
              matchedPattern: countryCode,
              reason: reason
            }));
          }
          return serveDefaultFolderForBlock(reason);
        }
      }
    }

    // Check device blocks
    if (rule.blocks.devices && data.userAgent.device) {
      for (const devicePattern of rule.blocks.devices) {
        if (matchWildcard(data.userAgent.device, devicePattern)) {
          reason = `Device blocked: ${data.userAgent.device} matches ${devicePattern}`;
          if (data.path === '/' || data.path === '/index.html') {
            console.log(JSON.stringify({
              action: "BLOCKED_DEVICE",
              domain: data.domain,
              ip: data.ip,
              device: data.userAgent.device,
              matchedPattern: devicePattern,
              reason: reason
            }));
          }
          return serveDefaultFolderForBlock(reason);
        }
      }
    }

    // Check browser blocks
    if (rule.blocks.browsers && data.userAgent.browser) {
      for (const browserPattern of rule.blocks.browsers) {
        if (matchWildcard(data.userAgent.browser, browserPattern)) {
          reason = `Browser blocked: ${data.userAgent.browser} matches ${browserPattern}`;
          if (data.path === '/' || data.path === '/index.html') {
            console.log(JSON.stringify({
              action: "BLOCKED_BROWSER",
              domain: data.domain,
              ip: data.ip,
              browser: data.userAgent.browser,
              matchedPattern: browserPattern,
              reason: reason
            }));
          }
          return serveDefaultFolderForBlock(reason);
        }
      }
    }

    // Check OS blocks
    if (rule.blocks.oses && data.userAgent.os) {
      for (const osPattern of rule.blocks.oses) {
        if (matchWildcard(data.userAgent.os, osPattern)) {
          reason = `OS blocked: ${data.userAgent.os} matches ${osPattern}`;
          if (data.path === '/' || data.path === '/index.html') {
            console.log(JSON.stringify({
              action: "BLOCKED_OS",
              domain: data.domain,
              ip: data.ip,
              os: data.userAgent.os,
              matchedPattern: osPattern,
              reason: reason
            }));
          }
          return serveDefaultFolderForBlock(reason);
        }
      }
    }
  }

  // 0. Handle click-out requests (paths ending with /click or /click/)
  if (isClickOutPath(data.path)) {
    // Find matching rules for click-out handling
    const clickMatchingRules: Array<{ rule: Rule; matchedFlags: string[] }> = [];
    for (const ruleSet of rule.rules) {
      if (ruleSet.groups && ruleSet.groups.length > 0) {
        // OR across groups
        let groupMatched = false;
        let matchedFlags: string[] = [];
        for (const g of ruleSet.groups) {
          const res = checkSingleRule(data, g, isAssetRequest, 'AND');
          if (res.matched) {
            groupMatched = true;
            matchedFlags = res.matchedFlagsList;
            break;
          }
        }
        if (groupMatched && (ruleSet.clickUrl || ruleSet.clickDestinations)) {
          clickMatchingRules.push({ rule: ruleSet as Rule, matchedFlags });
        }
      } else {
        const { matched, matchedFlagsList } = checkSingleRule(data, (ruleSet.flags || {}) as RuleFlags, isAssetRequest, ruleSet.operator);
        if (matched && (ruleSet.clickUrl || ruleSet.clickDestinations)) {
          clickMatchingRules.push({ rule: ruleSet, matchedFlags: matchedFlagsList });
        }
      }
    }

    if (clickMatchingRules.length > 0) {
      // Select one rule based on weights (if multiple match)
      const totalWeight = clickMatchingRules.reduce((sum, mr) => sum + (mr.rule.weight || 100), 0);
      const random = Math.random() * totalWeight;
      let currentWeight = 0;
      let selectedClickRule: Rule | null = null;
      let selectedClickFlags: string[] = [];
      
      for (const mr of clickMatchingRules) {
        currentWeight += (mr.rule.weight || 100);
        if (random <= currentWeight) {
          selectedClickRule = mr.rule;
          selectedClickFlags = mr.matchedFlags;
          break;
        }
      }

      if (selectedClickRule) {
        let clickDestination: string | null = null;
        let destinationId: string | null = null;

        // Handle clickDestinations array (weighted split)
        if (selectedClickRule.clickDestinations && selectedClickRule.clickDestinations.length > 0) {
          const validDestinations = selectedClickRule.clickDestinations.filter(d => d.id && d.id.trim());
          if (validDestinations.length > 0) {
            const totalDestWeight = validDestinations.reduce((sum, d) => sum + (d.weight || 1), 0);
            const randomDest = Math.random() * totalDestWeight;
            let currentDestWeight = 0;
            
            for (const dest of validDestinations) {
              currentDestWeight += (dest.weight || 1);
              if (randomDest <= currentDestWeight) {
                destinationId = dest.id;
                // Lookup URL from D1 (cached)
                const url = await getDestinationUrl(dest.id, c);
                if (url) {
                  clickDestination = url.trim();
                } else {
                  console.error(`Destination ${dest.id} not found in D1 or inactive`);
                  // Fall through to try next destination or clickUrl
                }
                break;
              }
            }
          }
        } else if (selectedClickRule.clickUrl) {
          // Single click URL (backward compatibility, no D1 lookup)
          clickDestination = selectedClickRule.clickUrl;
        }

        if (clickDestination) {
          // Generate IDs for click tracking
          const clickId = generateUniqueId('click');
          const sessionId = data.sessionId || generateSessionId(data);
          const impressionId = data.impressionId || generateUniqueId('imp');
          
          // Look up landing page and query params from impression BEFORE macro replacement
          // This ensures we have the original fbclid and other params even if /click request doesn't have them
          const landingPageInfo = await getLandingPageFromImpression(impressionId);
          
          // Merge impression query params into data.query (current params override impression params)
          if (landingPageInfo?.queryParams) {
            data.query = { ...landingPageInfo.queryParams, ...data.query };
          }
          
          // Get platform info for macros (from D1 only)
          const clickPlatformLookup = await getPlatformInfoForCampaign(rule.id);
          const clickPlatformId = clickPlatformLookup.platformId;
          const clickPlatformClickId = clickPlatformLookup.clickIdParam ? data.query[clickPlatformLookup.clickIdParam] : null;
          
          // Replace macros in the click destination URL (e.g., {{query.fbclid}}, {{user.CITY}}, {{campaign.id}}, {{platform.name}})
          const clickMacroContext: MacroContext = {
            campaignId: rule.id,
            campaignName: rule.name,
            siteName: rule.siteName,
            clickId: clickId,
            sessionId: sessionId,
            impressionId: impressionId,
            platformId: clickPlatformId || undefined,
            platformName: clickPlatformLookup.platformName || undefined,
            platformClickId: clickPlatformClickId || undefined,
          };
          const clickDestinationWithMacros = replaceMacrosInUrl(clickDestination, data, selectedClickRule.variables, clickMacroContext);
          
          // Build redirect URL with query string preserved
          const redirectUrl = new URL(clickDestinationWithMacros);
          
          // Append original query parameters (now includes merged impression params)
          for (const [key, value] of Object.entries(data.query)) {
            redirectUrl.searchParams.set(key, value);
          }
          
          // Add tracking parameters
          redirectUrl.searchParams.set('click_id', clickId);
          redirectUrl.searchParams.set('impression_id', impressionId);
          redirectUrl.searchParams.set('session_id', sessionId);

          const weightInfo = clickMatchingRules.length > 1 ? ` (weight: ${selectedClickRule.weight || 100}%)` : '';
          const destInfo = destinationId ? ` → destination ${destinationId}` : '';
          reason = `Click-out matched rule [${selectedClickFlags.join(', ')}]${weightInfo}${destInfo}`;
          
          if (data.path === '/' || data.path === '/index.html' || isClickOutPath(data.path)) {
            console.log(JSON.stringify({
              action: "CLICK_OUT_REDIRECT",
              domain: data.domain,
              path: data.path,
              destination: redirectUrl.toString(),
              matchedFlags: selectedClickFlags,
              destinationId: destinationId,
              clickId: clickId,
              impressionId: impressionId,
              sessionId: sessionId,
              reason: reason
            }));
          }
          
          // Store click event in PlanetScale (async, non-blocking)
          // Use platform info already fetched for macros
          console.log('[CLK] queue storeEvent', { clickId, impressionId, path: data.path, domain: data.domain, platformId: clickPlatformId });
          c.executionCtx.waitUntil(
            (async () => {
              const campaignId = rule.id || '';
              // Use already-fetched landingPageInfo or fallback to defaultFolder
              const finalLandingPageInfo = landingPageInfo || {
                landingPage: rule.defaultFolder || null,
                landingPageMode: rule.defaultFolderMode || null,
                queryParams: null,
              };
              await storeEvent({
                eventId: clickId,  // Separate event for click (folder/proxy campaigns)
                sessionId: sessionId,
                campaignId: campaignId,
                isImpression: false,
                isClick: true,  // Click-only event for folder/proxy campaigns
                domain: data.domain,
                path: data.path,
                landingPage: finalLandingPageInfo.landingPage,
                landingPageMode: finalLandingPageInfo.landingPageMode,
                destinationUrl: redirectUrl.toString(),
                destinationId: destinationId || null,
                matchedFlags: selectedClickFlags,
                ip: data.ip,
                country: data.geo.country,
                city: data.geo.city,
                continent: data.geo.continent,
                latitude: data.geo.latitude,
                longitude: data.geo.longitude,
                region: data.geo.region,
                regionCode: data.geo.regionCode,
                postalCode: data.geo.postalCode || null,
                timezone: data.geo.timezone,
                device: data.userAgent.device,
                browser: data.userAgent.browser,
                browserVersion: data.userAgent.browserVersion,
                os: data.userAgent.os,
                osVersion: data.userAgent.osVersion,
                brand: data.userAgent.brand,
                referrer: data.referrer || null,
                isBot: data.isBot || false,
                queryParams: data.query,
                ruleKey: ruleKey,
                userAgentRaw: data.userAgent.raw,
                asn: data.cf.asn,
                asOrganization: data.cf.asOrganization,
                colo: data.cf.colo,
                clientTrustScore: data.cf.clientTrustScore,
                httpProtocol: data.cf.httpProtocol,
                tlsVersion: data.cf.tlsVersion,
                tlsCipher: data.cf.tlsCipher,
                platformId: clickPlatformId || null,
                platformClickId: clickPlatformClickId || null,
              });
            })()
          );

          return new Response(null, { 
            status: 302, 
            headers: { 'Location': redirectUrl.toString() } 
          });
        }
      }
    }
    
    // If no click-out rule matched, but we have a destinationId at top level and this is a /click path,
    // use the destinationId for the click
    if (isClickOutPath(data.path) && rule.destinationId && rule.defaultFolder) {
      const destinationId = rule.destinationId;
      const clickDestination = rule.defaultFolder; // Already resolved from destinationId in getKVRule
      
      if (clickDestination) {
        // Generate IDs for click tracking
        const clickId = generateUniqueId('click');
        const sessionId = data.sessionId || generateSessionId(data);
        const impressionId = data.impressionId || generateUniqueId('imp');
        
        // Look up landing page and query params from impression BEFORE macro replacement
        const landingPageInfo = await getLandingPageFromImpression(impressionId);
        
        // Merge impression query params into data.query
        if (landingPageInfo?.queryParams) {
          data.query = { ...landingPageInfo.queryParams, ...data.query };
        }
        
        // Get platform info for macros (from D1 only)
        const clickPlatformLookup = await getPlatformInfoForCampaign(rule.id);
        const clickPlatformId = clickPlatformLookup.platformId;
        const clickPlatformClickId = clickPlatformLookup.clickIdParam ? data.query[clickPlatformLookup.clickIdParam] : null;
        
        // Replace macros in the click destination URL
        const clickMacroContext: MacroContext = {
          campaignId: rule.id,
          campaignName: rule.name,
          siteName: rule.siteName,
          clickId: clickId,
          sessionId: sessionId,
          impressionId: impressionId,
          platformId: clickPlatformId || undefined,
          platformName: clickPlatformLookup.platformName || undefined,
          platformClickId: clickPlatformClickId || undefined,
        };
        const clickDestinationWithMacros = replaceMacrosInUrl(clickDestination, data, rule.variables, clickMacroContext);
        
        // Build redirect URL with query string preserved
        const redirectUrl = new URL(clickDestinationWithMacros);
        
        // Append original query parameters
        for (const [key, value] of Object.entries(data.query)) {
          redirectUrl.searchParams.set(key, value);
        }
        
        // Add tracking parameters
        redirectUrl.searchParams.set('click_id', clickId);
        redirectUrl.searchParams.set('impression_id', impressionId);
        redirectUrl.searchParams.set('session_id', sessionId);

        reason = `Click-out using default destination ${destinationId}`;
        
        if (data.path === '/' || data.path === '/index.html' || isClickOutPath(data.path)) {
          console.log(JSON.stringify({
            action: "CLICK_OUT_REDIRECT",
            domain: data.domain,
            path: data.path,
            destination: redirectUrl.toString(),
            matchedFlags: [],
            destinationId: destinationId,
            clickId: clickId,
            impressionId: impressionId,
            sessionId: sessionId,
            reason: reason
          }));
        }
        
        // Store click event in PlanetScale (async, non-blocking)
        console.log('[CLK] queue storeEvent (default destination)', { clickId, impressionId, path: data.path, domain: data.domain, platformId: clickPlatformId, destinationId });
        c.executionCtx.waitUntil(
          (async () => {
            const campaignId = rule.id || '';
            const finalLandingPageInfo = landingPageInfo || {
              landingPage: rule.defaultFolder || null,
              landingPageMode: rule.defaultFolderMode || null,
              queryParams: null,
            };
            await storeEvent({
              eventId: clickId,
              sessionId: sessionId,
              campaignId: campaignId,
              isImpression: false,
              isClick: true,
              domain: data.domain,
              path: data.path,
              landingPage: finalLandingPageInfo.landingPage,
              landingPageMode: finalLandingPageInfo.landingPageMode,
              destinationUrl: redirectUrl.toString(),
              destinationId: destinationId, // Use the top-level destinationId
              matchedFlags: [],
              ip: data.ip,
              country: data.geo.country,
              city: data.geo.city,
              continent: data.geo.continent,
              latitude: data.geo.latitude,
              longitude: data.geo.longitude,
              region: data.geo.region,
              regionCode: data.geo.regionCode,
              postalCode: data.geo.postalCode || null,
              timezone: data.geo.timezone,
              device: data.userAgent.device,
              browser: data.userAgent.browser,
              browserVersion: data.userAgent.browserVersion,
              os: data.userAgent.os,
              osVersion: data.userAgent.osVersion,
              brand: data.userAgent.brand,
              referrer: data.referrer || null,
              queryParams: data.query,
              ruleKey: ruleKey,
              userAgentRaw: data.userAgent.raw,
              asn: data.cf.asn,
              asOrganization: data.cf.asOrganization,
              colo: data.cf.colo,
              clientTrustScore: data.cf.clientTrustScore,
              httpProtocol: data.cf.httpProtocol,
              tlsVersion: data.cf.tlsVersion,
              tlsCipher: data.cf.tlsCipher,
              platformId: clickPlatformId || null,
              platformClickId: clickPlatformClickId || null,
            });
          })()
        );

        return new Response(null, { 
          status: 302, 
          headers: { 'Location': redirectUrl.toString() } 
        });
      }
    }
    
    // If no click-out rule matched, fall through to regular rule processing
    // (which will eventually serve defaultFolder if no rules match)
  }

  // 1. Find the winning rule first
  const matchingRules: Array<{ rule: Rule; matchedFlags: string[] }> = [];
  for (const ruleSet of rule.rules) {
    if (ruleSet.groups && ruleSet.groups.length > 0) {
      // OR across groups
      let groupMatched = false;
      let matchedFlags: string[] = [];
      for (const g of ruleSet.groups) {
        const res = checkSingleRule(data, g, isAssetRequest, 'AND');
        if (res.matched) {
          groupMatched = true;
          matchedFlags = res.matchedFlagsList;
          break;
        }
      }
      if (groupMatched) matchingRules.push({ rule: ruleSet as Rule, matchedFlags });
    } else {
      const { matched, matchedFlagsList } = checkSingleRule(data, (ruleSet.flags || {}) as RuleFlags, isAssetRequest, ruleSet.operator);
      if (matched) {
        matchingRules.push({ rule: ruleSet, matchedFlags: matchedFlagsList });
      }
    }
  }

  if (matchingRules.length > 0) {
    // 2. Select one based on weights
      const totalWeight = matchingRules.reduce((sum, mr) => sum + (mr.rule.weight || 100), 0);
      const random = Math.random() * totalWeight;
      let currentWeight = 0;
      
      for (const mr of matchingRules) {
        currentWeight += (mr.rule.weight || 100);
        if (random <= currentWeight) {
          selectedRule = mr.rule;
        matchedFlags = mr.matchedFlags;
          break;
        }
      }
    }

  // 2. Decide on the action based on the winning rule (or lack thereof)
  let finalAction: { type: 'folder' | 'modifications' | 'redirect' | 'proxy'; payload: any; variables?: Record<string, string> } | null = null;

  if (selectedRule) {
    const weightInfo = matchingRules.length > 1 ? ` (weight: ${selectedRule.weight || 100}%)` : '';
    reason = `Matched rule [${matchedFlags.join(', ')}]${weightInfo}`;

    // Handle destinations array (weighted split within a single rule)
    if (selectedRule.destinations && selectedRule.destinations.length > 0) {
      const validDestinations = selectedRule.destinations.filter(d => d.value && d.value.trim());
      if (validDestinations.length > 0) {
        const totalDestWeight = validDestinations.reduce((sum, d) => sum + (d.weight || 1), 0);
        const randomDest = Math.random() * totalDestWeight;
        let currentDestWeight = 0;
        let selectedDestination = validDestinations[0]; // fallback
        
        for (const dest of validDestinations) {
          currentDestWeight += (dest.weight || 1);
          if (randomDest <= currentDestWeight) {
            selectedDestination = dest;
            break;
          }
        }
        
        const destValue = selectedDestination.value.trim();
        const isUrl = destValue.startsWith('http://') || destValue.startsWith('https://');
        
        // Determine action type based on explicit mode or infer from value
        const destMode = selectedDestination.mode;
        if (destMode === 'redirect' && isUrl) {
          finalAction = { type: 'redirect', payload: destValue, variables: selectedRule.variables || rule.variables };
        } else if (destMode === 'proxy' || (isUrl && destMode !== 'hosted')) {
          finalAction = { type: 'proxy', payload: destValue, variables: selectedRule.variables || rule.variables };
        } else {
          finalAction = { type: 'folder', payload: destValue, variables: selectedRule.variables || rule.variables };
        }
        reason = `Matched rule [${matchedFlags.join(', ')}] → destination ${selectedDestination.id} (weight: ${selectedDestination.weight}%, mode: ${destMode || 'auto'})`;
      } else {
        // Destinations array exists but all are empty, fall through to other actions
      }
    }
    
    // Only check other actions if destinations weren't handled
    if (!finalAction) {
      if (selectedRule.modifications) {
        finalAction = { type: 'modifications', payload: selectedRule.modifications, variables: selectedRule.variables || rule.variables };
      } else if (selectedRule.proxyUrl || (selectedRule as any).fetchUrl) {
        finalAction = { type: 'proxy', payload: selectedRule.proxyUrl || (selectedRule as any).fetchUrl, variables: selectedRule.variables || rule.variables };
      } else if (selectedRule.redirectUrl) {
        finalAction = { type: 'redirect', payload: selectedRule.redirectUrl, variables: selectedRule.variables || rule.variables };
      } else if (selectedRule.folder) {
        if (selectedRule.folder.startsWith('http://') || selectedRule.folder.startsWith('https://')) {
          // Handle legacy rule: URL in folder property
          finalAction = { type: 'proxy', payload: selectedRule.folder, variables: selectedRule.variables || rule.variables };
        } else {
          // Handle as a standard folder
          finalAction = { type: 'folder', payload: selectedRule.folder, variables: selectedRule.variables || rule.variables };
        }
      } else {
        // Rule matched but has no action, fall through to default
        reason = `Matched rule [${matchedFlags.join(', ')}] but it had no action, using default.`;
        const defaultFolder = rule.defaultFolder || '';
        if (defaultFolder.startsWith('http')) {
          finalAction = { type: 'proxy', payload: defaultFolder, variables: rule.variables };
        } else {
          finalAction = { type: 'folder', payload: defaultFolder, variables: rule.variables };
        }
      }
    }
  } else {
    reason = "No rules matched, using default folder";
    
    // Determine action type based on defaultFolderMode
    const mode = rule.defaultFolderMode;
    const defaultFolder = rule.defaultFolder || '';
    const isUrl = defaultFolder.startsWith('http://') || defaultFolder.startsWith('https://');
    
    if (mode === 'redirect' && isUrl) {
      // Redirect mode: HTTP redirect with macro replacement
      finalAction = { type: 'redirect', payload: defaultFolder, variables: rule.variables };
    } else if (mode === 'proxy' || (isUrl && mode !== 'hosted')) {
      // Proxy mode (default for URLs without explicit mode)
      finalAction = { type: 'proxy', payload: defaultFolder, variables: rule.variables };
    } else {
      // Hosted mode (default for non-URLs)
      finalAction = { type: 'folder', payload: defaultFolder, variables: rule.variables };
    }
      
    // Store impression for default folder page views (will be stored in the switch statement below)
  }
  
  // 3. Execute the action based on the integration type (Proxy vs. JS Snippet)
  if (data.isEmbedRequest) {
    // --- JS Snippet Delivery ---
    switch (finalAction.type) {
      case 'modifications':
        const modificationsPayload = `
          (function() {
            const changes = ${JSON.stringify(finalAction.payload)};
            
            function applyChanges() {
              for (const change of changes) {
                try {
                  const elements = document.querySelectorAll(change.selector);
                  elements.forEach(element => {
                    switch (change.action) {
                      case 'setText':
                        element.innerText = change.value;
                        break;
                      case 'setHtml':
                        element.innerHTML = change.value;
                        break;
                      case 'setCss':
                        Object.assign(element.style, change.value);
                        break;
                      case 'setAttribute':
                        element.setAttribute(change.value.name, change.value.value);
                        break;
                      case 'remove':
                        element.remove();
                        break;
                    }
                  });
                } catch (e) {
                  console.error('Tracked script error applying change:', change, e);
                }
              }
              // Unhide the page
              window.tracked.end();
            }

            if (document.readyState === 'loading') {
              document.addEventListener('DOMContentLoaded', applyChanges);
            } else {
              applyChanges();
            }
          })();
        `;
        const modHeaders = new Headers({ 'Content-Type': 'application/javascript' });
        addAcceptCHHeaders(modHeaders);
        return new Response(modificationsPayload, { headers: modHeaders });
      case 'proxy':
        const iframeSrc = `/proxy-session?url=${encodeURIComponent(finalAction.payload)}`;
        const iframePayload = `
          (function() {
            // The page is currently hidden by the anti-flicker snippet.
            var iframe = document.createElement('iframe');
            iframe.src = '${iframeSrc}';
            iframe.style.position = 'fixed';
            iframe.style.top = '0';
            iframe.style.left = '0';
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = 'none';
            iframe.style.visibility = 'hidden'; // Start hidden

            iframe.onload = function() {
              // Now, unhide the page and the iframe.
              iframe.style.visibility = 'visible';
              window.tracked.end();
            };

            // Add the iframe to the (invisible) body and clear everything else.
            document.body.innerHTML = '';
            document.body.appendChild(iframe);
          })();
        `;
        const iframeHeaders = new Headers({ 'Content-Type': 'application/javascript' });
        addAcceptCHHeaders(iframeHeaders);
        return new Response(iframePayload, { headers: iframeHeaders });
      case 'redirect':
        // Generate event ID for JS redirect (same ID for impression+click since they're one event)
        const jsRedirectEventId = data.impressionId || generateUniqueId('evt');
        const jsRedirectSessionId = data.sessionId || generateSessionId(data);
        // For JS redirect campaigns: impression and click are the same event, so use same ID
        const jsRedirectImpressionId = jsRedirectEventId;
        const jsRedirectClickId = jsRedirectEventId;  // Same ID since it's one event
        
        // Get platform info for click (from D1 only)
        const jsRedirectPlatformLookup = await getPlatformInfoForCampaign(rule.id);
        const jsRedirectPlatformId = jsRedirectPlatformLookup.platformId;
        const jsRedirectPlatformClickId = jsRedirectPlatformLookup.clickIdParam ? data.query[jsRedirectPlatformLookup.clickIdParam] : null;
        
        // Replace macros in redirect URL (including {{click.id}}, {{platform.name}}, {{platform.click_id}})
        const jsRedirectMacroContext: MacroContext = {
          campaignId: rule.id,
          campaignName: rule.name,
          siteName: rule.siteName,
          sessionId: jsRedirectSessionId,
          impressionId: jsRedirectImpressionId,
          clickId: jsRedirectClickId,  // Same as impressionId for JS redirect campaigns
          platformId: jsRedirectPlatformId || undefined,
          platformName: jsRedirectPlatformLookup.platformName || undefined,
          platformClickId: jsRedirectPlatformClickId || undefined,
        };
        const jsRedirectUrl = replaceMacrosInUrl(finalAction.payload, data, finalAction.variables, jsRedirectMacroContext);
        
        // Queue event storage (JS redirect = impression + click in one event)
        console.log('[EVT] queue storeEvent (js-redirect)', { eventId: jsRedirectEventId, platformId: jsRedirectPlatformId });
        c.executionCtx.waitUntil(
          (async () => {
            const campaignId = rule.id || '';
            await storeEvent({
              eventId: jsRedirectEventId,  // Same ID for impression and click (one event)
              sessionId: jsRedirectSessionId,
              campaignId: campaignId,
              isImpression: true,
              isClick: true,  // JS redirect = impression + click in one event
              domain: data.domain,
              path: data.path,
              landingPage: finalAction.payload,
              landingPageMode: 'redirect',
              destinationUrl: jsRedirectUrl,
              destinationId: rule.destinationId || null,  // Use top-level destinationId if available
              matchedFlags: [],
              ip: data.ip,
              country: data.geo.country,
              city: data.geo.city,
              continent: data.geo.continent,
              latitude: data.geo.latitude,
              longitude: data.geo.longitude,
              region: data.geo.region,
              regionCode: data.geo.regionCode,
              postalCode: data.geo.postalCode || null,
              timezone: data.geo.timezone,
              device: data.userAgent.device,
              browser: data.userAgent.browser,
              browserVersion: data.userAgent.browserVersion,
              os: data.userAgent.os,
              osVersion: data.userAgent.osVersion,
              brand: data.userAgent.brand,
              referrer: data.referrer || null,
              queryParams: data.query,
              ruleKey: ruleKey,
              userAgentRaw: data.userAgent.raw,
              asn: data.cf.asn,
              asOrganization: data.cf.asOrganization,
              colo: data.cf.colo,
              clientTrustScore: data.cf.clientTrustScore,
              httpProtocol: data.cf.httpProtocol,
              tlsVersion: data.cf.tlsVersion,
              tlsCipher: data.cf.tlsCipher,
              platformId: jsRedirectPlatformId || null,
              platformClickId: jsRedirectPlatformClickId || null,
            });
          })()
        );
        
        // JS redirect with device detection beacon
        const jsRedirect = `(function(){var d={impressionId:'${jsRedirectEventId}',screen:screen.width+'x'+screen.height,dpr:window.devicePixelRatio||1,tz:Intl.DateTimeFormat().resolvedOptions().timeZone};try{var c=document.createElement('canvas').getContext('webgl');if(c){var x=c.getExtension('WEBGL_debug_renderer_info');if(x)d.gpu=c.getParameter(x.UNMASKED_RENDERER_WEBGL);}}catch(e){}navigator.sendBeacon('/t/enrich',JSON.stringify(d));window.location.href="${jsRedirectUrl}";})();`;
        return new Response(jsRedirect, { headers: { 'Content-Type': 'application/javascript' } });
      case 'folder':
        // This action is not supported for JS Snippet integration as it implies self-hosting.
        // We serve an empty response. A console warning could be added.
        const folderHeaders = new Headers({ 'Content-Type': 'application/javascript' });
        addAcceptCHHeaders(folderHeaders);
        return new Response('/* "folder" rule is not supported in JS Snippet mode */', { headers: folderHeaders });
    }
  } else {
    // --- DNS Proxy Delivery ---
    switch (finalAction.type) {
      case 'modifications':
        // Fetch the original page content
        const originUrl = new URL(c.req.url);
        const originResponse = await handleInitialProxyRequest(c, originUrl.origin, data, reason, finalAction.variables);

        // Build the rewriter from the modifications
        const rewriter = new HTMLRewriter();
        for (const mod of finalAction.payload) {
          rewriter.on(mod.selector, {
            element(element) {
              switch (mod.action) {
                case 'setText':
                  element.setInnerContent(mod.value as string);
                  break;
                case 'setHtml':
                   element.setInnerContent(mod.value as string, { html: true });
                   break;
                case 'setCss':
                  const style = element.getAttribute('style') || '';
                  const newStyle = Object.entries(mod.value as Record<string, string>)
                    .map(([k, v]) => `${k}:${v}`)
                    .join(';');
                  element.setAttribute('style', `${style};${newStyle}`);
                  break;
                case 'setAttribute':
                  const attr = mod.value as { name: string; value: string };
                  element.setAttribute(attr.name, attr.value);
                  break;
                case 'remove':
                  element.remove();
                  break;
              }
            },
          });
        }
        const modResponse = rewriter.transform(originResponse);
        
        // Store impression for modifications only if we successfully served a page (200 OK)
        // Track paths that are: root (/), end with slash (/test/), or are HTML files
        if (originResponse.ok && data.impressionId && (data.path === '/' || data.path.endsWith('/') || data.path.endsWith('.html') || data.path.endsWith('.htm'))) {
          console.log('[IMP] queue storeEvent (modifications)', { impressionId: data.impressionId, path: data.path, domain: data.domain });
          c.executionCtx.waitUntil(
            (async () => {
              const campaignId = rule.id || '';
              const originUrl = new URL(c.req.url);
              const { landingPage, landingPageMode } = extractLandingPageInfo(finalAction);
              await storeEvent({
                eventId: data.impressionId!,
                sessionId: data.sessionId || generateSessionId(data),
                campaignId: campaignId,
                isImpression: true,
                isClick: false,
                domain: data.domain,
                path: data.path,
                landingPage: landingPage || originUrl.origin, // For modifications, use origin URL
                landingPageMode: landingPageMode || 'proxy', // Modifications are proxied
                ip: data.ip,
                country: data.geo.country,
                city: data.geo.city,
                continent: data.geo.continent,
                latitude: data.geo.latitude,
                longitude: data.geo.longitude,
                region: data.geo.region,
                regionCode: data.geo.regionCode,
                postalCode: data.geo.postalCode || null,
                timezone: data.geo.timezone,
                device: data.userAgent.device,
                browser: data.userAgent.browser,
                browserVersion: data.userAgent.browserVersion,
                os: data.userAgent.os,
                osVersion: data.userAgent.osVersion,
                brand: data.userAgent.brand,
                referrer: data.referrer || null,
                isBot: data.isBot || false,
                queryParams: data.query,
                ruleKey: ruleKey,
                userAgentRaw: data.userAgent.raw,
                asn: data.cf.asn,
                asOrganization: data.cf.asOrganization,
                colo: data.cf.colo,
                clientTrustScore: data.cf.clientTrustScore,
                httpProtocol: data.cf.httpProtocol,
                tlsVersion: data.cf.tlsVersion,
                tlsCipher: data.cf.tlsCipher,
              });
            })()
          );
        }
        
        return modResponse;
      case 'proxy':
        const proxyResponse = await handleInitialProxyRequest(c, finalAction.payload, data, reason, finalAction.variables);
        
        // Store impression for proxy only if we successfully served a page (200 OK)
        // Track paths that are: root (/), end with slash (/test/), or are HTML files
        if (proxyResponse.ok && data.impressionId && (data.path === '/' || data.path.endsWith('/') || data.path.endsWith('.html') || data.path.endsWith('.htm'))) {
          console.log('[IMP] queue storeEvent (proxy)', { impressionId: data.impressionId, path: data.path, domain: data.domain });
          c.executionCtx.waitUntil(
            (async () => {
              const campaignId = rule.id || '';
              const { landingPage, landingPageMode } = extractLandingPageInfo(finalAction);
              
              // Extract platform info for impressions (from D1 only)
              const impressionPlatformLookup = await getPlatformInfoForCampaign(rule.id);
              const impressionPlatformId = impressionPlatformLookup.platformId;
              const impressionPlatformClickId = impressionPlatformLookup.clickIdParam ? data.query[impressionPlatformLookup.clickIdParam] : null;
              
              await storeEvent({
                eventId: data.impressionId!,
                sessionId: data.sessionId || generateSessionId(data),
                campaignId: campaignId,
                isImpression: true,
                isClick: false,
                domain: data.domain,
                path: data.path,
                landingPage,
                landingPageMode,
                ip: data.ip,
                country: data.geo.country,
                city: data.geo.city,
                continent: data.geo.continent,
                latitude: data.geo.latitude,
                longitude: data.geo.longitude,
                region: data.geo.region,
                regionCode: data.geo.regionCode,
                postalCode: data.geo.postalCode || null,
                timezone: data.geo.timezone,
                device: data.userAgent.device,
                browser: data.userAgent.browser,
                browserVersion: data.userAgent.browserVersion,
                os: data.userAgent.os,
                osVersion: data.userAgent.osVersion,
                brand: data.userAgent.brand,
                referrer: data.referrer || null,
                isBot: data.isBot || false,
                queryParams: data.query,
                ruleKey: ruleKey,
                userAgentRaw: data.userAgent.raw,
                asn: data.cf.asn,
                asOrganization: data.cf.asOrganization,
                colo: data.cf.colo,
                clientTrustScore: data.cf.clientTrustScore,
                httpProtocol: data.cf.httpProtocol,
                tlsVersion: data.cf.tlsVersion,
                tlsCipher: data.cf.tlsCipher,
                platformId: impressionPlatformId || null,
                platformClickId: impressionPlatformClickId || null,
              });
            })()
          );
        }
        
        return proxyResponse;
      case 'redirect':
        // For redirect campaigns, only match exact path (no path traversal)
        // Extract the path from the rule key (ruleKey is like "domain.com/path")
        const rulePath = (ruleKey || '').replace(data.domain || '', '') || '/';
        // Normalize both paths: remove trailing slash unless it's root
        const normalizedRulePath = rulePath === '' ? '/' : rulePath.replace(/\/$/, '');
        const normalizedRequestPath = data.path === '' ? '/' : data.path.replace(/\/$/, '');
        
        // If paths don't match exactly, return custom 404 page (don't redirect or track)
        if (normalizedRulePath !== normalizedRequestPath) {
          console.log('[SKIP] Redirect path mismatch:', { rulePath: normalizedRulePath, requestPath: normalizedRequestPath, ruleKey });
          return await serveNotFoundPage(c, data, `Path mismatch: rule configured for "${normalizedRulePath}" but request was "${normalizedRequestPath}"`);
        }
        
        // Generate event ID for redirect (same ID for impression+click since they're one event)
        const redirectEventId = data.impressionId || generateUniqueId('evt');
        const redirectSessionId = data.sessionId || generateSessionId(data);
        // For redirect campaigns: impression and click are the same event, so use same ID
        const redirectImpressionId = redirectEventId;
        const redirectClickId = redirectEventId;  // Same ID since it's one event
        
        // Get platform info for click (from D1 only)
        const redirectPlatformLookup = await getPlatformInfoForCampaign(rule.id);
        const redirectPlatformId = redirectPlatformLookup.platformId;
        const redirectPlatformClickId = redirectPlatformLookup.clickIdParam ? data.query[redirectPlatformLookup.clickIdParam] : null;
        
        // Replace macros in the redirect URL (e.g., {{query.fbclid}}, {{user.CITY}}, {{campaign.id}}, {{click.id}}, {{platform.name}}, {{platform.click_id}})
        const redirectMacroContext: MacroContext = {
          campaignId: rule.id,
          campaignName: rule.name,
          siteName: rule.siteName,
          sessionId: redirectSessionId,
          impressionId: redirectImpressionId,
          clickId: redirectClickId,  // Same as impressionId for redirect campaigns
          platformId: redirectPlatformId || undefined,
          platformName: redirectPlatformLookup.platformName || undefined,
          platformClickId: redirectPlatformClickId || undefined,
        };
        const redirectUrl = replaceMacrosInUrl(finalAction.payload, data, finalAction.variables, redirectMacroContext);
        
        // Queue event store for redirects (path already validated - exact match only)
        // For redirect campaigns: one event with both is_impression=true AND is_click=true
        console.log('[EVT] queue storeEvent (redirect)', { eventId: redirectEventId, path: data.path, domain: data.domain });
        c.executionCtx.waitUntil(
          (async () => {
            const campaignId = rule.id || '';
            await storeEvent({
              eventId: redirectEventId,  // Same ID for impression and click (one event)
              sessionId: redirectSessionId,
              campaignId: campaignId,
              isImpression: true,
              isClick: true,  // Redirect = impression + click in one event
              domain: data.domain,
              path: data.path,
              landingPage: finalAction.payload,
              landingPageMode: 'redirect',
              destinationUrl: redirectUrl,
              destinationId: rule.destinationId || null, // Use top-level destinationId if available
              matchedFlags: [],
              ip: data.ip,
              country: data.geo.country,
              city: data.geo.city,
              continent: data.geo.continent,
              latitude: data.geo.latitude,
              longitude: data.geo.longitude,
              region: data.geo.region,
              regionCode: data.geo.regionCode,
              postalCode: data.geo.postalCode || null,
              timezone: data.geo.timezone,
              device: data.userAgent.device,
              browser: data.userAgent.browser,
              browserVersion: data.userAgent.browserVersion,
              os: data.userAgent.os,
              osVersion: data.userAgent.osVersion,
              brand: data.userAgent.brand,
              referrer: data.referrer || null,
              queryParams: data.query,
              ruleKey: ruleKey,
              userAgentRaw: data.userAgent.raw,
              asn: data.cf.asn,
              asOrganization: data.cf.asOrganization,
              colo: data.cf.colo,
              clientTrustScore: data.cf.clientTrustScore,
              httpProtocol: data.cf.httpProtocol,
              tlsVersion: data.cf.tlsVersion,
              tlsCipher: data.cf.tlsCipher,
              platformId: redirectPlatformId || null,
              platformClickId: redirectPlatformClickId || null,
            });
          })()
        );
        
        // Latency Optimized Redirect: Only use JS redirect if server-side signals are insufficient
        // Desktop: Just need OS version (no model needed)
        // Mobile: Need model detection for Safari iOS only
        const isDesktop = data.userAgent.device === 'desktop' || !data.userAgent.device;
        const hasAccurateOSVersion = data.userAgent.osVersion && data.userAgent.osVersion !== '10.15.7' && data.userAgent.osVersion !== '10.0';
        const isSafariIOS = (data.userAgent.browser === 'Safari' || data.userAgent.browser === 'Mobile Safari' || !data.userAgent.browser) && data.userAgent.os === 'iOS';
        
        // Skip JS redirect for: Desktop with OS version, OR mobile with Client Hints (Chrome/Edge)
        const skipJSRedirect = isDesktop ? hasAccurateOSVersion : (hasAccurateOSVersion && !isSafariIOS);

        if (skipJSRedirect) {
          // Standard 302 redirect (Zero Latency)
          console.log('[REDIR] Standard 302 redirect (signals sufficient)', { os: data.userAgent.os, version: data.userAgent.osVersion });
          return new Response(null, {
            status: 302,
            headers: {
              'Location': redirectUrl,
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Pragma': 'no-cache',
              'Expires': '0'
            }
          });
        }

        // Use JS redirect with device detection instead of 302
        // This adds ~50ms but captures screen/GPU/device model
        console.log('[REDIR] JS redirect with detection', { isSafariIOS, hasAccurateOSVersion });
        const redirectHtml = getRedirectWithDetection(redirectEventId, redirectUrl);
        return new Response(redirectHtml, { 
          status: 200, 
          headers: { 
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          } 
        });
      case 'folder':
        // The logic that sets finalAction.type has already confirmed this is not a URL.
        // Check if payload is a file path (has extension) - if so, don't add trailing slash
        const payloadIsFile = finalAction.payload.includes('.') && /\.(html|htm|css|js|mjs|jsx|ts|tsx|svg|png|jpg|jpeg|gif|webp|ico|json|map|woff|woff2|ttf|otf|eot|mp4|webm|ogg|mp3|wav|pdf|txt|xml|csv|wasm|zip|gz|br|avif|heic|webmanifest)$/i.test(finalAction.payload);
        const folderPath = payloadIsFile ? finalAction.payload : `${finalAction.payload}/`;
        const folderResponse = await servePublicFile(c, folderPath, data, reason, finalAction.variables, rule.id);
        
        // Store impression for page views only if we successfully served a page (200 OK)
        // Track paths that are: root (/), end with slash (/test/), or are HTML files
        if (folderResponse.ok && data.impressionId && (data.path === '/' || data.path.endsWith('/') || data.path.endsWith('.html') || data.path.endsWith('.htm'))) {
          console.log('[IMP] queue storeEvent (folder)', { impressionId: data.impressionId, path: data.path, domain: data.domain });
          c.executionCtx.waitUntil(
            (async () => {
              const campaignId = rule.id || '';
              const { landingPage, landingPageMode } = extractLandingPageInfo(finalAction);
              
              // Extract platform info for impressions (from D1 only)
              const impressionPlatformLookup = await getPlatformInfoForCampaign(rule.id);
              const impressionPlatformId = impressionPlatformLookup.platformId;
              const impressionPlatformClickId = impressionPlatformLookup.clickIdParam ? data.query[impressionPlatformLookup.clickIdParam] : null;
              
              await storeEvent({
                eventId: data.impressionId!,
                sessionId: data.sessionId || generateSessionId(data),
                campaignId: campaignId,
                isImpression: true,
                isClick: false,
                domain: data.domain,
                path: data.path,
                landingPage,
                landingPageMode,
                ip: data.ip,
                country: data.geo.country,
                city: data.geo.city,
                continent: data.geo.continent,
                latitude: data.geo.latitude,
                longitude: data.geo.longitude,
                region: data.geo.region,
                regionCode: data.geo.regionCode,
                postalCode: data.geo.postalCode || null,
                timezone: data.geo.timezone,
                device: data.userAgent.device,
                browser: data.userAgent.browser,
                browserVersion: data.userAgent.browserVersion,
                os: data.userAgent.os,
                osVersion: data.userAgent.osVersion,
                brand: data.userAgent.brand,
                referrer: data.referrer || null,
                isBot: data.isBot || false,
                queryParams: data.query,
                ruleKey: ruleKey,
                userAgentRaw: data.userAgent.raw,
                asn: data.cf.asn,
                asOrganization: data.cf.asOrganization,
                colo: data.cf.colo,
                clientTrustScore: data.cf.clientTrustScore,
                httpProtocol: data.cf.httpProtocol,
                tlsVersion: data.cf.tlsVersion,
                tlsCipher: data.cf.tlsCipher,
                platformId: impressionPlatformId || null,
                platformClickId: impressionPlatformClickId || null,
              });
            })()
          );
        }
        
        return folderResponse;
    }
  }

  // Fallback, should not be reached
  return new Response("An unexpected error occurred in the rule engine.", { status: 500 });
}

// Helper to resolve new defaultDestinations/defaultOffers arrays to legacy format
async function resolveDefaultDestinations(rule: KVRule, c: any): Promise<void> {
  // New array format takes precedence
  if (rule.defaultDestinations && rule.defaultDestinations.length > 0) {
    // Pick a landing page based on weights
    const totalWeight = rule.defaultDestinations.reduce((sum, d) => sum + (d.weight || 1), 0);
    const random = Math.random() * totalWeight;
    let cumWeight = 0;
    let selectedLP = rule.defaultDestinations[0];
    
    for (const dest of rule.defaultDestinations) {
      cumWeight += dest.weight || 1;
      if (random <= cumWeight) {
        selectedLP = dest;
        break;
      }
    }
    
    // Set the landing page
    rule.defaultFolder = selectedLP.value;
    rule.defaultFolderMode = selectedLP.mode || (selectedLP.value.startsWith('http') ? 'proxy' : 'hosted');
    
    // If LP has nested offers, pick one for click-outs
    if (selectedLP.offers && selectedLP.offers.length > 0) {
      const offerTotalWeight = selectedLP.offers.reduce((sum, o) => sum + (o.weight || 1), 0);
      const offerRandom = Math.random() * offerTotalWeight;
      let offerCumWeight = 0;
      let selectedOffer = selectedLP.offers[0];
      
      for (const offer of selectedLP.offers) {
        offerCumWeight += offer.weight || 1;
        if (offerRandom <= offerCumWeight) {
          selectedOffer = offer;
          break;
        }
      }
      
      // Resolve offer ID to URL
      const offerUrl = await getDestinationUrl(selectedOffer.id, c);
      if (offerUrl) {
        rule.destinationId = selectedOffer.id;
        // Store the resolved offer URL for click-outs (using a temp field won't work, 
        // so we rely on destinationId being looked up when needed)
      }
    }
    return;
  }
  
  // Direct offers (no LP) - redirect directly to offer
  if (rule.defaultOffers && rule.defaultOffers.length > 0) {
    const totalWeight = rule.defaultOffers.reduce((sum, o) => sum + (o.weight || 1), 0);
    const random = Math.random() * totalWeight;
    let cumWeight = 0;
    let selectedOffer = rule.defaultOffers[0];
    
    for (const offer of rule.defaultOffers) {
      cumWeight += offer.weight || 1;
      if (random <= cumWeight) {
        selectedOffer = offer;
        break;
      }
    }
    
    // Resolve offer ID to URL
    const offerUrl = await getDestinationUrl(selectedOffer.id, c);
    if (offerUrl) {
      rule.defaultFolder = offerUrl;
      rule.defaultFolderMode = 'redirect';
      rule.destinationId = selectedOffer.id;
    }
    return;
  }
  
  // Legacy format - resolve single destinationId if present
  if (rule.destinationId && !rule.defaultFolder) {
    const destinationUrl = await getDestinationUrl(rule.destinationId, c);
    if (destinationUrl) {
      rule.defaultFolder = destinationUrl;
      rule.defaultFolderMode = rule.defaultFolderMode || 'redirect';
    } else {
      console.error(`Destination ${rule.destinationId} not found`);
      rule.defaultFolder = '';
    }
  }
  
  // Ensure defaultFolder is always a string
  if (!rule.defaultFolder) {
    rule.defaultFolder = '';
  }
}

// Function to get rule from KV storage
export async function getKVRule(c: any, domain: string, path: string): Promise<{ rule: KVRule, key: string } | null> {
  try {
    let currentPath = path;

    // Loop from the full path down to the root
    while (true) {
      // Try exact domain+path match
      const keyWithPath = `${domain}${currentPath}`;
      const ruleJson = await env.KV.get(keyWithPath);
      if (ruleJson) {
        const rule = JSON.parse(ruleJson) as KVRule;
        await resolveDefaultDestinations(rule, c);
        return { rule, key: keyWithPath };
      }

      // If path has a trailing slash (and isn't just "/"), try without it
      if (currentPath.endsWith('/') && currentPath.length > 1) {
        const keyWithoutSlash = keyWithPath.slice(0, -1);
        const ruleJsonWithoutSlash = await env.KV.get(keyWithoutSlash);
        if (ruleJsonWithoutSlash) {
          const rule = JSON.parse(ruleJsonWithoutSlash) as KVRule;
          await resolveDefaultDestinations(rule, c);
          return { rule, key: keyWithoutSlash };
        }
      }

      // If path doesn't have a trailing slash (and isn't just "/"), try with it
      if (!currentPath.endsWith('/') && currentPath !== '/') {
        const keyWithSlash = `${keyWithPath}/`;
        const ruleJsonWithSlash = await env.KV.get(keyWithSlash);
        if (ruleJsonWithSlash) {
          const rule = JSON.parse(ruleJsonWithSlash) as KVRule;
          await resolveDefaultDestinations(rule, c);
          return { rule, key: keyWithSlash };
        }
      }

      if (currentPath === '/') {
        // At root path - try domain/ one more time, then break
        // (This handles the case where rule is stored at domain/)
        break;
      }

      // Move to the parent directory
      const lastSlash = currentPath.lastIndexOf('/');
      if (lastSlash > 0) {
        currentPath = currentPath.substring(0, lastSlash);
      } else {
        currentPath = '/';
      }
    }

    // Compatibility fallback: Only for root path requests, try domain-only (no slash)
    // This handles legacy rules stored as "domain" instead of "domain/"
    // But ONLY for root path - prevents /.env from matching domain-only rules
    if (path === '/') {
      const keyDomainOnly = domain;
      const ruleJsonDomain = await env.KV.get(keyDomainOnly);
      if (ruleJsonDomain) {
        const rule = JSON.parse(ruleJsonDomain) as KVRule;
        await resolveDefaultDestinations(rule, c);
        return { rule, key: keyDomainOnly };
      }
    }
    // For non-root paths (like /.env), no domain-only fallback - exact match required
  } catch (error) {
    console.error(`Error fetching rule from KV: ${error}`);
  }

  return null;
}

async function serveNotFoundPage(c: any, data: RequestData, reason: string): Promise<Response> {
  console.log(reason);

  console.log(JSON.stringify({
    message: `Serving 404 page: ${reason}`,
    timestamp: new Date().toISOString(),
    ip: data.ip,
    org: data.org,
    referrer: data.referrer,
    userAgent: data.userAgent,
    geo: data.geo,
    cf: data.cf,
    domain: data.domain,
    path: data.path,
    query: data.query
  }));

  const notFoundData = { ...data, path: '/error.html', query: {} };
  
  // Add error-specific variables for macro replacement
  const errorVariables: Record<string, string> = {
    'error.STATUS': '404',
    'error.TITLE': 'Deployment Incomplete',
    'error.CODE': 'NO_RULE',
    'error.MESSAGE': 'The domain is correctly pointed to Tracked, but no campaign or site has been assigned to this path yet.',
    'ray_id': data.impressionId || generateUniqueId('err'),
  };

  // Generate all user variables and merge with error variables
  const allVariables = populateMacros(data, errorVariables);

  const errorPageResponse = await servePublicFile(c, '', notFoundData, "Serving custom 404 page", allVariables);

  if (errorPageResponse.ok) {
    return new Response(errorPageResponse.body, {
      status: 404,
      headers: errorPageResponse.headers,
    });
  }
  
  // If servePublicFile failed, return its response (e.g., a generic 404 or 500)
  return errorPageResponse;
}

export interface WorkerRule {
  condition: (request: RequestData) => boolean;
  action: (c: any, data: RequestData) => Promise<Response>;
}

export const rules: WorkerRule[] = [
  // KV-based rule lookup
  {
    condition: (data: RequestData) => !!data.domain, // Apply to any domain
    action: async (c: any, data: RequestData) => {
      if (!data.domain) {
        return new Response("No domain provided", { status: 400 });
      }
      
      // Get rule from KV
      const kvRuleResult = await getKVRule(c, data.domain, data.path);
      
      if (kvRuleResult) {
        const { rule: kvRule, key: ruleKey } = kvRuleResult;
        // Only log for main page requests
        if (data.path === '/' || data.path === '/index.html' || data.path === '/index.htm') {
          console.log(JSON.stringify({
            action: "RULE_FOUND",
            domain: data.domain,
            path: data.path,
            ruleKey: ruleKey
          }));
        }
        return await applyKVRule(c, data, kvRule, ruleKey);
      }
      
      // Referrer-based proxy fallback for assets loaded by a proxied page
      if (data.referrer) {
        try {
          const refUrl = new URL(data.referrer);
          // Only attempt if same host as current request
          if (!data.domain || refUrl.host === data.domain) {
            const refKv = await getKVRule(c, data.domain || refUrl.host, refUrl.pathname);
            const refDefaultFolder = refKv?.rule.defaultFolder || '';
            if (refKv && (refDefaultFolder.startsWith('http://') || refDefaultFolder.startsWith('https://'))) {
              const baseUrl = refDefaultFolder;
              const targetUrl = new URL(data.path, baseUrl).toString();
              return await fetchAndStreamAsset(c, targetUrl, baseUrl);
            }
          }
        } catch (_) {
          // ignore URL parse errors
        }
      }

      // Fallback: No rule found, serve clean content with basic security
      const reason = `No rule found for domain ${data.domain}, serving custom error page`;
      
      // Only log for main page requests
      if ((data.path === '/' || data.path === '/index.html') && 
          (data.cf.clientTrustScore && data.cf.clientTrustScore < 10)) {
        console.log(JSON.stringify({
          action: "FALLBACK_BLOCKED",
          domain: data.domain,
          ip: data.ip,
          country: data.geo.country,
          trustScore: data.cf.clientTrustScore,
          reason: reason
        }));
      }
      
      // In a true fallback where KVRule is null, we don't know custom clean/dirty paths.
      // Defaulting to 'c/' as a hardcoded ultimate fallback.
      // This part of the code (KVRule is null) might need to be re-evaluated
      // if 'c/' is not guaranteed to exist.
      // For now, assuming 'c/' is the ultimate safe fallback.
      return await serveNotFoundPage(c, data, reason);
    },
  },
];

function replaceMacros(html: string, variables: Record<string, string>): string {
  if (!variables || Object.keys(variables).length === 0) return html;

  let content = html;

  // Build a case-insensitive lookup map
  const lowerCaseMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    lowerCaseMap[key.toLowerCase()] = value;
  }

  // Step 1: Temporarily protect escaped macros written as {{!key}} (case-insensitive)
  const escapedPlaceholders: Map<string, string> = new Map();
  content = content.replace(/\{\{!([^}]+)\}\}/gi, (match, macroName) => {
    const placeholder = `__ESC_${macroName.replace(/[^a-zA-Z0-9_]/g, '_')}_${escapedPlaceholders.size}__`;
    escapedPlaceholders.set(placeholder, `{{${macroName}}}`);
    return placeholder;
  });

  // Step 2: Replace normal macros (case-insensitive)
  content = content.replace(/\{\{([^}]+)\}\}/g, (match, macroName) => {
    const lowerKey = macroName.toLowerCase();
    if (lowerKey in lowerCaseMap) {
      return lowerCaseMap[lowerKey];
    }
    // Return original if no match found
    return match;
  });

  // Step 3: Restore escaped macros back to their original form (without the !)
  escapedPlaceholders.forEach((literal, placeholder) => {
    content = content.replaceAll(placeholder, literal);
  });

  return content;
}

/**
 * Replace macros in a redirect URL (case-insensitive)
 * Supports both {{key}} format for direct replacement and URL encoding
 * Example: https://site.com?sub1={{query.fbclid}}&city={{user.CITY}}&cid={{campaign.id}}
 */
function replaceMacrosInUrl(url: string, data: RequestData, variables?: Record<string, string>, context?: MacroContext): string {
  const allVariables = populateMacros(data, variables, context);
  
  // Build a case-insensitive lookup map
  const lowerCaseMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(allVariables)) {
    lowerCaseMap[key.toLowerCase()] = value;
  }
  
  // Replace macros with URL-encoded values for query string safety (case-insensitive)
  return url.replace(/\{\{([^}]+)\}\}/g, (match, macroName) => {
    const lowerKey = macroName.toLowerCase();
    if (lowerKey in lowerCaseMap) {
      return encodeURIComponent(lowerCaseMap[lowerKey]);
    }
    // Return original if no match found
    return match;
  });
} 