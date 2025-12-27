import { Hono, Context } from "hono";
import { html } from "hono/html";
import { UAParser } from "ua-parser-js";
import { isbot } from "isbot";
import { env } from "cloudflare:workers";
import { rules, type RequestData, type ExtendedRequestData, fetchAndStreamAsset, getKVRule, getClickData, storeConversion, generateUniqueId, generateSessionId, enrichEvent } from "./rules";


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

// Enrichment endpoint for client-side device data
app.post('/t/enrich', async (c: Context) => {
  try {
    const body = await c.req.json();
    const { impressionId, screen, dpr, gpu, tz, model } = body;
    
    if (!impressionId) {
      return new Response('Missing impressionId', { status: 400 });
    }
    
    // Update the event with client-side data (async)
    c.executionCtx.waitUntil(
      enrichEvent(impressionId, { screen, dpr, gpu, tz, model })
    );
    
    return new Response(null, { status: 204 });
  } catch (e: any) {
    console.error(`Error in /t/enrich: ${e.message}`);
    return new Response(null, { status: 204 }); // Silent fail for beacons
  }
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
  
  // Cloudflare Bot Detection - use ALL available signals
  // Enterprise: Full 1-99 ML scoring via botManagement.score
  // Pro: verifiedBot, staticResource, and clientTrustScore (threat score 0-100)
  const botScore = cf?.botManagement?.score ?? null;           // Enterprise only (1-99)
  const isVerifiedBot = cf?.botManagement?.verifiedBot ?? false; // Googlebot, Bingbot, etc.
  const clientTrustScore = cf?.clientTrustScore ?? null;       // Threat score (0-100, higher = more threat)

  // Parse user agent info - read high-entropy Client Hints
  const clientHintsUA = headers['sec-ch-ua'] || undefined;
  const clientHintsMobile = headers['sec-ch-ua-mobile'] || undefined;
  const clientHintsPlatform = headers['sec-ch-ua-platform'] || undefined;
  const clientHintsPlatformVersion = headers['sec-ch-ua-platform-version'] || undefined;
  const clientHintsFullVersionList = headers['sec-ch-ua-full-version-list'] || undefined;
  const clientHintsModel = headers['sec-ch-ua-model'] || undefined;
  const clientHintsArch = headers['sec-ch-ua-arch'] || undefined;

  // 1. Initial parse using ua-parser-js
  const parser = new UAParser(ua);
  const uaResult = parser.getResult();

  // 2. Enhance with Client Hints for more accuracy (Chrome/Edge)
  let browserName = uaResult.browser.name || null;
  let browserVersion = uaResult.browser.version || null;
  let osName = uaResult.os.name || null;
  let osVersion = uaResult.os.version || null;
  let deviceType = uaResult.device.type || 'desktop';
  let deviceBrand = uaResult.device.vendor || null;
  let deviceModel = uaResult.device.model || null;

  // Client Hints overrides for Browser
  if (clientHintsUA) {
    // Basic browser detection from sec-ch-ua
    if (clientHintsUA.includes('Chrome')) browserName = 'Chrome';
    else if (clientHintsUA.includes('Edge')) browserName = 'Edge';
    else if (clientHintsUA.includes('Brave')) browserName = 'Brave';
  }

  // Client Hints overrides for OS
  if (clientHintsPlatform) {
    osName = clientHintsPlatform.replace(/"/g, '');
  }
  if (clientHintsPlatformVersion) {
    osVersion = clientHintsPlatformVersion.replace(/"/g, '');
  }

  // Client Hints overrides for Device
  if (clientHintsMobile === '?1') {
    deviceType = 'mobile';
  }
  if (clientHintsModel) {
    deviceModel = clientHintsModel.replace(/"/g, '');
    deviceBrand = 'Apple'; // Usually models like "iPhone" or "iPad"
  }

  // Check if it's a bot - combine ALL signals:
  // 1. isbot library (UA-based detection)
  // 2. Cloudflare Bot Score < 30 (Enterprise only)
  // 3. Cloudflare Verified Bot (Googlebot, Bingbot, etc.) - these are GOOD bots
  // 4. High threat score (> 50 = suspicious)
  const isBotByUA = isbot(ua);
  const isBotByScore = botScore !== null && botScore < 30;
  const isBotByThreat = clientTrustScore !== null && clientTrustScore > 50;
  const isBot = isBotByUA || isBotByScore || isBotByThreat || isVerifiedBot;

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
    botScore,
    isVerifiedBot,
    clientTrustScore,
    userAgent: {
      browser: browserName,
      browserVersion: browserVersion,
      os: osName,
      osVersion: osVersion,
      device: deviceType,
      brand: deviceBrand,
      model: deviceModel,
      arch: clientHintsArch ? clientHintsArch.replace(/"/g, '') : (uaResult.cpu.architecture || null),
      raw: ua
    },
    isBot: isBot,
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
    ...tempRequestData,
    sessionId: sessionId,
    impressionId: impressionId
  };


  // Check rules (now using KV-based system)
  for (const rule of rules) {
    if (rule.condition(requestDataObject)) {
      const response = await rule.action(c, requestDataObject);
      // Add Accept-CH header to request Client Hints on next request
      const acceptCHHeader = 'sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, sec-ch-ua-platform-version, sec-ch-ua-full-version-list, sec-ch-ua-model, sec-ch-ua-arch';
      response.headers.set('Accept-CH', acceptCHHeader);
      return response;
    }
  }
  
  // Fallback: return 404 with Accept-CH header
  const fallbackResponse = new Response('Not Found', { status: 404 });
  fallbackResponse.headers.set('Accept-CH', 'sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, sec-ch-ua-platform-version, sec-ch-ua-full-version-list, sec-ch-ua-model, sec-ch-ua-arch');
  return fallbackResponse;
});

export default app;
