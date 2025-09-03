// This file is reconstructed from the bundled worker code.

export function parseOS(userAgent: string): string {
    const ua = userAgent.toLowerCase();

    if (/windows nt 10\.0/.test(ua)) return /windows nt 10\.0.*build 22/.test(ua) ? "Windows 11" : "Windows 10";
    if (/windows nt 6\.3/.test(ua)) return "Windows 8.1";
    if (/windows nt 6\.2/.test(ua)) return "Windows 8";
    if (/windows nt 6\.1/.test(ua)) return "Windows 7";
    if (/windows nt 6\.0/.test(ua)) return "Windows Vista";
    if (/windows nt 5\.2/.test(ua)) return "Windows Server 2003";
    if (/windows nt 5\.1/.test(ua)) return "Windows XP";
    if (/windows nt/.test(ua)) return "Windows";
    if (/win/.test(ua) && /phone/.test(ua)) return "Windows Phone";

    if (/iphone os|ios/.test(ua)) {
        const match = userAgent.match(/(?:iPhone )?OS (\d+)[._](\d+)(?:[._](\d+))?/i);
        return match ? `iOS ${match[1]}.${match[2]}${match[3] ? "." + match[3] : ""}` : "iOS";
    }
    if (/ipad/.test(ua)) {
        const match = userAgent.match(/OS (\d+)[._](\d+)(?:[._](\d+))?/i);
        if (match) {
            const major = parseInt(match[1]);
            return major >= 13 ? `iPadOS ${major}.${match[2]}${match[3] ? "." + match[3] : ""}` : `iOS ${major}.${match[2]}${match[3] ? "." + match[3] : ""}`;
        }
        return "iPadOS";
    }
    if (/mac os x|macos/.test(ua)) {
        const match = userAgent.match(/Mac OS X (\d+)[._](\d+)(?:[._](\d+))?/i);
        if (match) {
            const major = parseInt(match[1]);
            const minor = parseInt(match[2]);
            const patch = match[3] ? parseInt(match[3]) : 0;
            if (major === 15) return `macOS Sequoia 15.${minor}.${patch}`;
            if (major === 14) return `macOS Sonoma 14.${minor}.${patch}`;
            if (major === 13) return `macOS Ventura 13.${minor}.${patch}`;
            if (major === 12) return `macOS Monterey 12.${minor}.${patch}`;
            if (major === 11) return `macOS Big Sur 11.${minor}.${patch}`;
            if (major === 10) {
                if (minor >= 15) return `macOS Catalina 10.${minor}.${patch}`;
                if (minor >= 14) return `macOS Mojave 10.${minor}.${patch}`;
                if (minor >= 13) return `macOS High Sierra 10.${minor}.${patch}`;
                if (minor >= 12) return `macOS Sierra 10.${minor}.${patch}`;
                return `macOS 10.${minor}.${patch}`;
            }
            return `macOS ${major}.${minor}.${patch}`;
        }
        return "macOS";
    }
    if (/android/.test(ua)) {
        const match = userAgent.match(/Android (\d+(?:\.\d+)?(?:\.\d+)?)/i);
        if (match) {
            const version = match[1];
            const major = parseInt(version.split('.')[0]);
            if (major >= 15) return `Android 15 (${version})`;
            if (major >= 14) return `Android 14 (${version})`;
            if (major >= 13) return `Android 13 (${version})`;
            if (major >= 12) return `Android 12 (${version})`;
            if (major >= 11) return `Android 11 (${version})`;
            return `Android ${version}`;
        }
        return "Android";
    }

    if (/ubuntu/.test(ua)) {
        const match = userAgent.match(/Ubuntu\/(\d+\.\d+)/i);
        return match ? `Ubuntu ${match[1]}` : "Ubuntu";
    }
    if (/debian/.test(ua)) return "Debian";
    if (/fedora/.test(ua)) return "Fedora";
    if (/centos/.test(ua)) return "CentOS";
    if (/red hat|rhel/.test(ua)) return "Red Hat Enterprise Linux";
    if (/suse/.test(ua)) return "SUSE Linux";
    if (/arch/.test(ua)) return "Arch Linux";
    if (/manjaro/.test(ua)) return "Manjaro";
    if (/mint/.test(ua)) return "Linux Mint";
    if (/elementary/.test(ua)) return "elementary OS";
    if (/pop!_os/.test(ua)) return "Pop!_OS";
    if (/linux/.test(ua)) return "Linux";

    if (/cros/.test(ua)) {
        const match = userAgent.match(/CrOS [^ ]+ ([\d.]+)/i);
        return match ? `Chrome OS ${match[1]}` : "Chrome OS";
    }

    if (/freebsd/.test(ua)) return "FreeBSD";
    if (/openbsd/.test(ua)) return "OpenBSD";
    if (/netbsd/.test(ua)) return "NetBSD";
    if (/sunos/.test(ua)) return "Solaris";
    if (/aix/.test(ua)) return "AIX";
    if (/hpux/.test(ua)) return "HP-UX";
    if (/irix/.test(ua)) return "IRIX";
    if (/os\/2/.test(ua)) return "OS/2";
    if (/beos/.test(ua)) return "BeOS";
    if (/amiga/.test(ua)) return "AmigaOS";

    return "Unknown";
}

