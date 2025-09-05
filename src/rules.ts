import { env } from "cloudflare:workers";

export interface RuleFlags {
  country?: string;      // Country code that must match
  language?: string;     // Browser language that must match
  time?: {
    start: number;       // UTC hour (0-23)
    end: number;         // UTC hour (0-23)
  };
  params?: {             // URL parameters that must match
    [key: string]: string;
  };
  device?: string;       // Device type that must match
  browser?: string;      // Browser that must match
  os?: string;          // OS that must match
  brand?: string;       // Device brand that must match (Apple, Samsung, etc)
  region?: string;      // Region/state that must match
  org?: string;         // Organization wildcard to match (NEW)
}

export interface Rule {
  flags: RuleFlags;     // All conditions that must match
  folder?: string;       // Folder to serve if ALL flags match
  fetchUrl?: string;    // URL to fetch if ALL flags match
  variables?: Record<string, string>; // Optional macros to replace in HTML
}

export interface KVRule {
  rules: Rule[];                // List of rules to check in order
  defaultFolder: string;        // Default folder if no rules match
  variables?: Record<string, string>; // Default macros for default folder
  blocks?: BlockRules;         // Blocking rules (always serve defaultFolder)
}

export interface RequestData {
  domain: string | null;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  ip: string | null;
  org: string | null;
  referrer?: string | null;
  userAgent: {
    browser: string | null;    // "Chrome", "Firefox", etc
    browserVersion: string | null;
    os: string | null;        // "Windows", "iOS", etc
    osVersion: string | null;
    device: string | null;    // "Mobile", "Desktop", "Tablet"
    brand: string | null;     // "Apple", "Samsung", "Huawei", etc
    raw: string | null;       // Full user-agent string
  };
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
    return new Response(content, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  } catch (error: any) {
    console.error(`Exception fetching remote URL ${url}: ${error.message}`);
    return new Response("Error: Exception during remote content serving.", { status: 500 });
  }
}

// Helper function to serve a local file from /public
async function servePublicFile(c: any, baseDir: string, data: RequestData, reason: string, variables?: Record<string, string>): Promise<Response> {
  console.log("SERVE_PUBLIC_FILE_CALLED: baseDir=", baseDir, "path=", data.path, "reason=", reason);
  
  // Normalize the base directory: remove leading/trailing slashes for consistency
  let normalizedBaseDir = baseDir.replace(/^\/+/, '').replace(/\/+$/, '');
  
  // Get the requested path and remove any leading slash
  let requestedPath = data.path.replace(/^\/+/, '');
  if (requestedPath === '' || data.path === '/') { // Handle root path explicitly
    requestedPath = 'index.html';
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
        if (data.path === '/error.html') {
          // To prevent an infinite loop if error.html is missing, we stop here.
          return new Response('Not Found, and the error page is also missing.', { status: 500 });
        }
        return serveNotFoundPage(c, data, `Asset not found: ${fullAssetPath}`);
      }

      // Handle macro replacement for HTML and CSS content
      if (data.path === '/' || data.path.endsWith('.html') || data.path.endsWith('.css')) {
        const contentType = alternateAssetResponse.headers.get('content-type') || '';
        if (contentType.includes('text/html') || contentType.includes('text/css') || data.path.endsWith('.css')) {
          let content = await alternateAssetResponse.text();
          
          const allReplaceableVariables = populateMacros(data, variables);

          content = replaceMacros(content, allReplaceableVariables);
          
          const newHeaders = new Headers(alternateAssetResponse.headers);
          return new Response(content, {
            status: alternateAssetResponse.status,
            statusText: alternateAssetResponse.statusText,
            headers: newHeaders,
          });
        }
      }

      return new Response(alternateAssetResponse.body, {
        status: alternateAssetResponse.status,
        statusText: alternateAssetResponse.statusText,
        headers: alternateAssetResponse.headers,
      });
    }

    // Handle macro replacement for HTML and CSS content
    if (data.path === '/' || data.path.endsWith('.html') || data.path.endsWith('.css')) {
      const contentType = assetResponse.headers.get('content-type') || '';
      if (contentType.includes('text/html') || contentType.includes('text/css') || data.path.endsWith('.css')) {
        let content = await assetResponse.text();
        
        const allReplaceableVariables = populateMacros(data, variables);

        content = replaceMacros(content, allReplaceableVariables);
        
        const newHeaders = new Headers(assetResponse.headers);
        return new Response(content, {
          status: assetResponse.status,
          statusText: assetResponse.statusText,
          headers: newHeaders,
        });
      }
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
    const targetUrl = new URL(data.path, baseUrl);
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

    return new Response(remoteResponse.body, {
        status: remoteResponse.status,
        statusText: remoteResponse.statusText,
        headers: newHeaders,
    });
}

