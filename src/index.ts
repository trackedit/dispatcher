import { Hono, Context } from "hono";
import { html } from "hono/html";
import { parseOS, parseAcceptLanguage, parseBrowser, parseEngine, parseDeviceType, parseDeviceBrand } from "./userAgent";
import { env } from "cloudflare:workers";
import { rules, type RequestData, type ExtendedRequestData, fetchAndStreamAsset, getKVRule, getClickData, storeConversion, generateUniqueId, generateSessionId } from "./rules";


const app = new Hono();

app.get('/proxy-session', async (c: Context) => {
  const targetUrlString = c.req.query('url');
  if (!targetUrlString) {
    return new Response("Missing 'url' query parameter.", { status: 400 });
  }

  try {
    const targetUrl = new URL(targetUrlString);
    
    // We can't just pass through all headers, especially host.
    const requestHeaders = new Headers(c.req.headers);
    requestHeaders.set('Host', targetUrl.host);
    requestHeaders.delete('Cookie'); // For privacy and to avoid state conflicts

    const proxyRequest = new Request(targetUrl.toString(), {
      method: c.req.method,
      headers: requestHeaders,
      body: c.req.body,
      redirect: 'follow'
    });

    const originResponse = await fetch(proxyRequest);

    // Use HTMLRewriter to fix asset paths
    const rewriter = new HTMLRewriter()
      .on('a, link, iframe, form, embed', {
        element(element: Element) {
          const attributeMap: Record<string, string> = { 'a': 'href', 'link': 'href', 'iframe': 'src', 'form': 'action', 'embed': 'src' };
          const attribute = attributeMap[element.tagName];
          if (attribute) {
            const value = element.getAttribute(attribute);
            if (value) {
              const absoluteUrl = new URL(value, targetUrl.origin).href;
              // Rewrite to go through our proxy again
              element.setAttribute(attribute, `/proxy-session?url=${encodeURIComponent(absoluteUrl)}`);
            }
          }
        },
      })
      .on('img, script, video, audio, source', {
        element(element: Element) {
          const src = element.getAttribute('src');
          if (src) {
            const absoluteUrl = new URL(src, targetUrl.origin).href;
            element.setAttribute('src', `/proxy-session?url=${encodeURIComponent(absoluteUrl)}`);
          }
        },
      });

    const rewrittenResponse = rewriter.transform(originResponse);
    
    // Clone headers and remove any that could cause issues
    const responseHeaders = new Headers(originResponse.headers);
    responseHeaders.delete('Content-Security-Policy');
    responseHeaders.delete('X-Frame-Options');

    return new Response(rewrittenResponse.body, {
      status: originResponse.status,
      statusText: originResponse.statusText,
      headers: responseHeaders
    });

  } catch (e: any) {
    return new Response(`Error during proxy: ${e.message}`, { status: 500 });
  }
});

// Postback endpoint for conversion tracking
app.get('/postback', async (c: Context) => {
  const clickId = c.req.query('click_id');
  const payout = parseFloat(c.req.query('payout') || '0');
  const conversionType = c.req.query('conversion_type') || 'lead';
  
  if (!clickId) {
    return new Response('Missing click_id parameter', { status: 400 });
  }
  
  // Look up click data from ClickHouse
  const clickData = await getClickData(clickId);
  
  if (!clickData) {
    return new Response('Click not found', { status: 404 });
  }
  
  // Generate conversion ID
  const conversionId = generateUniqueId('conv');
  
  // Collect all postback parameters
  const postbackData: Record<string, string> = {};
  for (const [key, value] of c.req.query()) {
    postbackData[key] = value;
  }
  
  // Store conversion in ClickHouse (async, non-blocking)
  c.executionCtx.waitUntil(
    storeConversion({
      conversionId: conversionId,
      clickId: clickId,
      impressionId: clickData.impression_id || '',
      sessionId: clickData.session_id || '',
      campaignId: clickData.campaign_id || '',
      payout: payout,
      conversionType: conversionType,
      postbackData: postbackData,
    })
  );
  
  console.log(JSON.stringify({
    action: "CONVERSION_RECEIVED",
    conversionId: conversionId,
    clickId: clickId,
    impressionId: clickData.impression_id,
    sessionId: clickData.session_id,
    campaignId: clickData.campaign_id,
    conversionType: conversionType,
    payout: payout,
  }));
  
  return new Response('OK', { status: 200 });
});

app.get("/*", async (c: Context) => {
  const url = new URL(c.req.raw.url);
  let path = url.pathname;
  let domain = c.req.header("host");
  let query = Object.fromEntries(url.searchParams);
  
  // Check for prefetch/prerender requests and skip them entirely
  // These are speculative requests from Chrome that shouldn't be tracked
  const secPurpose = c.req.header("sec-purpose") || c.req.header("purpose") || "";
  if (secPurpose.includes("prefetch") || secPurpose.includes("prerender")) {
    // Return a 204 No Content for prefetch requests - browser will make real request when user navigates
    console.log(`[SKIP] Prefetch/prerender request skipped (purpose: ${secPurpose})`);
    return new Response(null, { status: 204 });
  }

  const isEmbedRequest = path === '/track.js';

  if (isEmbedRequest) {
    const clientUrlString = query.url;
    if (clientUrlString) {
      try {
        const clientUrl = new URL(clientUrlString);
        domain = clientUrl.hostname;
        path = clientUrl.pathname;
        query = Object.fromEntries(clientUrl.searchParams);
      } catch (e) {
        console.error("Invalid client URL for embed request:", clientUrlString);
        return new Response("/* Invalid Client URL */", { status: 400, headers: { 'Content-Type': 'application/javascript' } });
      }
    } else {
      console.error("Missing URL parameter for embed request");
      return new Response("/* URL Parameter Required */", { status: 400, headers: { 'Content-Type': 'application/javascript' } });
    }
  }
  
  domain = domain ?? null;


  // Fallback to ahl-processing logic for local assets or initial HTML proxying.
  // The `rules` array in rules.ts will handle the rest.
  
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
  
  // Generate tracking IDs
  const tempRequestData: RequestData = {
    domain,
    path,
    query,
    headers,
    ip,
    org: cf?.asOrganization ?? null,
    referrer,
    isEmbedRequest,
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
  
  const sessionId = generateSessionId(tempRequestData);
  const impressionId = generateUniqueId('imp');  // Always generate, let rule matching decide
  
  const requestDataObject: ExtendedRequestData = {
    domain,
    path,
    query,
    headers,
    ip,
    org: cf?.asOrganization ?? null,
    referrer,
    isEmbedRequest,
    sessionId: sessionId,
    impressionId: impressionId,
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