export function parseAcceptLanguage(acceptLanguageHeader: string | null): string | null {
    if (!acceptLanguageHeader) {
        return null;
    }
    return acceptLanguageHeader.split(',')[0].split('-')[0].toLowerCase();
}

export function parseBrowser(userAgent: string, clientHintsUA?: string): { name: string, version: string } {
    const ua = userAgent.toLowerCase();

    if (clientHintsUA) {
        const brands = clientHintsUA.split(',').map(s => s.trim());
        for (const brand of brands) {
            const match = brand.match(/"([^"]+)";v="(\d+)"/);
            if (match) {
                const [, name, version] = match;
                if (!name.includes("Not") && !name.includes("Brand") && name !== "Chromium") {
                    if (name === "Opera GX") return { name: "Opera GX", version };
                    if (name === "Brave") return { name: "Brave", version };
                    if (name === "Microsoft Edge") return { name: "Microsoft Edge", version };
                    if (name === "Opera") return { name: "Opera", version };
                    if (name === "Vivaldi") return { name: "Vivaldi", version };
                    return { name, version };
                }
            }
        }
        for (const brand of brands) {
            const match = brand.match(/"Chromium";v="(\d+)"/);
            if (match) return { name: "Chromium", version: match[1] };
        }
    }

    if (/opera.*gx|opgx/.test(ua)) {
        const match = userAgent.match(/(?:OPR|Opera)\/(\d+(?:\.\d+)*)/i);
        return { name: "Opera GX", version: match ? match[1] : "Unknown" };
    }
    if (/edg\/|edge\//.test(ua)) {
        const match = userAgent.match(/(?:Edg|Edge)\/(\d+(?:\.\d+)*)/i);
        return { name: "Microsoft Edge", version: match ? match[1] : "Unknown" };
    }
    if (/brave/.test(ua) || clientHintsUA?.includes("Brave")) {
        const match = userAgent.match(/Brave\/(\d+)/i) || userAgent.match(/Chrome\/(\d+)/i);
        return { name: "Brave", version: match ? match[1] : "Unknown" };
    }
    if (/arc/.test(ua) || /arc\//.test(ua)) {
        const match = userAgent.match(/Arc\/(\d+(?:\.\d+)*)/i) || userAgent.match(/Chrome\/(\d+)/i);
        return { name: "Arc", version: match ? match[1] : "Unknown" };
    }
    if (/vivaldi/.test(ua)) {
        const match = userAgent.match(/Vivaldi\/(\d+(?:\.\d+)*)/i);
        return { name: "Vivaldi", version: match ? match[1] : "Unknown" };
    }
    if (/opr\/|opera/.test(ua)) {
        const match = userAgent.match(/(?:OPR|Opera)\/(\d+(?:\.\d+)*)/i);
        return { name: "Opera", version: match ? match[1] : "Unknown" };
    }
    if (/duckduckgo/.test(ua) || /ddg/.test(ua)) {
        const match = userAgent.match(/DuckDuckGo\/(\d+(?:\.\d+)*)/i) || userAgent.match(/DDG\/(\d+(?:\.\d+)*)/i);
        return { name: "DuckDuckGo Browser", version: match ? match[1] : "Unknown" };
    }
    if (/firefox|fxios/.test(ua)) {
        let match = userAgent.match(/Firefox\/(\d+(?:\.\d+)*)/i);
        if (!match) match = userAgent.match(/FxiOS\/(\d+(?:\.\d+)*)/i);
        return /mobile/.test(ua) || /android/.test(ua) || /fxios/.test(ua) ?
            { name: "Firefox Mobile", version: match ? match[1] : "Unknown" } :
            { name: "Firefox", version: match ? match[1] : "Unknown" };
    }
    if (/safari/.test(ua) && !/chrome|chromium|edg/.test(ua)) {
        let version = "Unknown";
        const versionMatch = userAgent.match(/Version\/(\d+(?:\.\d+)*)/i);
        if (versionMatch) {
            version = versionMatch[1];
        } else {
            const safariMatch = userAgent.match(/Safari\/(\d+)/i);
            if (safariMatch) version = safariMatch[1];
        }
        return /mobile/.test(ua) || /iphone|ipod|ipad/.test(ua) ?
            { name: "Mobile Safari", version } : { name: "Safari", version };
    }
    if (/chrome|crios/.test(ua) && !/edg|opr|vivaldi|brave|arc/.test(ua)) {
        let match = userAgent.match(/Chrome\/(\d+(?:\.\d+)*)/i);
        if (!match) match = userAgent.match(/CriOS\/(\d+(?:\.\d+)*)/i);
        return /mobile/.test(ua) || /android/.test(ua) || /crios/.test(ua) ?
            { name: "Chrome Mobile", version: match ? match[1] : "Unknown" } :
            { name: "Google Chrome", version: match ? match[1] : "Unknown" };
    }
    if (/samsungbrowser/.test(ua)) {
        const match = userAgent.match(/SamsungBrowser\/(\d+(?:\.\d+)*)/i);
        return { name: "Samsung Internet", version: match ? match[1] : "Unknown" };
    }
    if (/ucbrowser|uc browser/.test(ua)) {
        const match = userAgent.match(/UCBrowser\/(\d+(?:\.\d+)*)/i);
        return { name: "UC Browser", version: match ? match[1] : "Unknown" };
    }
    if (/yabrowser/.test(ua)) {
        const match = userAgent.match(/YaBrowser\/(\d+(?:\.\d+)*)/i);
        return { name: "Yandex Browser", version: match ? match[1] : "Unknown" };
    }
    if (/qqbrowser/.test(ua)) {
        const match = userAgent.match(/QQBrowser\/(\d+(?:\.\d+)*)/i);
        return { name: "QQ Browser", version: match ? match[1] : "Unknown" };
    }
    if (/tor/.test(ua) || /torbrowser/.test(ua)) {
        const match = userAgent.match(/Firefox\/(\d+)/i);
        return { name: "Tor Browser", version: match ? match[1] : "Unknown" };
    }
    if (/focus/.test(ua)) {
        const match = userAgent.match(/Focus\/(\d+(?:\.\d+)*)/i);
        return { name: "Firefox Focus", version: match ? match[1] : "Unknown" };
    }
    if (/klar/.test(ua)) {
        const match = userAgent.match(/Klar\/(\d+(?:\.\d+)*)/i);
        return { name: "Firefox Klar", version: match ? match[1] : "Unknown" };
    }
    if (/msie|trident/.test(ua)) {
        const match = userAgent.match(/(?:MSIE |rv:)(\d+(?:\.\d+)*)/i);
        return { name: "Internet Explorer", version: match ? match[1] : "Unknown" };
    }
    if (/webview/.test(ua) || (/android/.test(ua) && !/chrome|firefox|opera/.test(ua))) {
        return { name: "WebView", version: "Unknown" };
    }
    if (/chromium/.test(ua)) {
        const match = userAgent.match(/Chromium\/(\d+(?:\.\d+)*)/i);
        return { name: "Chromium", version: match ? match[1] : "Unknown" };
    }
    if (/netscape/.test(ua)) return { name: "Netscape", version: "Unknown" };
    if (/seamonkey/.test(ua)) {
        const match = userAgent.match(/SeaMonkey\/(\d+(?:\.\d+)*)/i);
        return { name: "SeaMonkey", version: match ? match[1] : "Unknown" };
    }

    return { name: "Unknown", version: "Unknown" };
}

