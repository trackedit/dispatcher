window['$d'] = document.getElementById.bind(document);
const _menuTransition = 'max-height 0.3s ease-out';

const statsigWWW = {
  clearMenuHighlight: function() {
    const headerLinks = document.getElementsByClassName('headerLink');
    for (let ii = 0; ii < headerLinks.length; ii++) {
      headerLinks[ii].classList.remove('active');
    }
  },

  formatNumberForAnimation: function(num, isInteger) {
    let numericValue = num;
    return numericValue.toLocaleString('en-US', {
      style: 'decimal',
      minimumFractionDigits: isInteger ? 0 : 2,
      maximumFractionDigits: isInteger ? 0 : 2,
    });
  },

  formatNumber: function(num) {
    if (Number.isNaN(num)) {
      return "[Out of Range]";
    }

    return Intl.NumberFormat('en-US', {
      notation: "compact",
      maximumFractionDigits: 1
    }).format(num);
  },

  getClickHandlerQuery: function(useCached = false) {
    const url = new URL(window.location.href);
    const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    const stmKeys = ['_stm_source', '_stm_medium', '_stm_campaign', '_stm_term', '_stm_content'];
    for (let ii = 0; ii < utmKeys.length; ii++) {
      const uk = utmKeys[ii];
      const sk = stmKeys[ii];
      const value = url.searchParams.get(uk);
      if (value) {
        localStorage.setItem(sk, value);
      } else if (useCached) {
        const lv = localStorage.getItem(sk);
        if (lv) {
          url.searchParams.set(uk, lv);
        }
      }
    }
    return url.searchParams.toString();
  },

  getEventSection: function (element) {
    while (element) {
      let eventSection = element.dataset.eventSection;
      if (eventSection) {
        return eventSection;
      }

      element = element.parentElement;
    }

    return null;
  },

  getReferrerUrl: function(useCached = false) {
    const query = this.getClickHandlerQuery(useCached);
    const url = new URL(window.location.href);
    url.search = query;
    url.searchParams.delete('referrer'); // Prevent recursion
    return url.toString();
  },

  hideDesktopMenu: function(animate = false) {
    if (!this.openMenuElement) {
      return;
    }
    const element = this.openMenuElement;
    if (animate) {
      element.style.transition = _menuTransition;
    }    
    this.clearMenuHighlight();
    element.style.maxHeight = 0;
    setTimeout(() => {
      element.style.transition = 'unset';
    }, 300);
    this.openMenuElement = null;
  },

  hideMobileMenu: function() {
    const mobileMenuItems = document.getElementsByClassName('mobileMenu');
    Array.from(mobileMenuItems).forEach(mm => mm.style.display = 'none');
    $d('mobileLogo').style.display = 'block';
    Array.from(document.getElementsByClassName('mobileBackLink')).forEach(mbl => {
      mbl.style.display = 'none';
    });
  },

  logEngagementMetrics: function() {
    window.addEventListener('scroll', () => {
      const scrollDepth = Math.min(
        100,
        Math.round((window.scrollY + window.innerHeight) / document.body.scrollHeight * 100),
      );
      if (scrollDepth > statsigWWW.deepestScroll) {
        statsigWWW.deepestScroll = scrollDepth;
      }
    });
    window.addEventListener('beforeunload', () => {
      const metadata = { url: window.location.href };
      window.statsigSDK.logEvent({
        eventName: 'scroll_depth',
        value: statsigWWW.deepestScroll,
        metadata: metadata,
      });
      window.statsigSDK.logEvent({
        eventName: 'time_on_page_ms',
        value: Date.now() - statsigWWW.loadStartTime,
        metadata: metadata,
      });
    });
  },
  
  onLoad: function () {
    statsigWWW.deepestScroll = 0;
    statsigWWW.loadStartTime = Date.now();
    this.setupDesktopMenus();
    try {
      this.wireClickHandlers('button');
      this.wireClickHandlers('a');
      this.wireClickHandlers('div[data-event-value]');
      this.prepareConsoleLinks();
    } catch(e) {
      console.error(e);
    }
    
    const bootstrapValues = globalThis.statsigInitializeValues ?? '';
    let bootstrapObject = undefined;
    if (bootstrapValues !== '') {
      try {
        bootstrapObject = JSON.parse(bootstrapValues);
        bootstrapObject["can_record_session"] = true;
        bootstrapObject["session_recording_rate"] = 1;
        bootstrapObject = JSON.stringify(bootstrapObject);
      } catch(e) {
        console.error(e);
      }
    }

    const { StatsigClient, StatsigSessionReplayPlugin, StatsigAutoCapturePlugin } = window.Statsig;
    const user = window['statsigUser'] || null;
    const client = new StatsigClient(
      'client-XlqSMkAavOmrePNeWfD0fo2cWcjxkZ0cJZz64w7bfHX', 
      user, 
      {
        plugins: [
          new StatsigSessionReplayPlugin(),
          new StatsigAutoCapturePlugin({
            consoleLogAutoCaptureSettings: {
              enabled: true,
            }
          }),
        ],
      },
    );

    client.on('error', (event) => {
      if (event.tag === 'NetworkError') {
        if (event.requestArgs && event.requestArgs.url) {
          event.error.stack =
            `StatsigNetworkError: ${event.requestArgs.url}\n` +
            event.error.stack;
        }

        client
          .getContext()
          .errorBoundary.logError('statig_www:network_error', event.error);
      }
    });

    // bootstrap
    client.dataAdapter.setData(bootstrapObject, user);
    client.initializeSync();

    window.statsigSDK = client;
    statsigWWW.onSDKInit(client);
  },

  onSDKInit: function (statsigClient) {
    statsigClient.logEvent({
      eventName: 'ga_available',
      value: !!(window.ga && ga.create)
    });
    if (URLSearchParams) {
      const params = new URLSearchParams(window.location.search);
      statsigClient.logEvent({
        eventName: 'page_load',
        value: window.location.pathname,
        metadata: Object.fromEntries(params),
      });
    } else {
      statsigClient.logEvent({
        eventName: 'page_load',
        value: window.location.pathname
      });
    }

    if (
      window.__ccKey &&
      statsigClient.checkGate('show_cookie_consent') &&
      !document.cookie.includes(window.__ccKey)
    ) {
      document.getElementById('cookieConsent').style.display = 'unset';
    }

    statsigWWW.logEngagementMetrics();
  },

  prepareConsoleLinks: function() {
    const allAnchors = document.getElementsByTagName('a');
    const referrer = this.getReferrerUrl(true);
    for (let ii = 0; ii < allAnchors.length; ii++) {
      const anchor = allAnchors[ii];
      if (anchor.href && anchor.href.includes('console.statsig.com') && typeof window.cookieStore !== 'undefined') {
        let url = new URL(anchor.href);

        url.searchParams.set('referrer', referrer);
        anchor.href = url.toString();

        window.cookieStore.get('_ga').then(c => {
          if (!c || !c.value) {
            return;
          }
          url.searchParams.set('_ga', c.value);
          anchor.href = url.toString();
        });
      }
    }
  },

  setupAccordion(containerId, imageId, imageFolder) {
    const allExpanders = Array.from($d(containerId).querySelectorAll('.expanderContainer'));
    const image = $d(imageId);
    image.style.opacity = 1;
    
    let activeExpander = null;
    let prevActive = null;
    allExpanders.forEach(el => {
      if (!activeExpander) {
        activeExpander = el;
        activeExpander.classList.add('active');
      }
      el.addEventListener('click', e => {
        if (e.currentTarget === activeExpander) {
          return;
        }
        prevActive = activeExpander;
        activeExpander = e.currentTarget;
        activeExpander.classList.add('active');        
        const index = allExpanders.indexOf(activeExpander);
        if (index >= 0) {
          image.style.opacity = 0;
          setTimeout(() => {
            const imageUrl = activeExpander.dataset['imageUrl'];
            image.src = imageUrl ? imageUrl : `${imageFolder}/highlight-${index}.png`;
            image.style.opacity = 1;
          }, 200);
        }
        setTimeout(() => {
          prevActive.classList.remove('active');
        }, 10);
      })
    });
  },

  setupAdsTracking: function () {
    window.dataLayer = window.dataLayer || [];

    window.ko = window.ko || [];
    [
      'identify',
      'track',
      'removeListeners',
      'open',
      'on',
      'off',
      'qualify',
      'ready',
    ].forEach(function (t) {
      ko[t] = function () {
        var n = [].slice.call(arguments);
        return n.unshift(t), ko.push(n), ko;
      };
    });

    if (!window.revealCallback) {
      window.revealCallback = () => {};
    }
  },

  setupDesktopMenus: function() {
    if (this.menusSetup) {
      return;
    }
    const headerLinks = document.getElementsByClassName('headerLink');
    if (headerLinks.length === 0) {
      return;
    }
    for (let ii = 0; ii < headerLinks.length; ii++) {
      const link = headerLinks[ii];
      link.addEventListener('click', (e) => {
        const target = link.dataset['targetElement'];
        if (target) {
          statsigWWW.toggleDesktopMenu(link, target);
        }
        if (!link.classList.contains('passthrough')) {
          e.preventDefault();
          return false;
        }
      });
    }

    document.addEventListener('click', (e) => {
      const desktopMenuContainer = $d('desktopMenuContainer');
      if (!desktopMenuContainer) {
        return;
      }
      const target = e.target;
      if (desktopMenuContainer.contains(target) || target.classList.contains('headerLink')) {
        return;
      }
      statsigWWW.hideDesktopMenu(true);
    });
    this.menusSetup = true;
  },

  setupMobileMenus: function() {
    const menuItems = document.getElementsByClassName('mobileMenuItem');
    for (let ii = 0; ii < menuItems.length; ii++) {
      const link = menuItems[ii];
      link.addEventListener('click', (e) => {
        const target = link.dataset['targetElement'];
        if (target) {
          statsigWWW.showMobileMenu(link, target);
        }
        if (!link.classList.contains('passthrough')) {
          e.preventDefault();
          return false;
        }
      });
    }

    Array.from(document.getElementsByClassName('mobileBackLink')).forEach(mbl => {
      mbl.addEventListener('click', (e) => {
        $d('mobileMenuContainer').style.left = '0';
        setTimeout(() => {
          statsigWWW.hideMobileMenu();
        }, 200);
      });
    });
  },

  showDesktopMenu: function(link, element) {
    if (this.openMenuElement == element) {
      return;
    }
    const anotherMenuOpen = this.openMenuElement ? true : false;
    this.hideDesktopMenu();
    
    this.openMenuElement = element;
    if (!anotherMenuOpen) {
      element.style.transition = _menuTransition;
    }
    element.style.maxHeight = '625px';
    link.classList.add('active');
    setTimeout(() => {
      element.style.transition = 'unset';
    }, 300);
  },

  showMobileMenu: function(link, target) {
    this.hideMobileMenu();
    $d('mobileLogo').style.display = 'none';
    $d('mobileMenu' + target).style.display = 'block';
    $d('back' + target).style.display = 'block';
    $d('mobileMenuContainer').style.left = '-100%';
  },

  toggleDesktopMenu: function(link, target) {
    const elementId = 'desktopMenu' + target;
    const element = $d(elementId);
    if (!element) {
      return;
    }
    element.offsetHeight > 20 
      ? this.hideDesktopMenu(true) 
      : this.showDesktopMenu(link, element);
  },

  toggleHamburgerMenu: function () {
    this.menuVisible = !this.menuVisible;
    this.hideMobileMenu();
    $d('mobileMenuContainer').style.display = this.menuVisible ? 'block' : 'none';
    $d('mobileMenuContainer').style.left = 0;
    $d('navicon').classList[this.menuVisible ? 'add' : 'remove']('open');
    $d('pageContent').style.display = this.menuVisible ? 'none' : 'block';
    $d('footer').style.display = this.menuVisible ? 'none' : 'block';
  },

  wireClickHandlers: function (tagName) {
    const elements = document.querySelectorAll(tagName);
    for (let ii = 0; ii < elements.length; ii++) {
      const el = elements[ii];
      if (!el.dataset.eventValue) {
        continue;
      }

      el.addEventListener('click', () => {
        const section = this.getEventSection(el);
        window.statsigSDK && window.statsigSDK.logEvent('click', el.dataset.eventValue, {
          section: section,
          type: el.dataset.eventType,
        });
        dataLayer.push({
          'event': el.dataset.eventValue,
          'location': section
        });
      });
    }
  },
};

document.addEventListener('DOMContentLoaded', () => {
  statsigWWW.setupDesktopMenus();
  statsigWWW.setupMobileMenus();
});