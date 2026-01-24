# Rule Examples Documentation

This document provides comprehensive examples of all rule types, combinations, split tests, macros, and edge cases that can be stored in KV storage.

## Table of Contents

1. [Basic Rule Structure](#basic-rule-structure)
2. [Condition Types](#condition-types)
3. [Simple Rules](#simple-rules)
4. [Complex Rules with Groups](#complex-rules-with-groups)
5. [Split Tests & Weighted Rules](#split-tests--weighted-rules)
6. [Action Types](#action-types)
7. [Macros & Variables](#macros--variables)
8. [Block Rules](#block-rules)
9. [Destinations Array](#destinations-array)
10. [Combinations & Edge Cases](#combinations--edge-cases)

---

## Basic Rule Structure

A `KVRule` stored in KV has the following structure:

```json
{
  "rules": [/* array of Rule objects */],
  "defaultFolder": "fallback-folder-or-url",
  "variables": {/* optional default macros */},
  "blocks": {/* optional blocking rules */}
}
```

Each `Rule` object can have:
- **Conditions**: `flags` (legacy) or `groups` (new, OR'd groups)
- **Actions**: `folder`, `proxyUrl`, `redirectUrl`, or `modifications`
- **Options**: `weight`, `variables`, `operator`

---

## Condition Types

### Geographic Conditions

```json
{
  "flags": {
    "country": "US",                    // Single country (ISO 3166-1 alpha-2)
    "country": ["US", "CA", "MX"],      // Multiple countries (OR logic)
    "region": "CA",                     // State/province code
    "region": ["CA", "NY", "TX"],      // Multiple regions
    "city": "New York",                 // City name
    "city": ["New York", "Los Angeles"], // Multiple cities
    "continent": "NA",                   // Continent code
    "continent": ["NA", "EU"]           // Multiple continents
  }
}
```

### Device & Browser Conditions

```json
{
  "flags": {
    "device": "Mobile",                 // Mobile, Desktop, Tablet, TV, Wearable, etc.
    "device": ["Mobile", "Tablet"],     // Multiple device types
    "browser": "Chrome",                 // Browser name
    "browser": ["Chrome", "Firefox"],   // Multiple browsers
    "os": "Windows",                    // OS name (substring match)
    "os": ["Windows", "macOS"],         // Multiple OSes
    "brand": "Apple",                   // Device brand
    "brand": ["Apple", "Samsung"]       // Multiple brands
  }
}
```

### Network & IP Conditions

```json
{
  "flags": {
    "ip": "192.168.1.1",                // Single IP
    "ip": ["192.168.1.1", "10.0.0.1"],  // Multiple IPs
    "ip": "192.168.1.0/24",             // CIDR notation
    "ip": "192.168.1.1-192.168.1.255", // IP range
    "ip": "192.168.1.*",                // Wildcard pattern
    "asn": 15169,                       // ASN number (Google)
    "asn": [15169, 32934],              // Multiple ASNs
    "colo": "SFO",                      // Cloudflare datacenter code
    "org": "Google*",                   // Organization wildcard
    "org": ["Google*", "Amazon*"]       // Multiple org patterns
  }
}
```

### Time & Language Conditions

```json
{
  "flags": {
    "time": {
      "start": 9.0,                     // UTC hour (9:00 AM)
      "end": 17.5                       // UTC hour (5:30 PM)
    },
    "language": "en",                   // Browser language code
    "language": ["en", "es", "fr"]     // Multiple languages
  }
}
```

### URL Parameter Conditions

```json
{
  "flags": {
    "params": {
      "utm_source": "google",
      "utm_campaign": "summer_sale"
    }
  }
}
```

**Note**: URL parameters only match on main page requests, not asset requests.

---

## Simple Rules

### Example 1: Country-Based Redirect

```json
{
  "rules": [
    {
      "flags": { "country": "CA" },
      "redirectUrl": "https://example.com/ca"
    }
  ],
  "defaultFolder": "https://example.com"
}
```

### Example 2: Mobile Device Detection

```json
{
  "rules": [
    {
      "flags": { "device": "Mobile" },
      "proxyUrl": "https://m.example.com"
    }
  ],
  "defaultFolder": "https://example.com"
}
```

### Example 3: Time-Based Rule

```json
{
  "rules": [
    {
      "flags": {
        "time": { "start": 0, "end": 8 }
      },
      "modifications": [
        {
          "selector": "#banner",
          "action": "setText",
          "value": "Good Morning! Early Bird Special Active"
        }
      ]
    }
  ],
  "defaultFolder": "https://example.com"
}
```

### Example 4: Multiple Conditions (AND)

```json
{
  "rules": [
    {
      "flags": {
        "country": "US",
        "device": "Mobile",
        "browser": "Chrome"
      },
      "proxyUrl": "https://mobile-us.example.com"
    }
  ],
  "defaultFolder": "https://example.com"
}
```

### Example 5: URL Parameter Targeting

```json
{
  "rules": [
    {
      "flags": {
        "params": {
          "ref": "partner123"
        }
      },
      "modifications": [
        {
          "selector": "#promo-code",
          "action": "setText",
          "value": "PARTNER123"
        }
      ]
    }
  ],
  "defaultFolder": "https://example.com"
}
```

---

## Complex Rules with Groups

Groups allow **OR logic** between condition sets. Within each group, conditions are **AND'd** together.

### Example 1: Multiple Geographic Options

```json
{
  "rules": [
    {
      "groups": [
        {
          "country": "US",
          "region": "CA"
        },
        {
          "country": "CA",
          "region": "ON"
        }
      ],
      "proxyUrl": "https://west-coast.example.com"
    }
  ],
  "defaultFolder": "https://example.com"
}
```

**Logic**: Match if (US AND CA) OR (CA AND ON)

### Example 2: Device OR Browser Targeting

```json
{
  "rules": [
    {
      "groups": [
        { "device": "Mobile" },
        { "browser": "Safari" }
      ],
      "modifications": [
        {
          "selector": "#cta-button",
          "action": "setCss",
          "value": { "background-color": "blue" }
        }
      ]
    }
  ],
  "defaultFolder": "https://example.com"
}
```

**Logic**: Match if Mobile OR Safari

### Example 3: Complex Multi-Group Rule

```json
{
  "rules": [
    {
      "groups": [
        {
          "country": "US",
          "device": "Desktop",
          "browser": "Chrome"
        },
        {
          "country": "GB",
          "device": "Desktop",
          "os": "Windows"
        },
        {
          "country": "AU",
          "device": "Mobile"
        }
      ],
      "proxyUrl": "https://premium.example.com"
    }
  ],
  "defaultFolder": "https://example.com"
}
```

**Logic**: Match if (US AND Desktop AND Chrome) OR (GB AND Desktop AND Windows) OR (AU AND Mobile)

---

## Split Tests & Weighted Rules

Use `weight` to split traffic between multiple matching rules. Weights are **relative** - they don't need to sum to 100. The system calculates proportions automatically.

**Note**: For split tests within a single rule, consider using the `destinations` array (see [Destinations Array](#destinations-array)) for better performance.

### Example 1: Simple 50/50 Split

```json
{
  "rules": [
    {
      "weight": 50,
      "modifications": [
        {
          "selector": "#headline",
          "action": "setText",
          "value": "Version A: Try Our New Product!"
        }
      ]
    },
    {
      "weight": 50,
      "modifications": [
        {
          "selector": "#headline",
          "action": "setText",
          "value": "Version B: Discover Something Amazing!"
        }
      ]
    }
  ],
  "defaultFolder": "https://example.com"
}
```

### Example 2: Uneven Split (70/30)

```json
{
  "rules": [
    {
      "weight": 70,
      "proxyUrl": "https://variant-a.example.com"
    },
    {
      "weight": 30,
      "proxyUrl": "https://variant-b.example.com"
    }
  ],
  "defaultFolder": "https://example.com"
}
```

### Example 3: Multi-Variant Split Test

```json
{
  "rules": [
    {
      "weight": 40,
      "modifications": [
        {
          "selector": "#price",
          "action": "setText",
          "value": "$99"
        }
      ]
    },
    {
      "weight": 35,
      "modifications": [
        {
          "selector": "#price",
          "action": "setText",
          "value": "$89"
        }
      ]
    },
    {
      "weight": 25,
      "modifications": [
        {
          "selector": "#price",
          "action": "setText",
          "value": "$79"
        }
      ]
    }
  ],
  "defaultFolder": "https://example.com"
}
```

### Example 4: Conditional Split Test

```json
{
  "rules": [
    {
      "flags": { "country": "US" },
      "weight": 60,
      "proxyUrl": "https://us-variant-a.example.com"
    },
    {
      "flags": { "country": "US" },
      "weight": 40,
      "proxyUrl": "https://us-variant-b.example.com"
    },
    {
      "flags": { "country": "CA" },
      "proxyUrl": "https://ca-specific.example.com"
    }
  ],
  "defaultFolder": "https://example.com"
}
```

**Logic**: US traffic splits 60/40, CA traffic goes to specific variant, others get default.

---

## Action Types

### 1. Serve Hosted Folder (`folder`)

**DNS Proxy Only** - Serves files uploaded to the platform.

```json
{
  "rules": [
    {
      "flags": { "country": "US" },
      "folder": "us-landing/"
    }
  ],
  "defaultFolder": "main-landing/"
}
```

**Note**: If `folder` contains a URL (starts with `http://` or `https://`), it's treated as `proxyUrl`.

### 2. Proxy Page (`proxyUrl`)

Seamlessly serves content from another URL without changing the address bar.

```json
{
  "rules": [
    {
      "flags": { "device": "Mobile" },
      "proxyUrl": "https://m.example.com"
    }
  ],
  "defaultFolder": "https://example.com"
}
```

### 3. Redirect (`redirectUrl`)

Standard HTTP redirect - changes the address bar.

```json
{
  "rules": [
    {
      "flags": { "country": "FR" },
      "redirectUrl": "https://example.fr"
    }
  ],
  "defaultFolder": "https://example.com"
}
```

### 4. Modify Page (`modifications`)

Makes targeted changes to elements on the current page.

```json
{
  "rules": [
    {
      "flags": { "country": "US" },
      "modifications": [
        {
          "selector": "#headline",
          "action": "setText",
          "value": "Welcome to the US!"
        },
        {
          "selector": ".cta-button",
          "action": "setHtml",
          "value": "<button>Get Started Now</button>"
        },
        {
          "selector": "#banner",
          "action": "setCss",
          "value": {
            "background-color": "red",
            "color": "white",
            "padding": "20px"
          }
        },
        {
          "selector": "#logo",
          "action": "setAttribute",
          "value": {
            "name": "src",
            "value": "/images/us-logo.png"
          }
        },
        {
          "selector": "#old-banner",
          "action": "remove"
        }
      ]
    }
  ],
  "defaultFolder": "https://example.com"
}
```

**Available Actions**:
- `setText`: Replace element text content
- `setHtml`: Replace element HTML content
- `setCss`: Apply CSS styles (object with style properties)
- `setAttribute`: Set an attribute (value is `{name: "attr", value: "val"}`)
- `remove`: Remove the element from DOM

### 5. Click-Out Handling (`clickUrl` / `clickDestinations`)

Intercepts requests to paths ending with `/click` or `/click/` and redirects to configured URLs. Query parameters from the original request are preserved in the redirect.

**Single Click URL**:

```json
{
  "rules": [
    {
      "flags": { "country": "US" },
      "clickUrl": "https://partner.com/offer?source=us"
    }
  ],
  "defaultFolder": "https://example.com"
}
```

**Result**: Any link to `/click` or `/path/to/click` from US visitors redirects to `https://partner.com/offer?source=us` with original query params appended.

**Weighted Click Destinations** (Split Tests via D1 IDs):

```json
{
  "rules": [
    {
      "flags": { "country": "US" },
      "clickDestinations": [
        {
          "id": "partner-a",          // D1 destination ID (URL is stored in D1)
          "weight": 60
        },
        {
          "id": "partner-b",
          "weight": 40
        }
      ]
    }
  ],
  "defaultFolder": "https://example.com"
}
```

**Result**: US visitors clicking `/click` links get 60% to partner-a, 40% to partner-b. The dispatcher looks up each ID in D1 `destinations` (only `active` rows) to get the outbound URL, then preserves the original query string.

**Combined with Regular Actions**:

```json
{
  "rules": [
    {
      "flags": { "country": "US" },
      "proxyUrl": "https://us-landing.example.com",
      "clickDestinations": [
        {
          "id": "offer-a",
          "value": "https://offer-a.com",
          "weight": 50
        },
        {
          "id": "offer-b",
          "value": "https://offer-b.com",
          "weight": 50
        }
      ]
    }
  ],
  "defaultFolder": "https://example.com"
}
```

**Result**: US visitors see the proxied landing page, but `/click` links redirect to weighted destinations.

**Notes**:
- Click-out handling works on **any path ending with `/click` or `/click/`** (e.g., `/click`, `/path/to/click`, `/products/item/click`)
- Query parameters from the original request are **always preserved** in the redirect
- Click-out rules use the same condition matching as regular rules (flags, groups, weights)
- If multiple rules match, weights determine which click-out destination is used
- Click-out handling happens **before** regular rule actions, so you can have different click destinations per rule

---

## Macros & Variables

Macros are replaced in HTML/CSS content using `{{key}}` syntax. Use `{{!key}}` to escape (prevent replacement).

### Built-in Macros

```html
<!-- Geographic -->
{{user.COUNTRY}}          <!-- ISO country code (e.g., "US") -->
{{user.COUNTRY_CODE}}     <!-- Same as COUNTRY -->
{{user.GEO}}              <!-- Same as COUNTRY -->
{{user.REGION_NAME}}      <!-- State/province name -->
{{user.REGION_CODE}}      <!-- State/province code -->
{{user.CITY}}             <!-- City name -->
{{user.POSTAL_CODE}}      <!-- ZIP/postal code -->
{{user.LATITUDE}}         <!-- Latitude -->
{{user.LONGITUDE}}        <!-- Longitude -->
{{user.TIMEZONE}}         <!-- Timezone (e.g., "America/New_York") -->

<!-- Device & Browser -->
{{user.DEVICE}}           <!-- Mobile, Desktop, Tablet, etc. -->
{{user.BROWSER}}          <!-- Chrome, Firefox, Safari, etc. -->
{{user.BROWSER_VERSION}}  <!-- Browser version number -->
{{user.OS}}               <!-- Windows, macOS, iOS, etc. -->
{{user.OS_VERSION}}       <!-- OS version -->
{{user.BRAND}}            <!-- Apple, Samsung, etc. -->
{{user.MODEL}}            <!-- Device model (iPhone, Pixel 7, etc.) -->
{{user.ARCH}}             <!-- CPU architecture (arm64, x86_64) -->

<!-- Bot Detection -->
{{user.BOT_SCORE}}        <!-- Cloudflare Bot Score (1-99, Enterprise only) -->
{{user.THREAT_SCORE}}     <!-- Cloudflare Threat Score (0-100) -->
{{user.IS_VERIFIED_BOT}}  <!-- true if verified bot (Googlebot, etc.) -->

<!-- Network -->
{{user.IP}}               <!-- Visitor IP address -->
{{user.ORGANIZATION}}     <!-- AS organization name -->
{{user.COLO}}             <!-- Cloudflare datacenter code (e.g., "EWR") -->
{{user.colo.city}}        <!-- Edge server city (e.g., "Newark") -->
{{user.colo.country}}     <!-- Edge server country (e.g., "United States") -->
{{user.colo.region}}      <!-- Edge server region (e.g., "North America") -->
{{user.colo.name}}        <!-- Full edge location (e.g., "Newark, NJ, United States") -->
{{user.REFERRER}}         <!-- Referrer URL -->

<!-- Platform Attribution -->
{{platform.id}}           <!-- Platform ID from database -->
{{platform.name}}         <!-- Ad platform name (Facebook, etc.) -->
{{platform.click_id}}     <!-- Native click ID (fbclid, gclid, etc.) -->

<!-- URL Parameters -->
{{query.param_name}}      <!-- Any URL query parameter -->
{{query.utm_source}}     <!-- Example: UTM source -->
{{query.utm_campaign}}   <!-- Example: UTM campaign -->
```

### Custom Variables

Define custom variables in rules or at the KVRule level:

```json
{
  "rules": [
    {
      "flags": { "country": "US" },
      "variables": {
        "promo_code": "USA2024",
        "discount": "20%",
        "phone_number": "+1-800-123-4567"
      },
      "folder": "us-landing/"
    }
  ],
  "defaultFolder": "main-landing/",
  "variables": {
    "company_name": "Example Corp",
    "support_email": "support@example.com"
  }
}
```

### Example HTML with Macros

```html
<!DOCTYPE html>
<html>
<head>
  <title>Welcome {{user.CITY}} Visitors!</title>
</head>
<body>
  <h1>Hello from {{user.COUNTRY}}!</h1>
  <p>Your IP: {{user.IP}}</p>
  <p>Device: {{user.DEVICE}} | Browser: {{user.BROWSER}}</p>
  <p>Use code: {{promo_code}} for {{discount}} off!</p>
  <p>Contact: {{support_email}}</p>
  
  <!-- Escaped macro (won't be replaced) -->
  <p>Template variable: {{!promo_code}}</p>
</body>
</html>
```

### Macro Escaping

To prevent replacement, use `{{!key}}`:

```html
<!-- This will show "{{promo_code}}" in the output -->
<p>Use code: {{!promo_code}}</p>

<!-- This will be replaced with actual value -->
<p>Use code: {{promo_code}}</p>
```

---

## Block Rules

Block rules always serve the `defaultFolder` when matched. They're checked **before** regular rules.

```json
{
  "rules": [
    {
      "flags": { "country": "US" },
      "proxyUrl": "https://us.example.com"
    }
  ],
  "defaultFolder": "https://example.com",
  "blocks": {
    "ips": ["192.168.1.1", "10.0.0.0/8"],
    "orgs": ["*Bot*", "*Crawler*"],
    "hostnames": ["*.test.com"],
    "cities": ["*Test*"],
    "countries": ["XX"],
    "devices": ["Bot"],
    "browsers": ["*Bot*"],
    "oses": ["Unknown"]
  }
}
```

**Block Types**:
- `ips`: IP addresses, ranges, CIDR, or wildcards
- `orgs`: Organization name wildcards
- `hostnames`: Hostname wildcards
- `cities`: City name wildcards
- `countries`: Country codes (exact match)
- `devices`: Device type names
- `browsers`: Browser name wildcards
- `oses`: OS name wildcards

---

## Bot Detection & Cloaking

Bots are automatically detected using a combination of the `isbot` library and Cloudflare's Bot Management signals (Bot Score, Verified Bot status, and Threat Score).

### How Cloaking Works

When a bot is detected on a main page request:
1. **Rule matching is skipped**: Regular targeting rules are ignored.
2. **Default folder is served**: The visitor is automatically routed to the `defaultFolder` (safe page).
3. **Zero configuration**: This happens automatically for all campaigns with a `defaultFolder`.

This ensures that bots (including search engine crawlers and ad platform reviewers) only see your "safe" content, while real humans see your offer or landing page.

---

## Destinations Array

**Fully Implemented** - The destinations array allows you to define multiple weighted destinations within a single rule. This is more efficient than creating multiple separate rules with the same conditions.

### How It Works

When a rule with `destinations` matches, the worker:
1. Checks the rule's conditions **once** (faster than multiple rules)
2. Selects one destination based on weighted random selection
3. Uses that destination's `value` as the action (folder or proxyUrl)

### Example 1: Simple 60/40 Split

```json
{
  "rules": [
    {
      "flags": { "country": "US" },
      "destinations": [
        {
          "id": "dest-1",
          "value": "https://variant-a.example.com",
          "weight": 60
        },
        {
          "id": "dest-2",
          "value": "https://variant-b.example.com",
          "weight": 40
        }
      ]
    }
  ],
  "defaultFolder": "https://example.com"
}
```

**Result**: US visitors get 60% to variant-a, 40% to variant-b.

### Example 2: Custom Weight Ratios (30, 20, 20)

Weights are **relative** - they don't need to sum to 100:

```json
{
  "rules": [
    {
      "flags": { "country": "US" },
      "destinations": [
        {
          "id": "dest-1",
          "value": "https://variant-a.example.com",
          "weight": 30
        },
        {
          "id": "dest-2",
          "value": "https://variant-b.example.com",
          "weight": 20
        },
        {
          "id": "dest-3",
          "value": "https://variant-c.example.com",
          "weight": 20
        }
      ]
    }
  ],
  "defaultFolder": "https://example.com"
}
```

**Result**: 
- Total weight: 70
- Distribution: 30/70 (42.9%), 20/70 (28.6%), 20/70 (28.6%)

### Example 3: Mixed URLs and Folders

```json
{
  "rules": [
    {
      "flags": { "device": "Mobile" },
      "destinations": [
        {
          "id": "dest-1",
          "value": "https://mobile-variant-a.com",
          "weight": 50
        },
        {
          "id": "dest-2",
          "value": "mobile-lander-b/",
          "weight": 30
        },
        {
          "id": "dest-3",
          "value": "mobile-lander-c/",
          "weight": 20
        }
      ]
    }
  ],
  "defaultFolder": "https://example.com"
}
```

**Result**: URLs (starting with `http://` or `https://`) are treated as `proxyUrl`, folders are treated as `folder` actions.

### Example 4: Equal Split (1, 1, 1)

```json
{
  "rules": [
    {
      "flags": { "country": "US" },
      "destinations": [
        {
          "id": "dest-1",
          "value": "https://variant-a.com",
          "weight": 1
        },
        {
          "id": "dest-2",
          "value": "https://variant-b.com",
          "weight": 1
        },
        {
          "id": "dest-3",
          "value": "https://variant-c.com",
          "weight": 1
        }
      ]
    }
  ],
  "defaultFolder": "https://example.com"
}
```

**Result**: Equal 33.3% split across all three variants.

### Example 5: Destinations with Variables

```json
{
  "rules": [
    {
      "flags": { "country": "US" },
      "destinations": [
        {
          "id": "dest-1",
          "value": "us-variant-a/",
          "weight": 60
        },
        {
          "id": "dest-2",
          "value": "us-variant-b/",
          "weight": 40
        }
      ],
      "variables": {
        "promo_code": "USA2024",
        "discount": "20%"
      }
    }
  ],
  "defaultFolder": "https://example.com"
}
```

**Result**: Variables are applied to whichever destination is selected.

### Destination Properties

Each destination has:
- `id`: Unique identifier (used for logging/debugging)
- `value`: URL (starts with `http://` or `https://`) or folder path
- `weight`: Relative weight (any positive number - doesn't need to sum to 100)

### Performance Benefits

**Using destinations array** (recommended):
- ✅ Checks conditions **once** per request
- ✅ Single rule object in KV storage
- ✅ Faster execution
- ✅ Cleaner data structure

**Using multiple rules** (still works):
- Checks conditions N times (once per rule)
- N rule objects in KV storage
- Still functional, but less efficient

### Backward Compatibility

**Your existing JSON objects will continue to work!** The worker supports both:
1. **Destinations array** (new, more efficient)
2. **Multiple rules with weights** (existing approach)

Both methods produce the same result - destinations array is just faster and cleaner.

---

## Combinations & Edge Cases

### Example 1: Complex Multi-Condition Rule

```json
{
  "rules": [
    {
      "groups": [
        {
          "country": "US",
          "region": "CA",
          "device": "Mobile",
          "time": { "start": 9, "end": 17 }
        },
        {
          "country": "CA",
          "city": "Toronto",
          "browser": "Chrome"
        }
      ],
      "weight": 75,
      "modifications": [
        {
          "selector": "#location-banner",
          "action": "setText",
          "value": "Welcome {{user.CITY}}!"
        }
      ],
      "variables": {
        "local_phone": "+1-416-555-1234"
      }
    },
    {
      "weight": 25,
      "modifications": []
    }
  ],
  "defaultFolder": "https://example.com",
  "variables": {
    "company": "Example Inc"
  }
}
```

### Example 2: IP Range Targeting

```json
{
  "rules": [
    {
      "flags": {
        "ip": ["192.168.1.0/24", "10.0.0.1-10.0.0.255"]
      },
      "proxyUrl": "https://internal.example.com"
    }
  ],
  "defaultFolder": "https://example.com"
}
```

### Example 3: Organization-Based Blocking & Routing

```json
{
  "rules": [
    {
      "flags": {
        "org": "Google*"
      },
      "modifications": [
        {
          "selector": "#analytics",
          "action": "remove"
        }
      ]
    }
  ],
  "defaultFolder": "https://example.com",
  "blocks": {
    "orgs": ["*Bot*", "*Crawler*", "Amazon*"]
  }
}
```

### Example 4: Time-Based with Multiple Conditions

```json
{
  "rules": [
    {
      "flags": {
        "time": { "start": 0, "end": 8 },
        "country": ["US", "CA"],
        "device": "Mobile"
      },
      "modifications": [
        {
          "selector": "#promo",
          "action": "setText",
          "value": "Early Bird Special - 50% Off!"
        }
      ]
    }
  ],
  "defaultFolder": "https://example.com"
}
```

### Example 5: Language + Country Combination

```json
{
  "rules": [
    {
      "flags": {
        "language": "fr",
        "country": "CA"
      },
      "proxyUrl": "https://fr-ca.example.com"
    },
    {
      "flags": {
        "language": "fr",
        "country": "FR"
      },
      "proxyUrl": "https://fr-fr.example.com"
    }
  ],
  "defaultFolder": "https://example.com"
}
```

### Example 6: URL Parameter + Geographic Targeting

```json
{
  "rules": [
    {
      "flags": {
        "params": {
          "source": "partner"
        },
        "country": "US"
      },
      "modifications": [
        {
          "selector": "#partner-banner",
          "action": "setHtml",
          "value": "<div>Special Partner Offer!</div>"
        }
      ],
      "variables": {
        "partner_id": "{{query.source}}"
      }
    }
  ],
  "defaultFolder": "https://example.com"
}
```

### Example 7: Multiple Modification Actions

```json
{
  "rules": [
    {
      "flags": { "device": "Mobile" },
      "modifications": [
        {
          "selector": "#desktop-only",
          "action": "remove"
        },
        {
          "selector": "#mobile-cta",
          "action": "setCss",
          "value": {
            "display": "block",
            "position": "fixed",
            "bottom": "0",
            "width": "100%"
          }
        },
        {
          "selector": "#logo",
          "action": "setAttribute",
          "value": {
            "name": "src",
            "value": "/images/mobile-logo.png"
          }
        },
        {
          "selector": "#headline",
          "action": "setText",
          "value": "Mobile-Optimized Experience"
        }
      ]
    }
  ],
  "defaultFolder": "https://example.com"
}
```

### Example 8: Fallback Chain

```json
{
  "rules": [
    {
      "flags": { "country": "US" },
      "weight": 50,
      "proxyUrl": "https://us-variant-a.example.com"
    },
    {
      "flags": { "country": "US" },
      "weight": 50,
      "proxyUrl": "https://us-variant-b.example.com"
    },
    {
      "flags": { "country": "CA" },
      "proxyUrl": "https://ca.example.com"
    },
    {
      "flags": { "device": "Mobile" },
      "proxyUrl": "https://m.example.com"
    }
  ],
  "defaultFolder": "https://example.com"
}
```

**Logic Flow**:
1. US visitors → 50/50 split between variants
2. CA visitors → specific CA page
3. Mobile visitors (non-US/CA) → mobile page
4. Everyone else → default folder

### Example 9: Click-Out with Geographic Split Tests

```json
{
  "rules": [
    {
      "flags": { "country": "US" },
      "proxyUrl": "https://us-landing.example.com",
      "clickDestinations": [
        {
          "id": "us-partner-a",   // D1 destination ID
          "weight": 60
        },
        {
          "id": "us-partner-b",
          "weight": 40
        }
      ]
    },
    {
      "flags": { "country": "CA" },
      "proxyUrl": "https://ca-landing.example.com",
      "clickUrl": "https://partner-ca.com?source=tracked"
    },
    {
      "flags": { "country": "GB" },
      "clickDestinations": [
        { "id": "gb-offer-1", "weight": 1 },
        { "id": "gb-offer-2", "weight": 1 },
        { "id": "gb-offer-3", "weight": 1 }
      ]
    }
  ],
  "defaultFolder": "https://example.com"
}
```

**Logic Flow**:
1. US visitors see US landing page; `/click` links split 60/40 between two partner destinations resolved from D1.
2. CA visitors see CA landing page; `/click` links go to single CA partner.
3. GB visitors see default folder; `/click` links split equally (33.3% each) across three offers (URLs resolved from D1).
4. All query parameters from original `/click` request are preserved in redirects.

---

## Best Practices

1. **Order Matters**: Rules are checked in order. Put more specific rules first.
2. **Weight Totals**: Weights don't need to sum to 100 - they're relative. The system calculates proportions automatically.
3. **Use Destinations Array**: For split tests within a single rule, use `destinations` array instead of multiple rules - it's faster and more efficient.
4. **Macro Performance**: Macros are replaced server-side, so they're fast and SEO-friendly.
5. **Block Rules**: Use block rules for security/bot blocking, not for regular routing.
6. **Groups vs Flags**: Use `groups` for OR logic, `flags` for simple AND logic.
7. **Default Folder**: Always provide a `defaultFolder` as a fallback.
8. **Testing**: Test rules with various conditions before deploying to production.
9. **Click-Out Links**: Use `/click` suffix on links to trigger click-out handling. Query parameters are automatically preserved, making it easy to track campaign parameters through redirects.
10. **Click-Out Split Tests**: Use `clickDestinations` array for weighted split tests on outbound links, allowing A/B testing of affiliate partners or offers.

---

## KV Storage Keys

Rules are stored in KV with keys following this pattern:
- `{domain}{path}` - Exact domain + path match
- `{domain}` - Domain-only match (fallback)

Examples:
- `example.com/` - Root path
- `example.com/products` - Specific path
- `example.com/products/item` - Nested path
- `example.com` - Domain-only (catches all paths)

The system automatically walks up the path hierarchy to find matching rules.

---

## Notes

- **Legacy Support**: Old rules using `folder` with URLs or `fetchUrl` are automatically converted to `proxyUrl`.
- **Asset Requests**: URL parameter conditions don't match on asset requests (CSS, JS, images, etc.).
- **JS Snippet**: The `folder` action (local files) is not supported in JS Snippet mode.
- **Modifications**: Work with both DNS Proxy and JS Snippet integrations.
- **Proxy vs Redirect**: Use `proxyUrl` for seamless experience, `redirectUrl` when you want URL change.