export function parseEngine(userAgent: string): string {
    const ua = userAgent.toLowerCase();

    if (/chrome|chromium|edg|opr/.test(ua) && !/webkit\/5(?:00|01|02|03|04)/.test(ua)) {
        const match = userAgent.match(/Chrome\/(\d+)/i);
        return match ? `Blink (Chrome ${match[1]})` : "Blink";
    }
    if (/webkit/.test(ua)) {
        const match = userAgent.match(/WebKit\/(\d+(?:\.\d+)*)/i);
        if (/safari/.test(ua) && !/chrome/.test(ua)) {
            return match ? `WebKit ${match[1]} (Safari)` : "WebKit (Safari)";
        }
        return match ? `WebKit ${match[1]}` : "WebKit";
    }
    if (/gecko/.test(ua) && !/webkit/.test(ua)) {
        const match = userAgent.match(/rv:(\d+(?:\.\d+)*)/i);
        return match ? `Gecko ${match[1]}` : "Gecko";
    }
    if (/trident/.test(ua)) {
        const match = userAgent.match(/Trident\/(\d+(?:\.\d+)*)/i);
        return match ? `Trident ${match[1]}` : "Trident";
    }
    if (/edge\//.test(ua) && !/edg\//.test(ua)) {
        const match = userAgent.match(/Edge\/(\d+(?:\.\d+)*)/i);
        return match ? `EdgeHTML ${match[1]}` : "EdgeHTML";
    }
    if (/presto/.test(ua)) {
        const match = userAgent.match(/Presto\/(\d+(?:\.\d+)*)/i);
        return match ? `Presto ${match[1]}` : "Presto";
    }
    return "Unknown";
}

