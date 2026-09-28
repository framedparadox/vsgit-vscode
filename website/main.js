/* VsGit marketing site — progressive enhancement only; the page works without JS. */
(() => {
  'use strict';

  const root = document.documentElement;
  root.classList.add('js');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  const year = $('#year');
  if (year) year.textContent = String(new Date().getFullYear());

  /* ── Reveal on scroll ─────────────────────────────────────────────── */
  const reveals = $$('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        // Stagger siblings that enter together.
        const siblings = $$('.reveal', e.target.parentElement);
        const idx = Math.max(0, siblings.indexOf(e.target));
        e.target.style.transitionDelay = `${Math.min(idx, 6) * 70}ms`;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-in'));
  }

  /* ── Nav: switch to light chrome over light sections ─────────────── */
  const nav = $('#nav');
  const sections = $$('main > section');
  const updateNav = () => {
    const probe = nav.offsetHeight / 2;
    const current = sections.find((s) => {
      const r = s.getBoundingClientRect();
      return r.top <= probe && r.bottom > probe;
    });
    const light = current && !current.classList.contains('dark');
    nav.classList.toggle('is-light', !!light);
  };

  /* Mobile menu */
  const toggle = $('.nav__toggle');
  const menu = $('#mobile-menu');
  const setMenu = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu.hidden = !open;
  };
  toggle.addEventListener('click', () => setMenu(menu.hidden));
  $$('a', menu).forEach((a) => a.addEventListener('click', () => setMenu(false)));

  /* ── Hero window: tilt flattens as you scroll ────────────────────── */
  const heroWin = $('#heroWindow');
  const updateHero = () => {
    if (!heroWin || reduceMotion) return;
    const r = heroWin.getBoundingClientRect();
    const vh = window.innerHeight;
    const p = Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.9)));
    heroWin.style.setProperty('--tilt', `${(18 * (1 - p)).toFixed(2)}deg`);
    heroWin.style.setProperty('--scale', (0.92 + 0.08 * p).toFixed(3));
  };

  /* ── Statement: words light up as the paragraph scrolls past ─────── */
  const scrub = $('[data-scrub]');
  let words = [];
  if (scrub && !reduceMotion) {
    const walk = (node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          const frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
            const span = document.createElement('span');
            span.className = 'w';
            span.textContent = part;
            frag.appendChild(span);
          });
          child.replaceWith(frag);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          walk(child);
        }
      }
    };
    walk(scrub);
    words = $$('.w', scrub);
  }
  const updateScrub = () => {
    if (!words.length) return;
    const r = scrub.getBoundingClientRect();
    const vh = window.innerHeight;
    const p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.35)));
    const lit = Math.round(p * words.length);
    words.forEach((w, i) => w.classList.toggle('on', i < lit));
  };

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      updateNav(); updateHero(); updateScrub();
      ticking = false;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();

  /* ── Count-up stats ──────────────────────────────────────────────── */
  const counters = $$('[data-count]');
  if ('IntersectionObserver' in window && !reduceMotion) {
    const cio = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target;
        const target = Number(el.dataset.count);
        const start = performance.now();
        const dur = 1400;
        const step = (t) => {
          const k = Math.min(1, (t - start) / dur);
          const eased = 1 - Math.pow(1 - k, 4);
          el.textContent = String(Math.round(target * eased));
          if (k < 1) requestAnimationFrame(step);
        };
        el.textContent = '0';
        requestAnimationFrame(step);
        cio.unobserve(el);
      }
    }, { threshold: 0.6 });
    counters.forEach((c) => cio.observe(c));
  }

  /* ── Git Graph tabs ──────────────────────────────────────────────── */
  const tabs = $$('.graph [role="tab"]');
  const gImg = $('#graphImg');
  const gCap = $('#graphCap');
  const selectTab = (tab) => {
    if (tab.getAttribute('aria-selected') === 'true') return;
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    const src = `assets/screens/${tab.dataset.img}.png`;
    const swap = () => {
      gImg.src = src;
      gImg.alt = tab.dataset.cap;
      gCap.textContent = tab.dataset.cap;
      gImg.classList.remove('is-fading');
    };
    if (reduceMotion) { swap(); return; }
    const pre = new Image();
    pre.src = src;
    gImg.classList.add('is-fading');
    Promise.all([
      pre.decode ? pre.decode().catch(() => {}) : Promise.resolve(),
      new Promise((r) => setTimeout(r, 250)),
    ]).then(swap);
  };
  tabs.forEach((tab, i) => {
    tab.tabIndex = i === 0 ? 0 : -1;
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const next = tabs[(i + d + tabs.length) % tabs.length];
      next.focus();
      selectTab(next);
    });
  });
  // Warm the cache for the other graph images once the page is idle.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  idle(() => tabs.forEach((t) => { const i = new Image(); i.src = `assets/screens/${t.dataset.img}.png`; }));

  /* ── Keyboard platform toggle ────────────────────────────────────── */
  const osBtns = $$('[data-os]');
  const setOS = (os) => {
    osBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.os === os)));
    $$('.os-mod').forEach((k) => { k.textContent = os === 'mac' ? '⌘⇧G' : 'Ctrl+Shift+G'; });
  };
  osBtns.forEach((b) => b.addEventListener('click', () => setOS(b.dataset.os)));
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  if (!/mac|iphone|ipad/i.test(platform)) setOS('win');

  /* ── Copy install command ────────────────────────────────────────── */
  $$('[data-copy]').forEach((btn) => {
    const done = $('.cmd__done', btn);
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        done.textContent = 'Copied';
      } catch {
        done.textContent = 'Press ⌘C / Ctrl+C';
        const range = document.createRange();
        range.selectNodeContents($('.cmd__text', btn));
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(range);
      }
      btn.classList.add('is-copied');
      setTimeout(() => btn.classList.remove('is-copied'), 1600);
    });
  });

  /* ── Lightbox ────────────────────────────────────────────────────── */
  const box = $('#lightbox');
  if (box && typeof box.showModal === 'function') {
    const boxImg = $('img', box);
    $$('[data-zoom]').forEach((el) => {
      el.addEventListener('click', () => {
        const img = $('img', el);
        boxImg.src = img.currentSrc || img.src;
        boxImg.alt = img.alt;
        box.showModal();
      });
    });
    $('.lightbox__close', box).addEventListener('click', () => box.close());
    box.addEventListener('click', (e) => { if (e.target === box) box.close(); });
  }
})();
