import { Hono, Context } from "hono";
import { parseOS, parseAcceptLanguage, parseBrowser, parseEngine, parseDeviceType, parseDeviceBrand } from "./userAgent";
import { env } from "cloudflare:workers";
import { rules, type RequestData, fetchAndStreamAsset, getKVRule } from "./rules";


const app = new Hono();

app.get("/*", async (c: Context) => {
  const domain = c.req.header("host") ?? null;
  const path = new URL(c.req.raw.url).pathname;

  // Fallback to the original rule-processing logic for local assets or initial HTML proxying.
  // The `rules` array in rules.ts will handle the rest.
  
  const query = Object.fromEntries(new URL(c.req.raw.url).searchParams);
  const headers = Object.fromEntries(c.req.raw.headers.entries());
  const ip = c.req.header("cf-connecting-ip") ?? null;
  const referrer = headers['referer'] || headers['referrer'] || null;
  const cf = c.req.raw.cf as any;
  const ua = c.req.header("User-Agent") || "";
  
  // Parse user agent info
  const clientHintsUA = headers['sec-ch-ua'] || undefined;
  const clientHintsMobile = headers['sec-ch-ua-mobile'] || undefined;
  const clientHintsPlatform = headers['sec-ch-ua-platform'] || undefined;

  const browserInfo = parseBrowser(ua, clientHintsUA);
  const osInfo = parseOS(ua);
  const engineInfo = parseEngine(ua);
  const deviceTypeInfo = parseDeviceType(ua, clientHintsMobile);
  const brandInfo = parseDeviceBrand(ua);
  
  // Use platform from client hints if available, otherwise parse from UA
  const platformFromHints = clientHintsPlatform ? clientHintsPlatform.replace(/"/g, '') : null;
  const osString = platformFromHints || osInfo;

  // Extract OS version from OS string
  const extractOSVersion = (osString: string): { name: string; version: string | null } => {
    // Always try to extract version from the original User-Agent string first
    const uaOSInfo = parseOS(ua);
    
    // If we got OS from Client Hints, use that as the name but try to get version from UA
    if (platformFromHints) {
      // Try to extract version from the full UA OS string
      const versionPatterns = [
        // Windows patterns
        /Windows NT (\d+\.\d+)/i,
        // macOS patterns  
        /Mac OS X (\d+[._]\d+(?:[._]\d+)?)/i,
        
        // iOS patterns
        /(?:iPhone|iPad|iPod).*?OS (\d+[._]\d+(?:[._]\d+)?)/i,
        // Android patterns
        /Android (\d+(?:\.\d+)?(?:\.\d+)?)/i,
        // Chrome OS patterns
        /CrOS [^ ]+ ([\d.]+)/i
      ];

      for (const pattern of versionPatterns) {
        const match = ua.match(pattern);
        if (match) {
          let version = match[1].replace(/_/g, '.');
          
          // Convert Windows NT versions to friendly names
          if (platformFromHints === 'Windows' && version) {
            if (version === '10.0') version = '10/11'; // Could be either
            else if (version === '6.3') version = '8.1';
            else if (version === '6.2') version = '8';
            else if (version === '6.1') version = '7';
          }
          
          return { name: platformFromHints, version };
        }
      }
      
      // If no version found in UA, return just the platform name
      return { name: platformFromHints, version: null };
    }

    // If no Client Hints, parse the full UA OS string for both name and version
    const patterns = [
      // macOS patterns
      /^(macOS)\s+(?:\w+\s+)?(\d+\.\d+(?:\.\d+)?)/,
      // Windows patterns  
      /^(Windows)\s+(\d+(?:\.\d+)?)/,
      // iOS/iPadOS patterns
      /^(iOS|iPadOS)\s+(\d+\.\d+(?:\.\d+)?)/,
      // Android patterns
      /^(Android)\s+\d+\s+\((\d+(?:\.\d+)?(?:\.\d+)?)\)/,
      /^(Android)\s+(\d+(?:\.\d+)?(?:\.\d+)?)/,
      // Chrome OS patterns
      /^(Chrome OS)\s+(\d+(?:\.\d+)?)/,
      // Ubuntu patterns
      /^(Ubuntu)\s+(\d+\.\d+)/,
      // Generic patterns for version numbers
      /^([^\d]+?)\s+(\d+(?:\.\d+)?(?:\.\d+)?)/
    ];

    for (const pattern of patterns) {
      const match = osString.match(pattern);
      if (match) {
        return { name: match[1], version: match[2] };
      }
    }

    // If no version found, return the full string as name
    return { name: osString, version: null };
  };

  const { name: osName, version: osVersion } = extractOSVersion(osString);

  // Prepare request data for rule matching
  const org = cf?.asOrganization ?? null;
  
  const requestDataObject: RequestData = {
    domain,
    path,
    query,
    headers,
    ip,
    org: cf?.asOrganization ?? null,
    referrer,
    userAgent: {
      browser: browserInfo.name,
      browserVersion: browserInfo.version,
      os: osName,
      osVersion: osVersion,
      device: deviceTypeInfo,
      brand: brandInfo,
      raw: ua
    },
    geo: {
      country: cf?.country ?? null,
      city: cf?.city ?? null,
      continent: cf?.continent ?? null,
      latitude: cf?.latitude ?? null,
      longitude: cf?.longitude ?? null,
      region: cf?.region ?? null,
      regionCode: cf?.regionCode ?? null,
      timezone: cf?.timezone ?? null,
      postalCode: cf?.postalCode ?? null
    },
    cf: {
      asn: cf?.asn ?? null,
      asOrganization: cf?.asOrganization ?? null,
      colo: cf?.colo ?? null,
      clientTrustScore: cf?.clientTrustScore ?? null,
      httpProtocol: cf?.httpProtocol ?? null,
      tlsVersion: cf?.tlsVersion ?? null,
      tlsCipher: cf?.tlsCipher ?? null
    }
  };

  // Check rules (now using KV-based system)
  for (const rule of rules) {
    if (rule.condition(requestDataObject)) {
      return await rule.action(c, requestDataObject);
    }
  }
});

export default app;