function populateMacros(data: RequestData, variables?: Record<string, string>): Record<string, string> {
    const allReplaceableVariables: Record<string, string> = { ...(variables || {}) };

    const addUserVariable = (key: string, value: string | number | null | undefined) => {
        allReplaceableVariables[key] = (value === null || value === undefined) ? '' : String(value);
    };

    addUserVariable('user.IP', data.ip);
    addUserVariable('user.CITY', data.geo.city);
    addUserVariable('user.COUNTRY', data.geo.country);
    addUserVariable('user.GEO', data.geo.country);
    addUserVariable('user.COUNTRY_CODE', data.geo.country);
    addUserVariable('user.REGION_NAME', data.geo.region);
    addUserVariable('user.REGION_CODE', data.geo.regionCode);
    addUserVariable('user.POSTAL_CODE', data.geo.postalCode);
    addUserVariable('user.LATITUDE', data.geo.latitude);
    addUserVariable('user.LONGITUDE', data.geo.longitude);
    addUserVariable('user.TIMEZONE', data.geo.timezone);
    addUserVariable('user.DEVICE', data.userAgent.device);
    addUserVariable('user.BROWSER', data.userAgent.browser);
    addUserVariable('user.BROWSER_VERSION', data.userAgent.browserVersion);
    addUserVariable('user.OS', data.userAgent.os);
    addUserVariable('user.OS_VERSION', data.userAgent.osVersion);
    addUserVariable('user.BRAND', data.userAgent.brand);
    addUserVariable('user.ORGANIZATION', data.org);
    addUserVariable('user.REFERRER', data.referrer);
    addUserVariable('user.COLO', data.cf.colo);

    if (data.query) {
        for (const [queryKey, queryValue] of Object.entries(data.query)) {
            addUserVariable(`query.${queryKey.replace(/[^a-zA-Z0-9_]/g, '_')}`, queryValue);
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
function checkSingleRule(data: RequestData, flags: RuleFlags, isAssetRequest: boolean): {
  matched: boolean;
  matchedFlagsList: string[]; // Return list to allow flexible joining
} {
  let allFlagsMatch = true;
  const matchedFlags: string[] = [];

  // Check params (sensitive to isAssetRequest)
  // If 'params' is a flag in the rule:
  // - If it's a main page request, the request's query params MUST match the rule's params.
  // - If it's an asset request, this rule (with 'params') is NOT considered a match.
  if (flags.params) {
    if (!isAssetRequest) { // Main page request
      for (const [key, value] of Object.entries(flags.params)) {
        if (data.query[key] !== value) {
          allFlagsMatch = false;
          break;
        }
        matchedFlags.push(`param:${key}=${value}`);
      }
    } else { // Asset request
      allFlagsMatch = false; // Rules with params are not directly matched by asset requests
    }
  }
  if (!allFlagsMatch) return { matched: false, matchedFlagsList: [] };

  // Check country
  if (flags.country) {
    if (data.geo.country !== flags.country) allFlagsMatch = false;
    else matchedFlags.push(`country:${flags.country}`);
  }
  if (!allFlagsMatch) return { matched: false, matchedFlagsList: [] };
  
  // Check Organization
  if (flags.org) {
    if (!data.org || !matchWildcard(data.org, flags.org)) allFlagsMatch = false;
    else matchedFlags.push(`org:${flags.org}`);
  }
  if (!allFlagsMatch) return { matched: false, matchedFlagsList: [] };

  // Check language
  if (flags.language) {
    const acceptLang = data.headers['accept-language'] || '';
    const primaryLang = acceptLang.split(',')[0].split('-')[0].toLowerCase();
    if (primaryLang !== flags.language) allFlagsMatch = false;
    else matchedFlags.push(`language:${flags.language}`);
  }
  if (!allFlagsMatch) return { matched: false, matchedFlagsList: [] };

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

    if (currentTimeInMinutes < startTimeInMinutes || currentTimeInMinutes >= endTimeInMinutes) {
      allFlagsMatch = false;
    } else {
      const formatTime = (h: number, m: number) => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      matchedFlags.push(`time:${formatTime(startHour, startMinute)}-${formatTime(endHour, endMinute)}`);
    }
  }
  if (!allFlagsMatch) return { matched: false, matchedFlagsList: [] };

  // Check device
  if (flags.device) {
    if (data.userAgent.device !== flags.device) allFlagsMatch = false;
    else matchedFlags.push(`device:${flags.device}`);
  }
  if (!allFlagsMatch) return { matched: false, matchedFlagsList: [] };

  // Check browser
  if (flags.browser) {
    if (data.userAgent.browser !== flags.browser) allFlagsMatch = false;
    else matchedFlags.push(`browser:${flags.browser}`);
  }
  if (!allFlagsMatch) return { matched: false, matchedFlagsList: [] };

  // Check OS
  if (flags.os) {
    if (!data.userAgent.os || !data.userAgent.os.includes(flags.os)) allFlagsMatch = false;
    else if (data.userAgent.os) matchedFlags.push(`os:${flags.os}`);
  }
  if (!allFlagsMatch) return { matched: false, matchedFlagsList: [] };

  // Check brand
  if (flags.brand) {
    if (data.userAgent.brand !== flags.brand) allFlagsMatch = false;
    else matchedFlags.push(`brand:${flags.brand}`);
  }
  if (!allFlagsMatch) return { matched: false, matchedFlagsList: [] };

  // Check region
  if (flags.region) {
    if (data.geo.regionCode !== flags.region) allFlagsMatch = false;
    else matchedFlags.push(`region:${flags.region}`);
  }
  if (!allFlagsMatch) return { matched: false, matchedFlagsList: [] };
  
  return { matched: allFlagsMatch, matchedFlagsList: matchedFlags };
}

async function applyKVRule(c: any, data: RequestData, rule: KVRule): Promise<Response> {
  let reason = "";
  let targetFolder = rule.defaultFolder;
  let ruleVariables = rule.variables; // Start with default variables
  let fetchUrl: string | undefined;

  // Detect if this is an asset request (not the main page)
  const isAssetRequest = data.path !== '/' && data.path !== '/index.html';

  // 1. Check blocks first
  if (rule.blocks) {
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
          if (rule.defaultFolder.startsWith('http://') || rule.defaultFolder.startsWith('https://')) {
            return handleInitialProxyRequest(c, rule.defaultFolder, data, reason, rule.variables);
          }
          return servePublicFile(c, `${rule.defaultFolder}/`, data, reason, rule.variables);
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
          if (rule.defaultFolder.startsWith('http://') || rule.defaultFolder.startsWith('https://')) {
            return handleInitialProxyRequest(c, rule.defaultFolder, data, reason, rule.variables);
          }
          return servePublicFile(c, `${rule.defaultFolder}/`, data, reason, rule.variables);
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
          if (rule.defaultFolder.startsWith('http://') || rule.defaultFolder.startsWith('https://')) {
            return handleInitialProxyRequest(c, rule.defaultFolder, data, reason, rule.variables);
          }
          return servePublicFile(c, `${rule.defaultFolder}/`, data, reason, rule.variables);
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
          if (rule.defaultFolder.startsWith('http://') || rule.defaultFolder.startsWith('https://')) {
            return handleInitialProxyRequest(c, rule.defaultFolder, data, reason, rule.variables);
          }
          return servePublicFile(c, `${rule.defaultFolder}/`, data, reason, rule.variables);
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
          if (rule.defaultFolder.startsWith('http://') || rule.defaultFolder.startsWith('https://')) {
            return handleInitialProxyRequest(c, rule.defaultFolder, data, reason, rule.variables);
          }
          return servePublicFile(c, `${rule.defaultFolder}/`, data, reason, rule.variables);
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
          if (rule.defaultFolder.startsWith('http://') || rule.defaultFolder.startsWith('https://')) {
            return handleInitialProxyRequest(c, rule.defaultFolder, data, reason, rule.variables);
          }
          return servePublicFile(c, `${rule.defaultFolder}/`, data, reason, rule.variables);
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
          if (rule.defaultFolder.startsWith('http://') || rule.defaultFolder.startsWith('https://')) {
            return handleInitialProxyRequest(c, rule.defaultFolder, data, reason, rule.variables);
          }
          return servePublicFile(c, `${rule.defaultFolder}/`, data, reason, rule.variables);
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
          if (rule.defaultFolder.startsWith('http://') || rule.defaultFolder.startsWith('https://')) {
            return handleInitialProxyRequest(c, rule.defaultFolder, data, reason, rule.variables);
          }
          return servePublicFile(c, `${rule.defaultFolder}/`, data, reason, rule.variables);
        }
      }
    }
  }

  // 2. Check each rule in order - first matching rule wins (MAIN LOOP)
  for (const ruleSet of rule.rules) {
    const { matched, matchedFlagsList } = checkSingleRule(data, ruleSet.flags, isAssetRequest);
    if (matched) {
      if (ruleSet.fetchUrl) {
        fetchUrl = ruleSet.fetchUrl;
        targetFolder = ''; // Ensure folder is not used
      } else if (ruleSet.folder) {
      targetFolder = ruleSet.folder;
        fetchUrl = undefined; // Ensure fetchUrl is not used
      }
      ruleVariables = ruleSet.variables || rule.variables; // Use ruleSet variables or fallback to default
      const matchedFlagsString = matchedFlagsList.join(', ');
      if (isAssetRequest) {
        reason = `Asset request - matched rule directly [${matchedFlagsString}]`;
      } else {
        reason = `Matched rule [${matchedFlagsString}]`;
      }
      break; // Found a direct match
    }
  }

  // If no direct match was found (reason is still "") and this is an asset request
  if (reason === "" && isAssetRequest) {
    // ASSET INHERITANCE LOGIC:
    // For assets that didn't match directly, try matching rules again, but ignore 'params' criteria.
    // This helps assets be served from the same folder as a page that was matched using params.
    for (const ruleSet of rule.rules) {
      const flagsWithoutParams = { ...ruleSet.flags };
      delete flagsWithoutParams.params; // Critically, ignore 'params' for this inheritance check

      // Call checkSingleRule with isAssetRequest=true (though params are deleted, other logic might use it)
      // and the modified flags.
      const { matched, matchedFlagsList } = checkSingleRule(data, flagsWithoutParams, true /*isAssetRequest*/);

      if (matched) {
        if (ruleSet.fetchUrl) {
          fetchUrl = ruleSet.fetchUrl;
          targetFolder = '';
        } else if (ruleSet.folder) {
        targetFolder = ruleSet.folder;
          fetchUrl = undefined;
        }
        ruleVariables = ruleSet.variables || rule.variables;
        const matchedFlagsString = matchedFlagsList.join(', ');
        reason = `Asset request - inheriting folder via rule [${matchedFlagsString}] (original rule's params ignored)`;
        break; // Found an inheriting rule
      }
    }
    
    // If loop finishes and reason is still "", means no inheritance found either.
    if (reason === "") {
      reason = `Asset request - no rules matched (direct or inherited), using default folder`;
      // targetFolder remains rule.defaultFolder, ruleVariables remain rule.variables
    }
  } else if (reason === "") { // Not an asset, and no direct match from main loop
     reason = `No rules matched, using default folder`;
     // targetFolder remains rule.defaultFolder, ruleVariables remain rule.variables
  }
  
  // Log the decision for main page requests
  if (data.path === '/' || data.path === '/index.html') {
    console.log(JSON.stringify({
      action: "RULE_DECISION",
      domain: data.domain,
      ip: data.ip,
      country: data.geo.country,
      language: data.headers['accept-language'],
      referrer: data.referrer,
      userAgent: data.userAgent,
      reason: reason,
      folder: targetFolder,
      fetchUrl: fetchUrl
    }));
  }
  
  if (fetchUrl) {
    return serveRemoteFile(c, fetchUrl, data, reason, ruleVariables);
  }
  if (targetFolder.startsWith('http://') || targetFolder.startsWith('https://')) {
    return handleInitialProxyRequest(c, targetFolder, data, reason, ruleVariables);
  }
  return servePublicFile(c, `${targetFolder}/`, data, reason, ruleVariables);
}