export function parseDeviceType(userAgent: string, clientHintsMobile?: string): string {
    const ua = userAgent.toLowerCase();

    if (clientHintsMobile === "?1") return "Mobile";
    if (clientHintsMobile === "?0") {
        return /ipad/.test(ua) || /tablet|kindle/.test(ua) ? "Tablet" : "Desktop";
    }
    
    if (/smart-tv|smarttv|googletv|appletv|roku|fire tv|chromecast/.test(ua) ||
        /playstation|xbox|nintendo/.test(ua) ||
        (/webkit.*mobile.*version.*safari/.test(ua) && /tv/.test(ua)) ||
        /tizen|webos|netcast|hbbtv/.test(ua)) {
        return "TV";
    }
    if (/ipad/.test(ua) || /tablet/.test(ua) || /kindle fire|nexus [789]|sm-t|galaxy tab/.test(ua) ||
        /surface|transformer|xoom|xyboard/.test(ua) ||
        (/android/.test(ua) && !/mobile/.test(ua)) ||
        /playbook|bb10/.test(ua)) {
        return "Tablet";
    }
    if (/watch/.test(ua) || /wearos/.test(ua) || /apple watch|watchos/.test(ua) ||
        /fitbit|garmin|polar/.test(ua)) {
        return "Wearable";
    }
    if (/playstation|xbox|nintendo|switch|3ds|vita/.test(ua)) {
        return "Gaming Console";
    }
    if (/mobile|phone|android.*mobile|iphone|ipod/.test(ua) ||
        /blackberry|bb|palm|webos|opera mini/.test(ua) ||
        /windows phone|wp7|wp8|lumia/.test(ua) ||
        /symbian|s60|series60/.test(ua)) {
        return "Mobile";
    }
    if (/kindle/.test(ua) && !/fire/.test(ua)) {
        return "E-Reader";
    }
    if (/car|automotive|tesla|bmw|audi|mercedes/.test(ua)) {
        return "Automotive";
    }

    return "Desktop";
}

export function parseDeviceBrand(userAgent: string): string | null {
    const ua = userAgent.toLowerCase();

    if (/iphone|ipad|ipod|macintosh|apple watch|apple tv/.test(ua)) return "Apple";
    if (/samsung|sm-[a-z]\d+|galaxy|gt-[a-z]\d+/.test(ua)) return "Samsung";
    if (/huawei|honor|hma-|lya-|eva-|vtr-|wkf-|ane-|col-|bkl-|ela-|pot-|yal-|mar-/.test(ua)) return "Huawei";
    if (/xiaomi|redmi|poco|mi \d+|mix \d+|note \d+|max \d+/.test(ua)) return "Xiaomi";
    if (/oneplus|1\+|hd1900|hd1901|hd1903|hd1905|gm1900|gm1901|gm1903|gm1905/.test(ua)) return "OnePlus";
    if (/pixel|nexus|chromebook pixel/.test(ua)) return "Google";
    if (/oppo|realme|cph\d+|rmx\d+/.test(ua)) return "Oppo";
    if (/vivo|bbg\d+|v\d{4}[a-z]/.test(ua)) return "Vivo";
    if (/lg|lg-[a-z]\d+|lm-[a-z]\d+/.test(ua)) return "LG";
    if (/sony|xperia|so-\d+|sov\d+|sgp\d+/.test(ua)) return "Sony";
    if (/htc|desire|sensation|one [a-z]\d+/.test(ua)) return "HTC";
    if (/motorola|moto|xt\d+|mb\d+/.test(ua)) return "Motorola";
    if (/nokia|lumia|ta-\d+/.test(ua)) return "Nokia";
    if (/lenovo|thinkpad|ideapad|yoga/.test(ua)) return "Lenovo";
    if (/dell|inspiron|latitude|xps|alienware/.test(ua)) return "Dell";
    if (/hp|hewlett-packard|pavilion|elitebook|probook|spectre|envy|omen/.test(ua)) return "HP";
    if (/asus|zenbook|vivobook|rog|transformer/.test(ua)) return "Asus";
    if (/acer|aspire|predator|swift|spin/.test(ua)) return "Acer";
    if (/surface/.test(ua)) return "Microsoft";
    if (/kindle|fire|amazon/.test(ua)) return "Amazon";
    if (/tesla/.test(ua)) return "Tesla";
    if (/playstation|ps\d/.test(ua)) return "Sony";
    if (/xbox/.test(ua)) return "Microsoft";
    if (/nintendo|switch|3ds/.test(ua)) return "Nintendo";

    return null;
}
