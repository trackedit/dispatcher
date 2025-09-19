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

  onLoad: function () {
    statsigWWW.deepestScroll = 0;
    statsigWWW.loadStartTime = Date.now();
    this.setupDesktopMenus();
    try {
      this.wireClickHandlers('button');
      this.wireClickHandlers('a');
      this.wireClickHandlers('div[data-event-value]');
      $d('navicon').addEventListener('click', () => this.toggleHamburgerMenu());
      this.setupUsecaseHighlights();
    } catch(e) {
      console.error(e);
    }
  },
  setupUsecaseHighlights: function() {
    const tabs = document.querySelectorAll('.sdkTab[data-usecase]');
    if (!tabs || tabs.length === 0) {
      return;
    }

    const setActiveTab = (selected) => {
      tabs.forEach(t => t.classList.toggle('active', t === selected));
    };

    const highlightUsecase = (usecase) => {
      const pills = document.querySelectorAll('.productPill');
      pills.forEach(pill => {
        if (usecase === 'all') {
          pill.classList.remove('dim');
          pill.classList.remove('highlight');
          return;
        }
        const tags = (pill.dataset.usecases || '').split(',').map(s => s.trim());
        const match = tags.includes(usecase);
        pill.classList.toggle('dim', !match);
        pill.classList.toggle('highlight', match);
      });
    };

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        setActiveTab(tab);
        highlightUsecase(tab.dataset.usecase);
      });
    });

    // Ensure default state
    const active = document.querySelector('.sdkTab[data-usecase].active');
    highlightUsecase(active ? active.dataset.usecase : 'all');
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
        dataLayer.push({
          'event': el.dataset.eventValue,
          'location': section
        });
      });
    }
  },
};

document.addEventListener('DOMContentLoaded', () => {
  statsigWWW.onLoad();
});