// Function to get rule from KV storage
export async function getKVRule(c: any, domain: string, path: string): Promise<KVRule | null> {
  try {
    // First try exact domain+path match (for path-specific rules)
    const keyWithPath = `${domain}${path}`;
    let ruleJson = await env.KV.get(keyWithPath);
    
    // Then try domain only
    if (!ruleJson) {
      const keyDomainOnly = domain;
      ruleJson = await env.KV.get(keyDomainOnly);
    }
    
    if (ruleJson) {
      return JSON.parse(ruleJson) as KVRule;
    }
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
  const errorPageResponse = await servePublicFile(c, '', notFoundData, "Serving custom 404 page");

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
      const kvRule = await getKVRule(c, data.domain, data.path);
      
      if (kvRule) {
        // Only log for main page requests
        if (data.path === '/' || data.path === '/index.html') {
          console.log(JSON.stringify({
            action: "RULE_FOUND",
            domain: data.domain,
            path: data.path,
            ruleKey: data.domain
          }));
        }
        return await applyKVRule(c, data, kvRule);
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

  // Step 1: Temporarily protect escaped macros written as {{!key}}
  for (const key of Object.keys(variables)) {
    const escPlaceholder = `__ESC_${key.replace(/[^a-zA-Z0-9_]/g, '_')}__`;
    content = content.replaceAll(`{{!${key}}}`, escPlaceholder);
  }

  // Step 2: Replace normal macros
  for (const [key, value] of Object.entries(variables)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }

  // Step 3: Restore escaped macros back to their original form (without the !)
  for (const key of Object.keys(variables)) {
    const escPlaceholder = `__ESC_${key.replace(/[^a-zA-Z0-9_]/g, '_')}__`;
    content = content.replaceAll(escPlaceholder, `{{${key}}}`);
  }

  return content;
} 