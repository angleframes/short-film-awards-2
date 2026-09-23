        /* ===== MASSIVE SCROLL ANIMATION ENGINE ===== */
        // TextAnimate (blurInUp, by character, once) — css port of magicui TextAnimate
        function textAnimateBlurInUp(el) {
            if (!el || el.dataset.taDone) return;
            el.dataset.taDone = '1';
            let charIndex = 0;

            function wrapChars(node) {
                if (node.nodeType === Node.TEXT_NODE) {
                    const frag = document.createDocumentFragment();
                    node.textContent.split('').forEach(ch => {
                        const span = document.createElement('span');
                        span.className = 'ta-char';
                        span.textContent = ch;
                        span.style.transitionDelay = (charIndex * 0.03) + 's';
                        charIndex++;
                        frag.appendChild(span);
                    });
                    node.replaceWith(frag);
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    Array.from(node.childNodes).forEach(wrapChars);
                }
            }

            Array.from(el.childNodes).forEach(wrapChars);

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    el.querySelectorAll('.ta-char').forEach(s => s.classList.add('ta-in'));
                });
            });
        }

        function initScrollAnimations() {
            const allAnimated = document.querySelectorAll(
                '.scroll-reveal, .scroll-reveal-left, .scroll-reveal-right, .scroll-reveal-scale, .scroll-reveal-blur'
            );

            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('visible');
                    }
                });
            }, {
                threshold: 0.1,
                rootMargin: '0px 0px -60px 0px'
            });

            allAnimated.forEach(el => observer.observe(el));

            // Category cards enter using a rotating set of distinct animation styles —
            // random fly-in with 3D tilt, drop & bounce, spin-pop, and a 3D flip reveal —
            // so the row feels choreographed rather than one repeated effect.
            const categoryObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const cards = entry.target.querySelectorAll('.category-asset-card');
                        cards.forEach((card, i) => {
                            const style = i % 4;
                            const delay = i * 0.08;
                            const dir = i % 2 === 0 ? 1 : -1;
                            let fromTransform, toTransform, transitionRule;

                            if (style === 0) {
                                // Fly in from a random direction all around the screen with a 3D tumble
                                const angle = Math.random() * Math.PI * 2;
                                const distance = Math.min(window.innerWidth, 900) * (0.45 + Math.random() * 0.55);
                                const dx = Math.cos(angle) * distance;
                                const dy = Math.sin(angle) * distance * 0.7;
                                const rot = (Math.random() - 0.5) * 160;
                                const tiltX = (Math.random() - 0.5) * 60;
                                const tiltY = (Math.random() - 0.5) * 60;
                                fromTransform = `perspective(1000px) translate(${dx}px, ${dy}px) rotate(${rot}deg) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(0.3)`;
                                toTransform = `perspective(1000px) translate(0px, 0px) rotate(0deg) rotateX(0deg) rotateY(0deg) scale(1)`;
                                transitionRule = `opacity 0.75s cubic-bezier(0.22, 1, 0.36, 1) ${delay}s, transform 1.05s cubic-bezier(0.22, 1.45, 0.36, 1) ${delay}s, filter 0.75s ease ${delay}s`;
                            } else if (style === 1) {
                                // Drop from above and bounce into place
                                fromTransform = `translateY(-260px) scale(0.85)`;
                                toTransform = `translateY(0px) scale(1)`;
                                transitionRule = `opacity 0.5s ease ${delay}s, transform 0.9s cubic-bezier(0.34, 1.56, 0.64, 1) ${delay}s, filter 0.5s ease ${delay}s`;
                            } else if (style === 2) {
                                // Spin and pop into place
                                fromTransform = `rotate(${dir * 280}deg) scale(0.2)`;
                                toTransform = `rotate(0deg) scale(1)`;
                                transitionRule = `opacity 0.6s ease ${delay}s, transform 0.95s cubic-bezier(0.34, 1.56, 0.64, 1) ${delay}s, filter 0.6s ease ${delay}s`;
                            } else {
                                // 3D flip reveal, alternating left/right
                                fromTransform = `perspective(900px) rotateY(${dir * 110}deg) scale(0.92)`;
                                toTransform = `perspective(900px) rotateY(0deg) scale(1)`;
                                transitionRule = `opacity 0.5s ease ${delay}s, transform 0.85s cubic-bezier(0.22, 1, 0.36, 1) ${delay}s, filter 0.5s ease ${delay}s`;
                            }

                            card.style.willChange = 'transform, opacity, filter';
                            card.style.opacity = '0';
                            card.style.filter = 'blur(6px)';
                            card.style.transform = fromTransform;
                            card.style.transition = transitionRule;

                            requestAnimationFrame(() => {
                                requestAnimationFrame(() => {
                                    card.style.opacity = '1';
                                    card.style.filter = 'blur(0px)';
                                    card.style.transform = toTransform;
                                    setTimeout(() => {
                                        card.style.willChange = 'auto';
                                        card.style.transition = '';
                                        card.style.filter = '';
                                        card.style.transform = '';
                                        card.style.opacity = '';
                                    }, 1150 + i * 80);
                                });
                            });
                        });
                        categoryObserver.unobserve(entry.target);
                    }
                });
            }, { threshold: 0.1 });

            const grid = document.getElementById('categoriesGridContainer');
            if (grid) categoryObserver.observe(grid);
        }

        /* Active nav highlight on scroll */
        function initNavHighlight() {
            const sections = Array.from(document.querySelectorAll('section[id]'));
            const navLinks = Array.from(document.querySelectorAll('.navbar a[href^="#"]'));

            function setActive(id) {
                navLinks.forEach(link => {
                    link.classList.toggle('active', link.getAttribute('href') === '#' + id);
                });
            }

            // Highlight whichever section currently covers the most of the viewport.
            // Height-agnostic: works for normal and very tall scroll-stack sections.
            function onScroll() {
                const vh = window.innerHeight;
                let bestId = sections.length ? sections[0].id : null;
                let bestVisible = -1;
                for (const sec of sections) {
                    const r = sec.getBoundingClientRect();
                    const visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
                    if (visible > bestVisible) {
                        bestVisible = visible;
                        bestId = sec.id;
                    }
                }
                if (bestId) setActive(bestId);
            }

            let ticking = false;
            function onScrollThrottled() {
                if (!ticking) {
                    requestAnimationFrame(() => { onScroll(); ticking = false; });
                    ticking = true;
                }
            }
            window.addEventListener('scroll', onScrollThrottled, { passive: true });
            document.addEventListener('scroll', onScrollThrottled, { passive: true, capture: true });
            document.body.addEventListener('scroll', onScrollThrottled, { passive: true });
            onScroll();
        }

        // Sets a section's background image if a URL is provided in SITE_IMAGES; otherwise leaves the default.
        function applySectionBackground(sectionId, url) {
            const el = document.getElementById(sectionId);
            if (el && url && url.trim() !== '') {
                el.style.backgroundImage = `url('${url}')`;
            }
        }

        // Pull live settings/gallery/updates from Supabase (admin panel writes these).
        // On any failure, the hardcoded defaults above are kept.
        async function loadRemoteConfig() {
            try {
                if (!window.supabase) return;
                const SB = window.supabase.createClient(SUPA_URL, SUPA_ANON);
                const [cfgRes, galRes, updRes, tmtRes, vcRes, acRes] = await Promise.all([
                    SB.from('site_config').select('*').eq('id', 1).single(),
                    SB.from('gallery').select('*').order('sort_order').order('created_at', { ascending: false }),
                    SB.from('updates_feed').select('*').order('sort_order').order('created_at', { ascending: false }),
                    SB.from('testimonials').select('*').order('display_order').order('created_at'),
                    SB.from('video_categories').select('*').order('sort_order'),
                    SB.from('award_categories').select('*').eq('active', true).order('sort_order')
                ]);
                const cfg = cfgRes.data;
                if (cfg) {
                    REGISTRATION_GATE.isOpen = !!cfg.registration_open;
                    if (cfg.submission_deadline) PORTAL_TIMELINES.submissionDeadline = cfg.submission_deadline;
                    if (cfg.awards_event_date)   PORTAL_TIMELINES.awardsEventDate   = cfg.awards_event_date;
                    if (cfg.deadline_label)      PORTAL_TIMELINES.deadlineLabelText  = cfg.deadline_label;
                    if (cfg.event_label)         PORTAL_TIMELINES.eventLabelText     = cfg.event_label;
                }
                if (Array.isArray(galRes.data) && galRes.data.length) {
                    GALLERY_IMAGES.length = 0;
                    galRes.data.forEach(g => GALLERY_IMAGES.push({ category: g.category, src: g.src, title: g.title || '', sub: g.sub || '' }));
                }
                if (Array.isArray(updRes.data) && updRes.data.length) {
                    UPDATES_FEED.length = 0;
                    updRes.data.forEach(u => UPDATES_FEED.push({ date: u.date_label || '', title: u.title || '', text: u.body || '' }));
                }
                window._testimonialsData = Array.isArray(tmtRes.data) ? tmtRes.data : [];
                window._videoCategoriesData = Array.isArray(vcRes && vcRes.data) ? vcRes.data : [];
                if (Array.isArray(acRes.data) && acRes.data.length) {
                    CATEGORY_ITEMS = acRes.data.map(c => ({
                        title: c.name.replace(/^(Best)\s+/i, '$1<br>').replace(/^(Special)\s+/i, '$1<br>').replace(/^(Campus)\s+/i, '$1<br>'),
                        emoji: '',
                        image: 'assets/icons/' + c.key + '.png?v=7',
                        icon_svg: c.icon_svg || ''
                    }));
                    window._awardCategoriesData = acRes.data;
                }
            } catch (e) {
                console.warn('Remote config load failed — using built-in defaults.', e);
                window._testimonialsData = window._testimonialsData || [];
                window._videoCategoriesData = window._videoCategoriesData || [];
            }
        }

        document.addEventListener("DOMContentLoaded", async () => {
            setTimeout(() => document.body.classList.add('cfg-ready'), 5000); // failsafe: never stay hidden
            await loadRemoteConfig();
            document.getElementById('mainLogo').src = SITE_IMAGES.mainLogo;
            const imsLogo = document.getElementById('imsLogoImg');
            if (imsLogo) imsLogo.src = SITE_IMAGES.mainLogo;
            document.getElementById('socialIconInstagram').src = SITE_IMAGES.socialInstagram;
            document.getElementById('socialIconYoutube').src = SITE_IMAGES.socialYoutube;
            document.getElementById('socialIconFacebook').src = SITE_IMAGES.socialFacebook;

            document.getElementById('labelDeadlineDate').textContent = PORTAL_TIMELINES.deadlineLabelText;
            document.getElementById('labelEventDate').textContent = PORTAL_TIMELINES.eventLabelText;

            applySectionBackground('section-story', SITE_IMAGES.sectionBgStory);
            applySectionBackground('section-categories', SITE_IMAGES.sectionBgCategories);
            applySectionBackground('section-gallery', SITE_IMAGES.sectionBgGallery);
            applySectionBackground('section-registration', SITE_IMAGES.sectionBgRegistration);
            applySectionBackground('section-contact', SITE_IMAGES.sectionBgContact);

            evaluateRegistrationGateState();

            // Live sync: update registration gate instantly when admin changes it
            if (window.supabase) {
                try {
                    const SB_RT = window.supabase.createClient(SUPA_URL, SUPA_ANON);
                    let _rtDebounce = {};
                    function _rtDebounced(key, fn, delay) {
                        clearTimeout(_rtDebounce[key]);
                        _rtDebounce[key] = setTimeout(fn, delay || 500);
                    }
                    async function _rtRefreshVideos() {
                        try {
                            const [vRes, cRes] = await Promise.all([
                                SB_RT.from('testimonials').select('*').order('display_order').order('created_at'),
                                SB_RT.from('video_categories').select('*').order('sort_order')
                            ]);
                            if (vRes.data) window._testimonialsData = vRes.data;
                            if (cRes.data) window._videoCategoriesData = cRes.data;
                            _videosInitialized = false;
                            var sec = document.getElementById('section-videos');
                            if (sec) { sec.innerHTML = ''; }
                            var filtersEl = document.getElementById('vidFilters');
                            /* rebuild section from scratch */
                            _rebuildVideoSection();
                        } catch(e) { console.warn('Video realtime refresh error', e); }
                    }
                    SB_RT.channel('site_live')
                        .on('postgres_changes', {
                            event: 'UPDATE',
                            schema: 'public',
                            table: 'site_config',
                            filter: 'id=eq.1'
                        }, (payload) => {
                            if (payload.new && typeof payload.new.registration_open !== 'undefined') {
                                REGISTRATION_GATE.isOpen = !!payload.new.registration_open;
                                evaluateRegistrationGateState();
                            }
                        })
                        .on('postgres_changes', { event: '*', schema: 'public', table: 'testimonials' }, () => {
                            _rtDebounced('videos', _rtRefreshVideos, 600);
                        })
                        .on('postgres_changes', { event: '*', schema: 'public', table: 'video_categories' }, () => {
                            _rtDebounced('videos', _rtRefreshVideos, 600);
                        })
                        .on('postgres_changes', { event: '*', schema: 'public', table: 'award_categories' }, () => {
                            _rtDebounced('awardcats', async function() {
                                try {
                                    var acr = await SB_RT.from('award_categories').select('*').eq('active', true).order('sort_order');
                                    if (acr.data && acr.data.length) {
                                        CATEGORY_ITEMS = acr.data.map(function(c) {
                                            return {
                                                title: c.name.replace(/^(Best)\s+/i, '$1<br>').replace(/^(Special)\s+/i, '$1<br>').replace(/^(Campus)\s+/i, '$1<br>'),
                                                emoji: '', image: 'assets/icons/' + c.key + '.png?v=7', icon_svg: c.icon_svg || ''
                                            };
                                        });
                                        window._awardCategoriesData = acr.data;
                                        generateDynamicCategories();
                                        var grid = document.getElementById('allCategoriesGrid');
                                        if (grid) { grid.dataset.built = ''; grid.style.display = 'none'; }
                                    }
                                } catch(e) { console.warn('Award categories realtime refresh error', e); }
                            }, 600);
                        })
                        .subscribe();
                } catch (e) {
                    console.warn('Realtime subscription failed — gate will not auto-update.', e);
                }
            }

            initiateTimersEngine();
            generateDynamicCategories();
            renderAboutCards();
            renderGallery();
            initGalleryPicker();
            renderVideos();
            renderUpdatesFeed();
            renderGuidelines();
            renderJuryPanel();
            initScrollAnimations();
            textAnimateBlurInUp(document.getElementById('heroTitleAnimate'));
            // Init glow on all static .glow-card elements (dynamic ones call initCardGlow inline)
            document.querySelectorAll('.glow-card').forEach(initCardGlow);
            initNavHighlight();

            // Init custom UI components
            if (window.UI) {
                var catSel = document.getElementById('category');
                if (catSel) UI.CSelect(catSel, { placeholder: 'Select category…' });
            }

            // Trigger hero animations immediately
            document.querySelectorAll('#section-home .scroll-reveal').forEach(el => {
                setTimeout(() => el.classList.add('visible'), 100);
            });
        });

        function toggleMobileMenu() {
            const nav = document.getElementById('mainNavbar');
            if (nav) nav.classList.toggle('active');
        }

        function toggleMoreDropdown(event) {
            event.stopPropagation();
            const dropdown = document.getElementById('navMoreDropdown');
            if (dropdown) dropdown.classList.toggle('active');
        }

        function selectMoreItem(tabId) {
            const dropdown = document.getElementById('navMoreDropdown');
            if (dropdown) dropdown.classList.remove('active');
            const nav = document.getElementById('mainNavbar');
            if (nav) nav.classList.remove('active');
            openInfoModal(tabId);
        }

        document.addEventListener('click', (e) => {
            const wrapper = document.getElementById('navMoreWrapper');
            const dropdown = document.getElementById('navMoreDropdown');
            if (wrapper && dropdown && !wrapper.contains(e.target)) {
                dropdown.classList.remove('active');
            }
        });

        // ===== BORDER GLOW ENGINE (exact port from glow component) =====
        const GLOW_CONFIG = {
            glowColor: '220 80 70',         // blue-ish for film theme
            glowIntensity: 1.0,
            colors: ['#c084fc', '#38bdf8', '#f472b6'],
            edgeSensitivity: 30
        };

        function parseHSL(hslStr) {
            const match = hslStr.match(/([\d.]+)\s*([\d.]+)%?\s*([\d.]+)%?/);
            if (!match) return { h: 220, s: 80, l: 70 };
            return { h: parseFloat(match[1]), s: parseFloat(match[2]), l: parseFloat(match[3]) };
        }

        function applyGlowVars(el, glowColor, intensity) {
            const { h, s, l } = parseHSL(glowColor);
            const base = `${h}deg ${s}% ${l}%`;
            const opacities = [100, 60, 50, 40, 30, 20, 10];
            const keys = ['', '-60', '-50', '-40', '-30', '-20', '-10'];
            for (let i = 0; i < opacities.length; i++) {
                el.style.setProperty(`--glow-color${keys[i]}`, `hsl(${base} / ${Math.min(opacities[i] * intensity, 100)}%)`);
            }
        }

        const GRADIENT_POSITIONS = ['80% 55%', '69% 34%', '8% 6%', '41% 38%', '86% 85%', '82% 18%', '51% 4%'];
        const GRADIENT_KEYS = ['--gradient-one','--gradient-two','--gradient-three','--gradient-four','--gradient-five','--gradient-six','--gradient-seven'];
        const COLOR_MAP = [0, 1, 2, 0, 1, 2, 1];

        function applyGradientVars(el, colors) {
            for (let i = 0; i < 7; i++) {
                const c = colors[Math.min(COLOR_MAP[i], colors.length - 1)];
                el.style.setProperty(GRADIENT_KEYS[i], `radial-gradient(at ${GRADIENT_POSITIONS[i]}, ${c} 0px, transparent 50%)`);
            }
            el.style.setProperty('--gradient-base', `linear-gradient(${colors[0]} 0 100%)`);
        }

        function getEdgeProximity(el, x, y) {
            const rect = el.getBoundingClientRect();
            const cx = rect.width / 2, cy = rect.height / 2;
            const dx = x - cx, dy = y - cy;
            let kx = Infinity, ky = Infinity;
            if (dx !== 0) kx = cx / Math.abs(dx);
            if (dy !== 0) ky = cy / Math.abs(dy);
            return Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
        }

        function getCursorAngle(el, x, y) {
            const rect = el.getBoundingClientRect();
            const cx = rect.width / 2, cy = rect.height / 2;
            const dx = x - cx, dy = y - cy;
            if (dx === 0 && dy === 0) return 0;
            let degrees = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
            if (degrees < 0) degrees += 360;
            return degrees;
        }

        function glowAnimateValue({ start = 0, end = 100, duration = 1000, delay = 0, ease, onUpdate, onEnd }) {
            setTimeout(() => {
                const t0 = performance.now();
                (function tick() {
                    const elapsed = performance.now() - t0;
                    const t = Math.min(elapsed / duration, 1);
                    const progress = ease ? ease(t) : t;
                    onUpdate(start + (end - start) * progress);
                    if (t < 1) requestAnimationFrame(tick);
                    else if (onEnd) onEnd();
                })();
            }, delay);
        }

        const easeInCubic = x => x * x * x;
        const easeOutCubic = x => 1 - Math.pow(1 - x, 3);

        function initCardGlow(card) {
            applyGlowVars(card, GLOW_CONFIG.glowColor, GLOW_CONFIG.glowIntensity);
            applyGradientVars(card, GLOW_CONFIG.colors);

            card.addEventListener('pointermove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                card.style.setProperty('--edge-proximity', (getEdgeProximity(card, x, y) * 100).toFixed(3));
                card.style.setProperty('--cursor-angle', `${getCursorAngle(card, x, y).toFixed(3)}deg`);
            });

            // radar sweep entrance
            const angleStart = 110, angleEnd = 465;
            card.classList.add('sweep-active');
            card.style.setProperty('--cursor-angle', `${angleStart}deg`);

            glowAnimateValue({ duration: 500, ease: easeOutCubic, onUpdate: v => card.style.setProperty('--edge-proximity', v) });
            glowAnimateValue({ ease: easeInCubic, duration: 1500, end: 50, onUpdate: v => {
                card.style.setProperty('--cursor-angle', `${(angleEnd - angleStart) * (v / 100) + angleStart}deg`);
            }});
            glowAnimateValue({ ease: easeOutCubic, delay: 1500, duration: 2250, start: 50, end: 100, onUpdate: v => {
                card.style.setProperty('--cursor-angle', `${(angleEnd - angleStart) * (v / 100) + angleStart}deg`);
            }});
            glowAnimateValue({ ease: easeInCubic, delay: 2500, duration: 1500, start: 100, end: 0,
                onUpdate: v => card.style.setProperty('--edge-proximity', v),
                onEnd: () => card.classList.remove('sweep-active')
            });
        }
        // ===== END BORDER GLOW ENGINE =====

        // ===== SCROLL STACK ENGINE (exact math ported to window scroll) =====
        const STACK_CONFIG = {
            itemDistance: 100,
            itemScale: 0.03,
            itemStackDistance: 30,
            stackPosition: 0.18,   // fraction of viewport height
            scaleEndPosition: 0.08,
            baseScale: 0.85,
            rotationAmount: 1.5,
            blurAmount: 2
        };

        const stackRegistry = [];

        function initScrollStack(container) {
            const cards = Array.from(container.querySelectorAll('.scroll-stack-card'));
            const endEl = container.querySelector('.scroll-stack-end');
            if (!cards.length) return;

            cards.forEach((card, i) => {
                if (i < cards.length - 1) card.style.marginBottom = `${STACK_CONFIG.itemDistance}px`;
                card.style.transformOrigin = 'top center';
                card.style.willChange = 'transform, filter';
            });

            const inst = { container, cards, endEl, lastTransforms: new Map(), cardTops: [], endTop: 0 };
            measureStack(inst);
            stackRegistry.push(inst);
            updateStackInstance(inst);
        }

        // Static layout position relative to page top (NOT affected by transforms).
        function pageTop(el) {
            let top = 0;
            while (el) { top += el.offsetTop; el = el.offsetParent; }
            return top;
        }

        // Measure once (and on resize) with transforms cleared so positions are stable.
        function measureStack(inst) {
            const { cards, endEl } = inst;
            // temporarily clear transforms so offset math is pure layout
            const saved = cards.map(c => c.style.transform);
            cards.forEach(c => { c.style.transform = 'none'; });
            inst.cardTops = cards.map(c => pageTop(c));
            inst.endTop = endEl ? pageTop(endEl) : 0;
            cards.forEach((c, i) => { c.style.transform = saved[i] || ''; });
        }

        function stackProgress(scrollTop, start, end) {
            if (scrollTop < start) return 0;
            if (scrollTop > end) return 1;
            return (scrollTop - start) / (end - start);
        }

        function updateStackInstance(inst) {
            const { cards, lastTransforms, cardTops, endTop } = inst;
            const vh = window.innerHeight;
            const scrollTop = window.scrollY;

            const stackPositionPx = STACK_CONFIG.stackPosition * vh;
            const scaleEndPositionPx = STACK_CONFIG.scaleEndPosition * vh;
            const endElementTop = endTop;

            cards.forEach((card, i) => {
                const cardTop = cardTops[i];
                const triggerStart = cardTop - stackPositionPx - STACK_CONFIG.itemStackDistance * i;
                const triggerEnd = cardTop - scaleEndPositionPx;
                const pinStart = cardTop - stackPositionPx - STACK_CONFIG.itemStackDistance * i;
                const pinEnd = endElementTop - vh / 2;

                const scaleP = stackProgress(scrollTop, triggerStart, triggerEnd);
                const targetScale = STACK_CONFIG.baseScale + i * STACK_CONFIG.itemScale;
                const scale = 1 - scaleP * (1 - targetScale);
                const rotation = STACK_CONFIG.rotationAmount ? i * STACK_CONFIG.rotationAmount * scaleP : 0;

                let blur = 0;
                if (STACK_CONFIG.blurAmount) {
                    let topCardIndex = 0;
                    for (let j = 0; j < cards.length; j++) {
                        const jTriggerStart = cardTops[j] - stackPositionPx - STACK_CONFIG.itemStackDistance * j;
                        if (scrollTop >= jTriggerStart) topCardIndex = j;
                    }
                    if (i < topCardIndex) blur = Math.max(0, (topCardIndex - i) * STACK_CONFIG.blurAmount);
                }

                let translateY = 0;
                const isPinned = scrollTop >= pinStart && scrollTop <= pinEnd;
                if (isPinned) {
                    translateY = scrollTop - cardTop + stackPositionPx + STACK_CONFIG.itemStackDistance * i;
                } else if (scrollTop > pinEnd) {
                    translateY = pinEnd - cardTop + stackPositionPx + STACK_CONFIG.itemStackDistance * i;
                }

                const nt = {
                    translateY: Math.round(translateY * 100) / 100,
                    scale: Math.round(scale * 1000) / 1000,
                    rotation: Math.round(rotation * 100) / 100,
                    blur: Math.round(blur * 100) / 100
                };

                const lt = lastTransforms.get(i);
                const changed = !lt ||
                    Math.abs(lt.translateY - nt.translateY) > 0.1 ||
                    Math.abs(lt.scale - nt.scale) > 0.001 ||
                    Math.abs(lt.rotation - nt.rotation) > 0.1 ||
                    Math.abs(lt.blur - nt.blur) > 0.1;

                if (changed) {
                    card.style.transform = `translate3d(0, ${nt.translateY}px, 0) scale(${nt.scale}) rotate(${nt.rotation}deg)`;
                    card.style.filter = nt.blur > 0 ? `blur(${nt.blur}px)` : '';
                    lastTransforms.set(i, nt);
                }
            });
        }

        function updateAllStacks() {
            stackRegistry.forEach(updateStackInstance);
        }

        let stackTicking = false;
        window.addEventListener('scroll', () => {
            if (!stackTicking) {
                requestAnimationFrame(() => { updateAllStacks(); stackTicking = false; });
                stackTicking = true;
            }
        }, { passive: true });
        window.addEventListener('resize', () => {
            stackRegistry.forEach(measureStack);
            updateAllStacks();
        });
        // Re-measure once assets/images settle to catch layout shifts
        window.addEventListener('load', () => {
            stackRegistry.forEach(measureStack);
            updateAllStacks();
        });
        // ===== END SCROLL STACK ENGINE =====

        let categoryCarouselIndex = 0;
        let categoryCarouselTimer = null;

        function categoryCarouselRender() {
            const track = document.getElementById('categoryCarouselTrack');
            if (!track) return;
            const cards = Array.from(track.querySelectorAll('.category-carousel-card'));
            const total = cards.length;
            cards.forEach((card, index) => {
                let pos = (index - categoryCarouselIndex + total) % total;
                if (pos > Math.floor(total / 2)) pos -= total;

                const isCenter = pos === 0;
                const isAdjacent = Math.abs(pos) === 1;
                const isFar = Math.abs(pos) === 2;

                card.style.transform = `translateX(${pos * 42}%) scale(${isCenter ? 1 : isAdjacent ? 0.85 : isFar ? 0.68 : 0.55}) rotateY(${pos * -10}deg)`;
                card.style.zIndex = isCenter ? 10 : isAdjacent ? 5 : isFar ? 3 : 1;
                card.style.opacity = isCenter ? 1 : isAdjacent ? 0.55 : isFar ? 0.25 : 0;
                card.style.filter = isCenter ? 'blur(0px)' : isAdjacent ? 'blur(3px)' : 'blur(5px)';
                card.style.visibility = Math.abs(pos) > 2 ? 'hidden' : 'visible';
            });
        }

        function categoryCarouselNext() {
            const total = CATEGORY_ITEMS.length;
            categoryCarouselIndex = (categoryCarouselIndex + 1) % total;
            categoryCarouselRender();
            categoryCarouselRestartTimer();
        }

        function categoryCarouselPrev() {
            const total = CATEGORY_ITEMS.length;
            categoryCarouselIndex = (categoryCarouselIndex - 1 + total) % total;
            categoryCarouselRender();
            categoryCarouselRestartTimer();
        }

        function toggleAllCategoriesInline() {
            const grid = document.getElementById('allCategoriesGrid');
            const btn = document.getElementById('viewAllCategoriesBtn');
            if (!grid) return;
            if (!grid.dataset.built) {
                grid.innerHTML = CATEGORY_ITEMS.map((item, idx) => `
                    <div class="category-grid-item">
                        ${item.image ? `<div class="grid-item-img"><img src="${item.image}" alt="${item.title.replace('<br>',' ')}" loading="lazy"></div>` : item.icon_svg ? `<div class="grid-item-svg-icon">${item.icon_svg}</div>` : `<div class="grid-item-emoji">${item.emoji || ''}</div>`}
                        <h4 class="grid-item-title">${item.title.replace('<br>', ' ')}</h4>
                    </div>
                `).join('');
                grid.dataset.built = '1';
            }
            const isOpen = grid.style.display === 'flex';
            if (isOpen) {
                grid.style.display = 'none';
                btn.innerHTML = 'View All Categories <span>&rarr;</span>';
            } else {
                grid.style.display = 'flex';
                btn.innerHTML = 'Hide All Categories <span>&rarr;</span>';
                grid.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }

        function categoryCarouselRestartTimer() {
            if (categoryCarouselTimer) clearInterval(categoryCarouselTimer);
            categoryCarouselTimer = setInterval(categoryCarouselNext, 4000);
        }

        function generateDynamicCategories() {
            const track = document.getElementById('categoryCarouselTrack');
            if (!track) return;
            track.innerHTML = '';
            categoryCarouselIndex = Math.floor(CATEGORY_ITEMS.length / 2);

            CATEGORY_ITEMS.forEach((item, idx) => {
                const card = document.createElement('div');
                card.className = 'category-carousel-card glow-card';

                let iconMarkup = '';
                if (item.image && item.image.trim() !== '') {
                    iconMarkup = `<div class="stack-card-media"><img src="${item.image}" alt="${item.title.replace('<br>', ' ')}" loading="lazy"></div>`;
                } else if (item.icon_svg && item.icon_svg.trim() !== '') {
                    iconMarkup = `<div class="stack-card-svg-icon">${item.icon_svg}</div>`;
                } else if (item.emoji) {
                    iconMarkup = `<div class="stack-emoji">${item.emoji}</div>`;
                }

                card.innerHTML = `
                    <span class="edge-light"></span>
                    ${iconMarkup}
                    <h3 class="stack-card-title">${item.title}</h3>
                    <p class="stack-card-sub">Award Category</p>
                `;
                track.appendChild(card);
                initCardGlow(card);
            });

            categoryCarouselRender();
            categoryCarouselRestartTimer();

            // Mobile swipe support for category carousel
            const carouselWrapper = document.querySelector('.category-carousel-wrapper');
            if (carouselWrapper && !carouselWrapper._swipeInited) {
                carouselWrapper._swipeInited = true;
                let _cswX = 0, _cswY = 0;
                carouselWrapper.addEventListener('pointerdown', e => {
                    _cswX = e.clientX; _cswY = e.clientY;
                }, { passive: true });
                carouselWrapper.addEventListener('pointerup', e => {
                    const dx = e.clientX - _cswX;
                    const dy = e.clientY - _cswY;
                    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                        if (dx < 0) categoryCarouselNext();
                        else categoryCarouselPrev();
                    }
                }, { passive: true });
            }
        }

        // Single source of truth: manual toggle AND deadline both must allow entry.
        // Toggle OFF -> closed regardless. Toggle ON + deadline passed -> closed. Toggle ON + valid -> open.
        function computeGateOpen() {
            if (!REGISTRATION_GATE.isOpen) return false;
            const dl = PORTAL_TIMELINES.submissionDeadline ? new Date(PORTAL_TIMELINES.submissionDeadline).getTime() : null;
            if (dl && !isNaN(dl) && Date.now() > dl) return false;
            return true;
        }

        // Snapshot the original wizard markup once, so we can restore it if reopened without a reload.
        let _originalRegCardHTML = null;

        function evaluateRegistrationGateState() {
            const browserTitleEl = document.getElementById('browserTabTitle');
            const navRegLink = document.getElementById('navRegistration');
            const heroSubmitBtn = document.getElementById('heroSubmitBtn');
            const formContainer = document.getElementById('registrationCardContent');

            if (formContainer && _originalRegCardHTML === null) {
                _originalRegCardHTML = formContainer.innerHTML; // capture the real wizard once
            }

            const open = computeGateOpen();

            if (open) {
                if (browserTitleEl) browserTitleEl.textContent = "Sharankrishna Short Film Awards 2026";
                if (navRegLink) navRegLink.textContent = "Registration";
                if (heroSubmitBtn) {
                    heroSubmitBtn.textContent = "Submit Your Film →";
                    heroSubmitBtn.style.background = "";
                    heroSubmitBtn.style.color = "";
                    heroSubmitBtn.style.border = "";
                    heroSubmitBtn.style.boxShadow = "";
                    heroSubmitBtn.style.pointerEvents = "";
                }
                // Restore the wizard if a previous closed-render had replaced it.
                if (formContainer && _originalRegCardHTML !== null && document.getElementById('submissionForm') === null) {
                    formContainer.innerHTML = _originalRegCardHTML;
                }
            } else {
                if (browserTitleEl) browserTitleEl.textContent = "Entries Closed | Sharankrishna Short Film Awards";
                if (navRegLink) navRegLink.textContent = "Entries Closed";
                if (heroSubmitBtn) {
                    heroSubmitBtn.textContent = "Registrations Closed";
                    heroSubmitBtn.style.background = "rgba(255,255,255,0.05)";
                    heroSubmitBtn.style.color = "rgba(255,255,255,0.4)";
                    heroSubmitBtn.style.border = "1px solid rgba(255,255,255,0.08)";
                    heroSubmitBtn.style.boxShadow = "none";
                    heroSubmitBtn.style.pointerEvents = "none";
                }
                if (formContainer) {
                    formContainer.innerHTML = `
                        <div class="closed-state-card">
                            <div class="closed-state-icon">🔒</div>
                            <h2 class="portal-main-heading" style="margin-bottom:12px;">Registrations Closed</h2>
                            <p style="color:rgba(255,255,255,0.7); font-size:0.95rem; line-height:1.6;">
                                The intake window for short film entries has reached its expiration cutoff ceiling. Thank you to everyone who submitted their vision.
                            </p>
                        </div>
                    `;
                }
            }
            document.body.classList.add('cfg-ready'); // reveal (kills the load flash)
        }

        function initiateTimersEngine() {
            function updateClocks() {
                const now = new Date().getTime();
                const distanceDeadline = new Date(PORTAL_TIMELINES.submissionDeadline).getTime() - now;
                const distanceEvent = new Date(PORTAL_TIMELINES.awardsEventDate).getTime() - now;

                if (distanceDeadline > 0) {
                    document.getElementById("d-days").textContent = String(Math.floor(distanceDeadline / (1000 * 60 * 60 * 24))).padStart(2, '0');
                    document.getElementById("d-hours").textContent = String(Math.floor((distanceDeadline % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))).padStart(2, '0');
                    document.getElementById("d-mins").textContent = String(Math.floor((distanceDeadline % (1000 * 60 * 60)) / (1000 * 60))).padStart(2, '0');
                    document.getElementById("d-secs").textContent = String(Math.floor((distanceDeadline % (1000 * 60)) / 1000)).padStart(2, '0');
                } else {
                    document.getElementById("deadlineCountdown").innerHTML = `<span style="font-size:0.85rem; color:#ff453a; font-weight:600; letter-spacing:0.5px;">SUBMISSIONS CLOSED</span>`;
                }

                if (distanceEvent > 0) {
                    document.getElementById("e-days").textContent = String(Math.floor(distanceEvent / (1000 * 60 * 60 * 24))).padStart(2, '0');
                    document.getElementById("e-hours").textContent = String(Math.floor((distanceEvent % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))).padStart(2, '0');
                    document.getElementById("e-mins").textContent = String(Math.floor((distanceEvent % (1000 * 60 * 60)) / (1000 * 60))).padStart(2, '0');
                    document.getElementById("e-secs").textContent = String(Math.floor((distanceEvent % (1000 * 60)) / 1000)).padStart(2, '0');
                } else {
                    document.getElementById("eventCountdown").innerHTML = `<span style="font-size:0.85rem; color:#30d158; font-weight:600; letter-spacing:0.5px;">EVENT LIVE / COMPLETED</span>`;
                }
            }
            updateClocks();
            setInterval(updateClocks, 1000);
        }

        function renderAboutCards() {
            const container = document.getElementById('aboutCardsContainer');
            if (!container || !ABOUT_CARDS || !ABOUT_CARDS.length) return;
            container.innerHTML = '';
            ABOUT_CARDS.forEach((card, idx) => {
                const num = String(idx + 1).padStart(2, '0');
                const isReverse = idx % 2 !== 0;
                const isLogo = card.image && card.image.match(/\.(png|svg)$/i) && idx === ABOUT_CARDS.length - 1;
                const imgStyle = isLogo ? 'style="object-fit:contain;padding:40px;background:#0a0a0a;"' : '';
                const el = document.createElement('div');
                el.className = 'story-block scroll-reveal delay-1' + (isReverse ? ' reverse' : '');
                el.innerHTML = `
                    <span class="story-block-num">${num}</span>
                    <div class="story-block-text">
                        <span class="story-block-eyebrow">${card.eyebrow}</span>
                        <h3>${card.heading}</h3>
                        <span class="story-underline"></span>
                        <p>${card.text}</p>
                    </div>
                    <div class="story-block-img">
                        <img src="${card.image}" alt="${card.heading}" ${imgStyle} onerror="this.parentElement.classList.add('no-img');this.style.display='none';">
                    </div>`;
                container.appendChild(el);
            });
        }

        // Gallery state
        let _galleryPhotos = [];
        let _galleryCurrentIdx = 0;
        let _galleryPendingIdx = -1;
        const _imageCache = new Map(); // src → {img, decoded}

        function _galleryPreloadSrc(src) {
            if (!src || _imageCache.has(src)) return _imageCache.get(src);
            const entry = { img: new Image(), decoded: false };
            _imageCache.set(src, entry);
            entry.img.src = src;
            if (entry.img.decode) {
                entry.img.decode().then(() => { entry.decoded = true; }).catch(() => { entry.decoded = true; });
            } else {
                entry.decoded = true;
            }
            return entry;
        }

        function _gallerySelectIdx(idx, wrap, strip, stage) {
            if (idx < 0 || idx >= _galleryPhotos.length) return;
            _galleryCurrentIdx = idx;
            _galleryPendingIdx = idx;
            const pid = `photo${idx + 1}`;

            // Update thumbnail active state immediately
            strip.querySelectorAll('li').forEach((li, i) => {
                const selected = i === idx;
                li.style.borderColor = selected ? 'rgba(255,255,255,0.9)' : '';
                li.style.boxShadow = selected ? '0 0 18px rgba(192,132,252,0.55)' : '';
                const img = li.querySelector('img');
                if (img) img.style.filter = selected ? 'grayscale(0)' : '';
            });

            // Crossfade: fade out old figs
            const figs = stage.querySelectorAll('.gs-fig');
            const newFig = stage.querySelector(`.gs-fig[data-id="${pid}"]`);
            figs.forEach(f => {
                if (f !== newFig) {
                    f.style.opacity = '0';
                    setTimeout(() => { if (f !== newFig) f.style.display = 'none'; }, 160);
                }
            });

            if (newFig) {
                const src = _galleryPhotos[idx] && _galleryPhotos[idx].src;
                const entry = src ? _imageCache.get(src) : null;
                const capturedIdx = idx;

                const show = () => {
                    if (_galleryPendingIdx !== capturedIdx) return; // stale — newer click won
                    newFig.style.display = 'block';
                    requestAnimationFrame(() => { newFig.style.opacity = '1'; });
                };

                if (entry && entry.decoded) {
                    show();
                } else if (entry && entry.img) {
                    // Image loading but not yet decoded — wait for decode
                    const onReady = () => {
                        if (_galleryPendingIdx !== capturedIdx) return;
                        show();
                    };
                    if (entry.img.decode) {
                        entry.img.decode().then(onReady).catch(onReady);
                    } else {
                        entry.img.addEventListener('load', onReady, { once: true });
                        entry.img.addEventListener('error', onReady, { once: true });
                    }
                } else {
                    // Fallback: image not preloaded — show immediately from DOM img
                    const mainImg = newFig.querySelector('img:not(.gs-backdrop)');
                    if (mainImg && mainImg.complete) {
                        show();
                    } else if (mainImg) {
                        mainImg.addEventListener('load', show, { once: true });
                        mainImg.addEventListener('error', show, { once: true });
                    } else {
                        show();
                    }
                }
            }

            // Scroll ONLY the thumbnail strip (never the document) to center the active thumb
            const activeLi = strip.querySelectorAll('li')[idx];
            if (activeLi) {
                const targetLeft = activeLi.offsetLeft - (strip.offsetWidth - activeLi.offsetWidth) / 2;
                strip.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
            }

            // Preload adjacent images
            [idx - 1, idx + 1, idx + 2].forEach(i => {
                if (i >= 0 && i < _galleryPhotos.length) {
                    const s = _galleryPhotos[i] && _galleryPhotos[i].src;
                    if (s) _galleryPreloadSrc(s);
                }
            });
        }

        let _galleryInitialized = false;

        function renderGallery() {
            if (_galleryInitialized) return; // run once — DOM stays alive on scroll away/back

            const wrap = document.getElementById('section-gallery');
            const strip = document.getElementById('galleryStrip');
            const stage = document.getElementById('galleryStage');
            if (!wrap || !strip || !stage) return;

            // Filter to only photos that have a src
            _galleryPhotos = GALLERY_IMAGES.filter(p => p.src && p.src.trim() !== '');
            if (!_galleryPhotos.length) return;

            _galleryInitialized = true;
            strip.innerHTML = '';
            stage.innerHTML = '';

            // Build strip thumbnails + stage figures
            _galleryPhotos.forEach((photo, idx) => {
                const pid = `photo${idx + 1}`;
                const shortTitle = photo.title.replace(/[:'"].*/, '').trim();
                const isFirst = idx === 0;

                // Thumbnail strip item — use small thumb asset to avoid loading full display image
                const thumbSrc = photo.thumb || photo.src;
                const li = document.createElement('li');
                li.innerHTML = `<label data-photo="${pid}"><img src="${thumbSrc}" alt="${photo.title}" loading="${isFirst ? 'eager' : 'lazy'}" decoding="async" width="130" height="87"><span>${shortTitle}</span></label>`;
                strip.appendChild(li);

                // Stage figure
                const fig = document.createElement('figure');
                fig.className = 'gs-fig';
                fig.dataset.id = pid;
                fig.style.display = isFirst ? 'block' : 'none';
                fig.style.opacity = isFirst ? '1' : '0';
                const fetchPriority = isFirst ? ' fetchpriority="high"' : '';
                fig.innerHTML = `<img class="gs-backdrop" src="${photo.src}" alt="" aria-hidden="true" loading="${isFirst ? 'eager' : 'lazy'}" decoding="async"${fetchPriority}><img src="${photo.src}" alt="${photo.title}" loading="${isFirst ? 'eager' : 'lazy'}" decoding="async"${fetchPriority}><figcaption><h3>${photo.title}</h3><p>${photo.sub}</p></figcaption>`;
                stage.appendChild(fig);
            });

            // Set first thumbnail active
            const firstLi = strip.querySelector('li');
            if (firstLi) {
                firstLi.style.borderColor = 'rgba(255,255,255,0.9)';
                firstLi.style.boxShadow = '0 0 18px rgba(192,132,252,0.55)';
                const firstImg = firstLi.querySelector('img');
                if (firstImg) firstImg.style.filter = 'grayscale(0)';
            }
            _galleryCurrentIdx = 0;

            // Wire thumbnail clicks
            strip.querySelectorAll('li label[data-photo]').forEach((label, idx) => {
                label.addEventListener('click', e => {
                    e.preventDefault();
                    _gallerySelectIdx(idx, wrap, strip, stage);
                });
            });

            // Mobile swipe on main gallery image
            let _swipeStartX = 0, _swipeStartY = 0;
            stage.addEventListener('pointerdown', e => {
                _swipeStartX = e.clientX;
                _swipeStartY = e.clientY;
            }, { passive: true });
            stage.addEventListener('pointerup', e => {
                const dx = e.clientX - _swipeStartX;
                const dy = e.clientY - _swipeStartY;
                if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                    if (dx < 0) _gallerySelectIdx(_galleryCurrentIdx + 1, wrap, strip, stage);
                    else _gallerySelectIdx(_galleryCurrentIdx - 1, wrap, strip, stage);
                }
            }, { passive: true });

            // Preload first display image immediately
            if (_galleryPhotos[0] && _galleryPhotos[0].src) _galleryPreloadSrc(_galleryPhotos[0].src);

            // Preload all display + thumb images after 500ms so first paint isn't blocked
            setTimeout(() => {
                _galleryPhotos.forEach(photo => {
                    if (photo.src) _galleryPreloadSrc(photo.src);
                    if (photo.thumb) _galleryPreloadSrc(photo.thumb);
                });
            }, 500);
        }

        function initGalleryPicker() { /* renderGallery() handles all wiring */ }

        function toggleRulesModal(show) {
            const modal = document.getElementById('rulesModal');
            if (show) modal.classList.add('active');
            else modal.classList.remove('active');
        }

        // Tabbed info modal (How To Submit / Guidelines / Updates / Jury / Privacy)
        function openInfoModal(tabId) {
            const modal = document.getElementById('infoModal');
            if (!modal) return;
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
            switchInfoTab(tabId || 'submit');
        }

        function closeInfoModal() {
            const modal = document.getElementById('infoModal');
            if (modal) modal.classList.remove('active');
            document.body.style.overflow = '';
        }

        // Escape key closes info modal
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                const infoModal = document.getElementById('infoModal');
                if (infoModal && infoModal.classList.contains('active')) { closeInfoModal(); return; }
                const rulesModal = document.getElementById('rulesModal');
                if (rulesModal && rulesModal.classList.contains('active')) { toggleRulesModal(false); }
            }
        });

        const INFO_TAB_META = {
            submit:     { title: 'How To Submit',           eyebrow: 'Getting Started',             desc: 'Follow these five simple steps to register your film for Sharankrishna Short Film Awards.' },
            guidelines: { title: 'Festival Guidelines',     eyebrow: 'Submission Rules',             desc: 'Read the official guidelines carefully before submitting your film entry.' },
            updates:    { title: 'Festival Updates',        eyebrow: 'Latest News & Announcements', desc: 'Stay informed with the latest announcements, deadlines and important information about Sharankrishna Short Film Awards.' },
            jury:       { title: 'Jury Panel',              eyebrow: 'Meet the Jury',               desc: 'Our distinguished jury panel evaluates each submission with care and expertise.' },
            privacy:    { title: 'Privacy Policy',          eyebrow: 'Data & Privacy',              desc: 'How we collect, use and protect your personal information.' },
            terms:      { title: 'Terms & Conditions',      eyebrow: 'Legal',                       desc: 'The terms governing your participation in the festival.' },
            refunds:    { title: 'Refunds & Cancellations', eyebrow: 'Refund Policy',               desc: 'Understand our refund policy and the circumstances under which refunds may apply.' },
        };

        function switchInfoTab(tabId) {
            Object.keys(INFO_TAB_META).forEach(key => {
                const pane = document.getElementById(`infoTabPane-${key}`);
                const btn  = document.getElementById(`infoTabBtn-${key}`);
                if (pane) pane.classList.toggle('active', key === tabId);
                if (btn)  btn.classList.toggle('active', key === tabId);
            });
            const meta = INFO_TAB_META[tabId] || {};
            const titleEl  = document.getElementById('infoModalTitle');
            const eyebrowEl= document.getElementById('imsEyebrow');
            const descEl   = document.getElementById('imsDesc');
            if (titleEl)   titleEl.textContent  = meta.title   || '';
            if (eyebrowEl) eyebrowEl.textContent = meta.eyebrow || '';
            if (descEl)    descEl.textContent    = meta.desc    || '';
        }

        /* ===== VIDEOS & MEDIA UPDATES ===== */
        let _videosInitialized = false;
        let _vidActiveFilter = 'all';
        let _vidShowAll = false;

        function _vidEsc(s) {
            return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        }

        function _vidThumbSrc(videoId) {
            return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
        }

        function _vidThumbFallback(img) {
            const id = img.dataset.ytid;
            if (!id) return;
            if (img.dataset.fallback === '1') { img.src = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`; img.dataset.fallback='done'; return; }
            if (img.dataset.fallback !== 'done') { img.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`; img.dataset.fallback='1'; }
        }

        function _playYouTube(videoId) {
            const backdrop = document.getElementById('ytModalBackdrop');
            const frame    = document.getElementById('ytModalFrame');
            if (!backdrop || !frame) return;
            frame.innerHTML = `<iframe src="https://www.youtube.com/embed/${_vidEsc(videoId)}?autoplay=1&rel=0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
            backdrop.classList.add('open');
            backdrop.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
        }

        function _closeYtModal() {
            const backdrop = document.getElementById('ytModalBackdrop');
            const frame    = document.getElementById('ytModalFrame');
            if (!backdrop) return;
            if (frame) frame.innerHTML = '';
            backdrop.classList.remove('open');
            backdrop.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
        }

        function _setupYtModal() {
            const backdrop = document.getElementById('ytModalBackdrop');
            const closeBtn = document.getElementById('ytModalClose');
            if (!backdrop) return;
            closeBtn && closeBtn.addEventListener('click', _closeYtModal);
            backdrop.addEventListener('click', e => { if (e.target === backdrop) _closeYtModal(); });
            document.addEventListener('keydown', e => { if (e.key === 'Escape') _closeYtModal(); });
        }

        const _PLAY_SVG = `<svg viewBox="0 0 24 24" fill="white"><polygon points="6,4 20,12 6,20"/></svg>`;

        function _vidGetCategoryName(catId) {
            const cats = window._videoCategoriesData || [];
            const cat = cats.find(c => c.id === catId);
            return cat ? cat.name : '';
        }

        function _vidBuildCard(v, isFeatured) {
            const vid = _vidEsc(v.youtube_video_id);
            const catName = v.category_id ? _vidGetCategoryName(v.category_id) : (v.role || '');
            const year = v.year || '';
            const desc = v.short_text || '';
            const dur  = v.duration || '';
            return `<div class="vid-card${isFeatured ? ' featured' : ''}" data-ytid="${vid}" data-catid="${v.category_id || ''}" role="button" tabindex="0" aria-label="Play: ${_vidEsc(v.video_title)}">
                <div class="vid-card-thumb">
                    <img src="${_vidThumbSrc(vid)}" alt="${_vidEsc(v.video_title)}" loading="${isFeatured ? 'eager' : 'lazy'}" decoding="async" data-ytid="${vid}" onerror="_vidThumbFallback(this)">
                    <div class="vid-card-overlay">
                        <div class="vid-play-icon">${_PLAY_SVG}</div>
                    </div>
                    ${dur ? `<span class="vid-duration">${_vidEsc(dur)}</span>` : ''}
                    ${isFeatured ? '<span class="vid-featured-badge">FEATURED VIDEO</span>' : ''}
                </div>
                <div class="vid-card-body">
                    <div class="vid-card-title">${_vidEsc(v.video_title)}</div>
                    ${desc ? `<div class="vid-card-desc">${_vidEsc(desc)}</div>` : ''}
                    <div class="vid-card-meta">
                        ${catName ? `<span>${_vidEsc(catName).toUpperCase()}</span>` : ''}
                        ${catName && year ? '<span class="vid-meta-sep">|</span>' : ''}
                        ${year ? `<span>${_vidEsc(year)}</span>` : ''}
                    </div>
                </div>
            </div>`;
        }

        function _vidBindCards(container) {
            container.querySelectorAll('.vid-card').forEach(card => {
                const play = () => _playYouTube(card.dataset.ytid);
                card.addEventListener('click', play);
                card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); } });
            });
        }

        function _vidFilteredData() {
            const data = (window._testimonialsData || []).filter(v => v.active !== false);
            if (_vidActiveFilter === 'all') return data;
            return data.filter(v => String(v.category_id) === String(_vidActiveFilter));
        }

        function _vidRenderCards() {
            const filtered = _vidFilteredData();
            const track    = document.getElementById('vidTrack');
            const allGrid  = document.getElementById('vidAllGrid');
            const carousel = document.querySelector('.vid-carousel-wrap');

            if (_vidShowAll) {
                if (carousel) carousel.style.display = 'none';
                if (allGrid) {
                    allGrid.style.display = '';
                    const featured = filtered.find(v => v.featured);
                    const rest = filtered.filter(v => v !== featured);
                    const sorted = featured ? [featured, ...rest] : filtered;
                    allGrid.innerHTML = sorted.map((v, i) => _vidBuildCard(v, i === 0 && v.featured)).join('');
                    _vidBindCards(allGrid);
                }
            } else {
                if (allGrid) allGrid.style.display = 'none';
                if (carousel) carousel.style.display = '';
                if (track) {
                    const featured = filtered.find(v => v.featured);
                    const rest = filtered.filter(v => v !== featured);
                    const sorted = featured ? [featured, ...rest] : filtered;
                    track.innerHTML = sorted.map((v, i) => _vidBuildCard(v, i === 0 && v.featured)).join('');
                    _vidBindCards(track);
                }
            }

            const viewAllBtn = document.getElementById('vidViewAll');
            if (viewAllBtn) {
                viewAllBtn.innerHTML = _vidShowAll
                    ? `${_PLAY_SVG} SHOW LESS <span class="vid-cta-arrow">&uarr;</span>`
                    : `${_PLAY_SVG} VIEW ALL VIDEOS <span class="vid-cta-arrow">&rarr;</span>`;
            }
        }

        function renderVideos() {
            if (_videosInitialized) return;
            _videosInitialized = true;
            _setupYtModal();

            const data = (window._testimonialsData || []).filter(v => v.active !== false);
            const section = document.getElementById('section-videos');
            if (!section) return;

            if (!data.length) { section.style.display = 'none'; return; }
            section.style.display = '';

            const navLink = document.getElementById('navVideos');
            if (navLink) navLink.style.display = '';
            const moreLink = document.getElementById('navMoreVideos');
            if (moreLink) moreLink.style.display = '';

            /* Category filter tabs */
            const filtersEl = document.getElementById('vidFilters');
            if (filtersEl) {
                const cats = (window._videoCategoriesData || []).filter(c => c.active !== false);
                let html = `<button class="vid-filter-btn active" data-catid="all"><span class="vid-filter-icon">&#9654;</span> All Videos</button>`;
                cats.forEach(c => {
                    html += `<button class="vid-filter-btn" data-catid="${c.id}"><span class="vid-filter-icon">${_vidEsc(c.icon || '')}</span> ${_vidEsc(c.name)}</button>`;
                });
                filtersEl.innerHTML = html;

                filtersEl.addEventListener('click', e => {
                    const btn = e.target.closest('.vid-filter-btn');
                    if (!btn) return;
                    filtersEl.querySelectorAll('.vid-filter-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    _vidActiveFilter = btn.dataset.catid;
                    _vidRenderCards();
                });
            }

            /* Render cards */
            _vidRenderCards();

            /* Carousel arrows */
            const vp   = document.getElementById('vidCarousel');
            const prev = document.getElementById('vidPrev');
            const next = document.getElementById('vidNext');
            const SCROLL_AMT = 300;
            prev && prev.addEventListener('click', () => vp.scrollBy({ left: -SCROLL_AMT, behavior: 'smooth' }));
            next && next.addEventListener('click', () => vp.scrollBy({ left:  SCROLL_AMT, behavior: 'smooth' }));

            /* VIEW ALL toggle */
            const viewAllBtn = document.getElementById('vidViewAll');
            if (viewAllBtn) {
                viewAllBtn.addEventListener('click', () => {
                    _vidShowAll = !_vidShowAll;
                    _vidRenderCards();
                    if (!_vidShowAll) {
                        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                });
            }
        }

        function _rebuildVideoSection() {
            _videosInitialized = false;
            _vidShowAll = false;
            const section = document.getElementById('section-videos');
            if (!section) return;
            const data = (window._testimonialsData || []).filter(v => v.active !== false);
            if (!data.length) { section.style.display = 'none'; return; }
            section.style.display = '';
            const filtersEl = document.getElementById('vidFilters');
            if (filtersEl) {
                const cats = (window._videoCategoriesData || []).filter(c => c.active !== false);
                let html = `<button class="vid-filter-btn${_vidActiveFilter==='all'?' active':''}" data-catid="all"><span class="vid-filter-icon">&#9654;</span> All Videos</button>`;
                cats.forEach(c => {
                    html += `<button class="vid-filter-btn${String(c.id)===String(_vidActiveFilter)?' active':''}" data-catid="${c.id}"><span class="vid-filter-icon">${_vidEsc(c.icon||'')}</span> ${_vidEsc(c.name)}</button>`;
                });
                filtersEl.innerHTML = html;
                filtersEl.querySelectorAll('.vid-filter-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        filtersEl.querySelectorAll('.vid-filter-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        _vidActiveFilter = btn.dataset.catid;
                        _vidRenderCards();
                    });
                });
            }
            _vidRenderCards();
        }

        function renderUpdatesFeed() {
            const container = document.getElementById('updatesListContainer');
            if (!container) return;
            if (!UPDATES_FEED || !UPDATES_FEED.length) {
                container.innerHTML = `<div class="upd-empty"><span class="upd-empty-icon">📰</span><h3>No festival updates yet.</h3><p>New announcements will appear here soon.</p></div>`;
                return;
            }
            container.innerHTML = '';
            const list = document.createElement('div');
            list.className = 'upd-list';
            UPDATES_FEED.forEach(update => {
                // Parse date label → structured date block
                const dateStr = (update.date || '').trim();
                let dateHtml = '';
                const parsed = new Date(dateStr);
                if (dateStr && !isNaN(parsed) && /\d{4}/.test(dateStr)) {
                    const mon = parsed.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase();
                    const day = parsed.getDate();
                    const yr  = parsed.getFullYear();
                    dateHtml = `<span class="upd-month">${mon}</span><span class="upd-day">${day}</span><span class="upd-year">${yr}</span>`;
                } else if (dateStr) {
                    // Free-text label like "Coming Soon"
                    dateHtml = `<span class="upd-date-plain">${dateStr.replace(/(.{6})/g,'$1<br>').trimEnd()}</span>`;
                } else {
                    dateHtml = `<span class="upd-date-plain">—</span>`;
                }

                // Infer badge
                const combined = ((update.title || '') + ' ' + (update.text || '')).toLowerCase();
                let badgeClass = 'upd-badge-info', badgeLabel = 'INFO';
                if (/important|urgent|deadline|last.?day/.test(combined)) { badgeClass = 'upd-badge-important'; badgeLabel = 'IMPORTANT'; }
                else if (/open|new|launch|announcing|coming|release|reveal|first/.test(combined)) { badgeClass = 'upd-badge-new'; badgeLabel = 'NEW'; }

                const card = document.createElement('div');
                card.className = 'upd-card';
                card.innerHTML = `
                    <div class="upd-date-block">${dateHtml}</div>
                    <div class="upd-body">
                        <div class="upd-top">
                            <span class="upd-badge ${badgeClass}">${badgeLabel}</span>
                            <span class="upd-title-text">${update.title || ''}</span>
                        </div>
                        <div class="upd-body-text">${update.text || ''}</div>
                    </div>
                    <div class="upd-arrow">›</div>
                `;
                list.appendChild(card);
            });
            container.appendChild(list);
        }

        function renderGuidelines() {
            const container = document.getElementById('guidelinesListContainer');
            if (!container) return;
            container.innerHTML = '';
            GUIDELINES_ITEMS.forEach((item, index) => {
                const box = document.createElement('div');
                box.className = 'rule-item-box glow-card';
                box.innerHTML = `
                    <span class="edge-light"></span>
                    <h4>${index + 1}. ${item.title}</h4>
                    <p>${item.text}</p>
                `;
                container.appendChild(box);
                initCardGlow(box);
            });
        }

        function renderJuryPanel() {
            const grid = document.getElementById('juryPanelGrid');
            if (!grid) return;
            grid.innerHTML = '';
            JURY_PANEL.forEach(member => {
                const card = document.createElement('div');
                card.className = 'jury-card glow-card';
                let avatarElement = `<div class="jury-avatar-placeholder">🎭</div>`;
                if (member.src && member.src.trim() !== '') {
                    avatarElement = `<img src="${member.src}" alt="${member.name}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;margin:0 auto 12px auto;display:block;">`;
                }
                card.innerHTML = `
                    <span class="edge-light"></span>
                    ${avatarElement}
                    <h4>${member.name}</h4>
                    <p>${member.role}</p>
                `;
                grid.appendChild(card);
                initCardGlow(card);
            });
        }

        function goToWizardStep(stepNumber) {
            if (!REGISTRATION_GATE.isOpen) return;
            if (stepNumber > currentWizardStep && !validateStepInputs(currentWizardStep)) return;

            document.querySelectorAll('.wizard-step-panel').forEach(panel => panel.classList.remove('active'));
            document.querySelectorAll('.pipeline-node').forEach(node => node.classList.remove('active', 'completed'));

            currentWizardStep = stepNumber;
            document.getElementById('wizardStep' + stepNumber).classList.add('active');

            const progressPercent = ((stepNumber - 1) / 4) * 100;
            document.getElementById('pipelineProgressLine').style.width = progressPercent + '%';

            for (let i = 1; i <= 5; i++) {
                const node = document.getElementById('node' + i);
                if (i < stepNumber) node.classList.add('completed');
                if (i === stepNumber) node.classList.add('active');
            }

            if (stepNumber === 4) generateReviewSummary();
        }

        function validateStepInputs(step) {
            const currentPanel = document.getElementById('wizardStep' + step);
            const inputs = currentPanel.querySelectorAll('input, select');
            let flag = true;

            inputs.forEach(input => {
                if (input.id !== 'childArtist' && (input.hasAttribute('placeholder') || input.tagName === 'SELECT')) {
                    if (!input.value.trim()) {
                        input.setAttribute('required', 'true');
                        if (!input.checkValidity()) {
                            flag = false;
                            input.reportValidity();
                        }
                    }
                }
            });
            return flag;
        }

        function escapeHtml(value) {
            return String(value == null ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function generateReviewSummary() {
            const matrix = document.getElementById('reviewSummaryMatrix');
            matrix.innerHTML = '';

            const fieldsToReview = [
                { label: "Applicant Name", id: "applicantName" },
                { label: "Email Address", id: "email" },
                { label: "Phone Connection", id: "phone" },
                { label: "City Location", id: "city" },
                { label: "Short Film Title", id: "filmName" },
                { label: "Category Track", id: "category" },
                { label: "Film Asset URL", id: "filmLink" },
                { label: "Director In-Charge", id: "director" }
            ];

            fieldsToReview.forEach(item => {
                const element = document.getElementById(item.id);
                if (element) {
                    const row = document.createElement('div');
                    row.className = 'review-row';
                    row.innerHTML = `<span>${escapeHtml(item.label)}</span><span>${escapeHtml(element.value)}</span>`;
                    matrix.appendChild(row);
                }
            });

            const feeRow = document.createElement('div');
            feeRow.className = 'review-row';
            feeRow.innerHTML = `<span>Registration Fee</span><span>₹${APP_CONFIG.registrationFee} INR (payable next step)</span>`;
            matrix.appendChild(feeRow);
        }

        /****************************************************************
         * 💳 CASHFREE PAYMENT — secure flow
         * Order creation + verification happen on the backend
         * (Apps Script). The browser never sees the Cashfree secret.
         *****************************************************************/
        const paymentState = {
            verified: false,      // true only after backend confirms PAID
            orderId: null,        // Cashfree order id
            cfPaymentId: null,    // Cashfree payment/reference id
            amount: null,
            currency: null,
            paidAt: null,
            paymentMethod: null,  // e.g. UPI, CARD, NETBANKING (from server)
            inProgress: false     // guards against double-click / duplicate orders
        };

        function showPaymentStatus(kind, message) {
            const box = document.getElementById('paymentStatusBox');
            if (!box) return;
            box.className = 'payment-status-box ' + (kind || '');
            box.innerHTML = message; // message is composed from safe, backend/whitelisted strings only
            box.style.display = 'block';
        }

        function setPayUiState(state) {
            const payBtn = document.getElementById('payNowBtn');
            const payLabel = document.getElementById('payNowBtnLabel');
            const retryBtn = document.getElementById('paymentRetryBtn');

            if (state === 'idle') {
                payBtn.style.display = 'block';
                payBtn.disabled = false;
                payLabel.textContent = 'Pay ₹' + APP_CONFIG.registrationFee + ' Securely';
                retryBtn.style.display = 'none';
            } else if (state === 'processing') {
                payBtn.style.display = 'block';
                payBtn.disabled = true;
                payLabel.textContent = 'Processing…';
                retryBtn.style.display = 'none';
            } else if (state === 'failed') {
                payBtn.style.display = 'none';
                retryBtn.style.display = 'block';
                retryBtn.disabled = false;
            } else if (state === 'paid') {
                payBtn.style.display = 'none';
                retryBtn.style.display = 'none';
            }
        }

        function backendCall(payload) {
            return fetch(APP_CONFIG.backendUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + SUPA_ANON,
                    "apikey": SUPA_ANON
                },
                body: JSON.stringify(payload)
            }).then(res => res.json());
        }

        async function startCashfreePayment() {
            if (!REGISTRATION_GATE.isOpen) return;
            if (paymentState.inProgress) return;      // prevent duplicate orders on double-click
            if (paymentState.verified) return;         // already paid

            // Make sure applicant + film details are filled before charging.
            if (!validateStepInputs(1) || !validateStepInputs(2) || !validateStepInputs(3)) {
                showPaymentStatus('is-error', 'Please complete all details before paying.');
                return;
            }
            if (typeof Cashfree !== 'function') {
                showPaymentStatus('is-error', 'Payment library failed to load. Check your connection and retry.');
                setPayUiState('failed');
                return;
            }

            paymentState.inProgress = true;
            setPayUiState('processing');
            showPaymentStatus('is-pending', 'Creating your secure payment order…');

            try {
                // NOTE: amount and currency are enforced server-side (1000 INR).
                // Only send customer info needed for the Cashfree order.
                const orderResp = await backendCall({
                    action: 'createOrder',
                    customerName: document.getElementById('applicantName').value.trim(),
                    customerEmail: document.getElementById('email').value.trim(),
                    customerPhone: document.getElementById('phone').value.trim()
                });

                if (!orderResp || orderResp.status !== 'success' || !orderResp.payment_session_id || !orderResp.order_id) {
                    throw new Error(orderResp && orderResp.message ? orderResp.message : 'Could not create order.');
                }

                paymentState.orderId = orderResp.order_id;

                // Pre-payment save: persist form data so webhook can finalize if browser closes.
                try {
                    const formSnapshot = {
                        action: 'saveFormData',
                        applicantName: document.getElementById('applicantName').value.trim(),
                        email: document.getElementById('email').value.trim(),
                        phone: document.getElementById('phone').value.trim(),
                        city: document.getElementById('city').value.trim(),
                        filmName: document.getElementById('filmName').value.trim(),
                        category: document.getElementById('category').value,
                        filmLink: document.getElementById('filmLink').value.trim(),
                        director: document.getElementById('director').value.trim(),
                        duration: document.getElementById('duration').value.trim(),
                        producer: document.getElementById('producer').value.trim(),
                        writer: document.getElementById('writer').value.trim(),
                        cinematographer: document.getElementById('cinematographer').value.trim(),
                        editor: document.getElementById('editor').value.trim(),
                        musicDirector: document.getElementById('musicDirector').value.trim(),
                        actor: document.getElementById('actor').value.trim(),
                        actress: document.getElementById('actress').value.trim(),
                        childArtist: document.getElementById('childArtist').value.trim() || 'None',
                        cashfreeOrderId: orderResp.order_id
                    };
                    if (window._linkId) formSnapshot.link_id = window._linkId;
                    await backendCall(formSnapshot);
                } catch (saveErr) {
                    console.warn('Pre-payment save failed (non-blocking):', saveErr);
                }

                const cashfree = Cashfree({ mode: APP_CONFIG.cashfreeMode });
                showPaymentStatus('is-pending', 'Opening secure Cashfree checkout…');

                const result = await cashfree.checkout({
                    paymentSessionId: orderResp.payment_session_id,
                    redirectTarget: '_modal'
                });

                // NOTE: never trust this result alone — always re-verify on the backend.
                if (result && result.error) {
                    showPaymentStatus('is-pending', 'Checkout closed. Verifying payment status…');
                }

                await verifyPaymentWithBackend();
            } catch (err) {
                showPaymentStatus('is-error', 'Payment could not be started: ' + escapeHtml(err.message || 'Unknown error') + '. Please try again.');
                setPayUiState('failed');
            } finally {
                paymentState.inProgress = false;
            }
        }

        async function verifyPaymentWithBackend() {
            if (!paymentState.orderId) {
                setPayUiState('failed');
                return;
            }
            showPaymentStatus('is-pending', 'Verifying your payment with our server…');
            try {
                const resp = await backendCall({ action: 'verifyOrder', orderId: paymentState.orderId });

                if (!resp || resp.status !== 'success') {
                    throw new Error(resp && resp.message ? resp.message : 'Verification failed.');
                }

                const payStatus = (resp.order_status || '').toUpperCase();
                if (payStatus === 'PAID') {
                    paymentState.verified = true;
                    paymentState.cfPaymentId = resp.cf_payment_id || null;
                    paymentState.amount = resp.order_amount || APP_CONFIG.registrationFee;
                    paymentState.currency = resp.order_currency || APP_CONFIG.currency;
                    paymentState.paidAt = resp.paid_at || new Date().toISOString();
                    paymentState.paymentMethod = resp.payment_method || null;
                    showPaymentStatus('is-success', '✓ Payment received (₹' + escapeHtml(paymentState.amount) + '). Submitting your entry…');
                    setPayUiState('paid');
                    // Auto-submit after successful payment.
                    await handleFinalSubmit();
                } else if (payStatus === 'ACTIVE' || payStatus === 'PENDING') {
                    showPaymentStatus('is-pending', 'Payment is still pending. If you completed it, wait a moment and press Retry to re-check.');
                    setPayUiState('failed');
                } else {
                    // FAILED, EXPIRED, TERMINATED, USER_DROPPED, cancelled, etc.
                    showPaymentStatus('is-error', 'Payment not completed (status: ' + escapeHtml(payStatus || 'unknown') + '). No charge confirmed — please try again.');
                    setPayUiState('failed');
                }
            } catch (err) {
                showPaymentStatus('is-error', 'Could not verify payment: ' + escapeHtml(err.message || 'network error') + '. Press Retry to check again.');
                setPayUiState('failed');
            }
        }

        async function handleFinalSubmit(event) {
            if (event) event.preventDefault();
            if (!REGISTRATION_GATE.isOpen) return;

            if (!paymentState.verified) {
                UI.alert("Please complete and verify payment before submitting.", "warn");
                goToWizardStep(5);
                return;
            }

            const formData = {
                action: 'handleSubmission',
                applicantName: document.getElementById('applicantName').value,
                phone: document.getElementById('phone').value,
                email: document.getElementById('email').value,
                city: document.getElementById('city').value,
                filmName: document.getElementById('filmName').value,
                category: document.getElementById('category').value,
                filmLink: document.getElementById('filmLink').value,
                director: document.getElementById('director').value,
                duration: document.getElementById('duration').value,
                producer: document.getElementById('producer').value,
                writer: document.getElementById('writer').value,
                cinematographer: document.getElementById('cinematographer').value,
                editor: document.getElementById('editor').value,
                musicDirector: document.getElementById('musicDirector').value,
                actor: document.getElementById('actor').value,
                actress: document.getElementById('actress').value,
                childArtist: document.getElementById('childArtist').value || "None",
                paymentStatus: "Paid",
                cashfreeOrderId: paymentState.orderId,
                cashfreePaymentId: paymentState.cfPaymentId,
                amount: paymentState.amount,
                currency: paymentState.currency,
                paidAt: paymentState.paidAt,
                paymentMethod: paymentState.paymentMethod
            };
            if (window._linkId) formData.link_id = window._linkId;

            try {
                showPaymentStatus('is-pending', 'Submitting your film entry…');
                const response = await backendCall(formData);
                if (response.status === "success" || response.status === "already_registered") {
                    document.getElementById('activeFormContainer').style.display = 'none';
                    document.getElementById('successScreen').style.display = 'block';
                } else {
                    showPaymentStatus('is-error', 'Submission failed: ' + escapeHtml(response.message || 'Unknown error') + '. Your payment is safe — please retry.');
                }
            } catch (err) {
                showPaymentStatus('is-error', 'Network error during submission. Your payment is safe — please retry or contact us.');
            }
        }

        function resetPortalView() {
            location.reload(); 
        }
