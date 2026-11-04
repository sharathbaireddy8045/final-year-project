/*
 * Bliss AI Planner — a context-aware event concierge for Bliss Bloom Events.
 *
 * Self-contained and additive: it reads the existing menu, decor, schedule and
 * contact markup, and drives the same checkboxes / RSVP form that web.js uses.
 * The booking pipeline itself is untouched — bookings still go through
 * window.BlissDB.addRsvp() after explicit confirmation.
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'blissChatV1';
    var MAX_STORED_MESSAGES = 30;
    var MAX_LOG_MESSAGES = 80;

    var state = {
        ctx: emptyContext(),
        plan: null,
        messages: [],
        owner: null,        // account (uid) that owns this conversation
        pending: null,      // 'book' | 'applyBook'
        expect: null,       // 'name' | 'email' | 'guests' | 'budget' | 'occasion'
        booking: false,
        applied: false,
        open: false,
        started: false
    };

    var els = {};
    var catalog = { dishes: [], decor: [], schedule: [], contact: {}, venue: {} };
    var queue = [];
    var processing = false;
    var replyTimer = null;
    var teaserTimer = null;

    /* ------------------------------------------------------------------ *
     * Helpers
     * ------------------------------------------------------------------ */

    function emptyContext() {
        return {
            eventType: null,
            guests: null,
            budget: null,
            budgetFlexible: false,
            diet: null,
            date: null,
            time: null,
            name: null,
            email: null,
            venuePref: null,
            favorites: []
        };
    }

    function $(selector, root) {
        return (root || document).querySelector(selector);
    }

    function $$(selector, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(selector));
    }

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function enrich(value) {
        return esc(value)
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
    }

    function inr(value) {
        var n = Math.round(Number(value) || 0);
        try {
            return '₹' + n.toLocaleString('en-IN');
        } catch (e) {
            return '₹' + n;
        }
    }

    function titleCase(value) {
        return String(value || '').replace(/\w\S*/g, function (word) {
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        });
    }

    function unique(list) {
        var seen = {};
        return list.filter(function (item) {
            var key = String(item).toLowerCase();
            if (seen[key]) return false;
            seen[key] = true;
            return true;
        });
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function withTimeout(promise, ms, message) {
        return new Promise(function (resolve, reject) {
            var settled = false;
            var timer = setTimeout(function () {
                if (settled) return;
                settled = true;
                reject(new Error(message || 'The request took too long to respond.'));
            }, ms);
            Promise.resolve(promise).then(function (value) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(value);
            }, function (error) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(error);
            });
        });
    }

    /* ------------------------------------------------------------------ *
     * Catalog — read the existing page instead of duplicating its data
     * ------------------------------------------------------------------ */

    var CATEGORY = {
        'spring-rolls': 'Starters',
        'chicken-tikka': 'Starters',
        'bruschetta': 'Starters',
        'paneer-butter-masala': 'Main course',
        'butter-chicken': 'Main course',
        'pasta-alfredo': 'Main course',
        'jeera-rice': 'Sides',
        'garlic-naan': 'Sides',
        'chocolate-brownie': 'Desserts',
        'rasmalai': 'Desserts',
        'cheesecake': 'Desserts',
        'mojito': 'Beverages',
        'masala-chai': 'Beverages',
        'cold-coffee': 'Beverages'
    };

    var NON_VEG_IDS = { 'chicken-tikka': true, 'butter-chicken': true };

    function loadCatalog() {
        catalog.dishes = $$('.item-checkbox').map(function (box) {
            return {
                id: box.getAttribute('data-item-id') || '',
                name: box.getAttribute('data-item-name') || '',
                cost: Number(box.getAttribute('data-item-cost')) || 0,
                veg: !NON_VEG_IDS[box.getAttribute('data-item-id')],
                category: CATEGORY[box.getAttribute('data-item-id')] || 'Menu'
            };
        }).filter(function (dish) {
            return dish.id && dish.name && dish.cost > 0;
        });

        catalog.decor = $$('.decor-checkbox').map(function (box) {
            return {
                name: box.getAttribute('data-item-name') || '',
                cost: Number(box.getAttribute('data-item-cost')) || 0
            };
        }).filter(function (item) {
            return item.name && item.cost > 0;
        });

        catalog.schedule = $$('.schedule-day').map(function (day) {
            var heading = $('h3', day);
            var paras = $$('p', day);
            var items = $$('li', day).map(function (li) {
                return li.textContent.trim();
            });
            return {
                title: heading ? heading.textContent.trim() : '',
                lines: paras.map(function (p) { return p.textContent.trim(); }),
                items: items
            };
        });

        var mail = $('#contact a[href^="mailto:"]');
        var phone = $('#contact a[href^="tel:"]');
        catalog.contact = {
            email: mail ? mail.textContent.trim() : 'info@cambridge.edu.in',
            emailHref: mail ? mail.getAttribute('href') : 'mailto:info@cambridge.edu.in',
            phone: phone ? phone.textContent.trim() : '+91 78929 77787',
            phoneHref: phone ? phone.getAttribute('href') : 'tel:+917892977787'
        };

        var venueParas = $$('#venue .venue-item p');
        var addressPara = venueParas.filter(function (p) {
            return /^address\b/i.test(p.textContent.trim());
        })[0] || venueParas[0];
        catalog.venue = {
            address: addressPara ? addressPara.textContent.trim() : '',
            mapHref: $('#venue a[href*="google.com/maps"]')
                ? $('#venue a[href*="google.com/maps"]').getAttribute('href')
                : ''
        };
    }

    function dishById(id) {
        for (var i = 0; i < catalog.dishes.length; i++) {
            if (catalog.dishes[i].id === id) return catalog.dishes[i];
        }
        return null;
    }

    function decorByName(name) {
        for (var i = 0; i < catalog.decor.length; i++) {
            if (catalog.decor[i].name === name) return catalog.decor[i];
        }
        return null;
    }

    /* ------------------------------------------------------------------ *
     * Event vocabulary
     * ------------------------------------------------------------------ */

    var EVENT_TYPES = [
        { key: 'birthday', label: 'birthday party', re: /\b(birthday|bday|b-day|born day)\b/ },
        { key: 'wedding', label: 'wedding', re: /\b(wedding|marriage|shaadi|shadi|vivah|reception)\b/ },
        { key: 'engagement', label: 'engagement', re: /\b(engagement|ring ceremony|sangeet|haldi|mehendi|mehndi)\b/ },
        { key: 'anniversary', label: 'anniversary', re: /\b(anniversary|wedding anniversary)\b/ },
        { key: 'corporate', label: 'corporate event', re: /\b(corporate|company|office|conference|seminar|product launch|team outing|business meet|award night)\b/ },
        { key: 'baby-shower', label: 'baby shower', re: /\b(baby shower|gender reveal|naming ceremony|namakaran)\b/ },
        { key: 'graduation', label: 'graduation', re: /\b(graduation|convocation|farewell|freshers|college fest|school fest)\b/ },
        { key: 'housewarming', label: 'housewarming', re: /\b(housewarming|house warming|griha pravesh|gruhapravesh)\b/ },
        { key: 'party', label: 'private party', re: /\b(party|get together|get-together|celebration|function|family gathering)\b/ }
    ];

    var EVENT_DECOR = {
        birthday: ['Balloon Arch & Arrangements', 'Themed Backdrops', 'LED Light Decor', 'Table Runners & Linen Decor', 'Chandeliers & Hanging Lights'],
        wedding: ['Floral Arrangements', 'Hanging Floral Garlands', 'Mandala & Rangoli Designs', 'Themed Backdrops', 'Chandeliers & Hanging Lights', 'Drapes & Fabric Decorations'],
        engagement: ['Floral Arrangements', 'Hanging Floral Garlands', 'Themed Backdrops', 'Lanterns & Candle Holders', 'Drapes & Fabric Decorations'],
        anniversary: ['Floral Arrangements', 'Lanterns & Candle Holders', 'LED Light Decor', 'Table Runners & Linen Decor', 'Drapes & Fabric Decorations'],
        corporate: ['LED Light Decor', 'Projection Mapping', 'Minimalist Theme', 'Geometric Design Elements', 'Table Runners & Linen Decor'],
        'baby-shower': ['Balloon Arch & Arrangements', 'Floral Arrangements', 'Themed Backdrops', 'Table Runners & Linen Decor', 'Hanging Floral Garlands'],
        graduation: ['LED Light Decor', 'Themed Backdrops', 'Balloon Arch & Arrangements', 'Table Runners & Linen Decor'],
        housewarming: ['Floral Arrangements', 'Mandala & Rangoli Designs', 'Lanterns & Candle Holders', 'Garden & Greenery Decor'],
        party: ['Balloon Arch & Arrangements', 'LED Light Decor', 'Table Runners & Linen Decor', 'Themed Backdrops']
    };

    var TIER_LABEL = {
        essential: 'Bloom Essential',
        signature: 'Bloom Signature',
        premium: 'Bloom Grand'
    };

    var TIER_RANK = { essential: 0, signature: 1, premium: 2 };

    function eventTypeLabel(key) {
        if (!key) return 'celebration';
        for (var i = 0; i < EVENT_TYPES.length; i++) {
            if (EVENT_TYPES[i].key === key) return EVENT_TYPES[i].label;
        }
        return 'celebration';
    }

    function detectEventType(text) {
        for (var i = 0; i < EVENT_TYPES.length; i++) {
            if (EVENT_TYPES[i].re.test(text)) return EVENT_TYPES[i].key;
        }
        return null;
    }

    function dietLabel(diet) {
        if (diet === 'vegetarian') return 'pure vegetarian';
        if (diet === 'vegan') return 'vegan';
        if (diet === 'jain') return 'Jain';
        if (diet === 'nonveg') return 'non-vegetarian';
        if (diet === 'eggetarian') return 'eggetarian';
        return 'no preference';
    }

    function detectDiet(text) {
        if (/\b(non[\s-]?veg|non[\s-]?vegetarian|chicken|mutton|fish|meat|seafood)\b/.test(text)) return 'nonveg';
        if (/\bvegan\b/.test(text)) return 'vegan';
        if (/\bjain\b/.test(text)) return 'jain';
        if (/\begg(?:etarian)?\b/.test(text)) return 'eggetarian';
        if (/\b(veg|vegetarian|pure veg|no meat|no egg)\b/.test(text)) return 'vegetarian';
        return null;
    }

    /* ------------------------------------------------------------------ *
     * Number + entity extraction
     * ------------------------------------------------------------------ */

    var WORD_NUMBERS = {
        one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
        nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
        thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80,
        ninety: 90, hundred: 100
    };

    function toNumber(raw) {
        var cleaned = String(raw).replace(/,/g, '').trim();
        if (/^\d+(?:\.\d+)?$/.test(cleaned)) return parseFloat(cleaned);
        return WORD_NUMBERS[cleaned.toLowerCase()] || null;
    }

    function formatAmount(raw, suffix) {
        var n = toNumber(raw);
        if (n == null) return null;
        var s = (suffix || '').toLowerCase();
        if (s.indexOf('lakh') === 0 || s === 'lac' || s === 'l') n *= 100000;
        else if (s === 'k') n *= 1000;
        if (!isFinite(n) || n <= 0) return null;
        return Math.round(n);
    }

    function extractBudget(raw, text) {
        var m;
        if ((m = raw.match(/(?:₹|rs\.?|inr|rupees?)\s*([\d,]+(?:\.\d+)?)\s*(k|lakh|lac|l)?/i))) {
            return formatAmount(m[1], m[2]);
        }
        if ((m = raw.match(/\b([\d,]+(?:\.\d+)?)\s*(k|lakh|lac)\b/i))) {
            return formatAmount(m[1], m[2]);
        }
        if ((m = raw.match(/\bbudget\b[^\d]{0,18}([\d,]+(?:\.\d+)?)\s*(k|lakh|lac)?/i))) {
            var budget = formatAmount(m[1], m[2]);
            if (budget && budget < 1000) budget *= 1000;
            return budget;
        }
        if ((m = raw.match(/\b(?:around|about|approx(?:imately)?|within|under|upto|up to|max(?:imum)?)\s*(?:₹|rs\.?|inr)?\s*([\d,]{3,})\b/i))) {
            return formatAmount(m[1], '');
        }
        return null;
    }

    function extractGuests(raw) {
        var m;
        var patterns = [
            /\b(\d{1,3}(?:,\d{3})*|\d+)\s*(?:people|persons?|guests?|pax|members?|heads?|attendees?)\b/i,
            /\b(?:for|party of|group of|inviting|around|about)\s+(\d{1,3}(?:,\d{3})*|\d+)\b/i,
            /\bguests?\s*(?:of|:|=|is|are|count)?\s*(\d{1,3}(?:,\d{3})*|\d+)\b/i
        ];
        for (var i = 0; i < patterns.length; i++) {
            if ((m = raw.match(patterns[i]))) {
                var n = toNumber(m[1]);
                if (n && n >= 1 && n <= 5000) return Math.round(n);
            }
        }
        if ((m = raw.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\s+(?:people|persons?|guests?|pax|members?)\b/i))) {
            return WORD_NUMBERS[m[1].toLowerCase()] || null;
        }
        return null;
    }

    function extractDate(raw) {
        var m = raw.match(/\b(today|tomorrow|tonight|this weekend|next weekend|next week|next month|this month|next (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|on\s+\d{1,2}(?:st|nd|rd|th)?(?:\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?))?|\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2})\b/i);
        return m ? m[1].trim() : null;
    }

    function extractTime(raw) {
        var m = raw.match(/\b(morning|afternoon|evening|night|lunch|dinner|brunch|breakfast|noon|midnight|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i);
        return m ? m[1].trim() : null;
    }

    function extractEmail(raw) {
        var m = raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
        return m ? m[0] : null;
    }

    function cleanName(raw) {
        var value = raw
            .replace(/^(?:hi|hello|hey)[,!\s]+/i, '')
            .replace(/^(?:my name is|name is|this is|it'?s|i am|i'?m)\s+/i, '')
            .replace(/[.,!?;:]+$/g, '')
            .trim();
        if (!value || value.length > 48) return null;
        if (/\d|@|https?:/i.test(value)) return null;
        if (/^(?:yes|yeah|yep|yup|no|nope|nah|ok|okay|sure|please|thanks|thank you|cancel|stop|maybe|help|hi|hello|hey|menu|apply|book|confirm)\b/i.test(value)) return null;
        if (/^(?:planning|looking|interested|organi[sz]ing|having|hosting|throwing|celebrating|from|here|guest|user|birthday|wedding|party)\b/i.test(value)) return null;
        var words = value.split(/\s+/);
        if (words.length > 4) return null;
        return titleCase(words.slice(0, 3).join(' '));
    }

    function extractName(raw) {
        var m = raw.match(/\b(?:my name is|name is|this is|it'?s)\s+([a-z][a-z .'-]{1,40})/i);
        if (m) return cleanName(m[1]);
        m = raw.match(/\bi(?:'m| am)\s+([a-z][a-z.'-]{1,24})(?:\s+([a-z][a-z.'-]{1,24}))?/i);
        if (m) return cleanName((m[1] + ' ' + (m[2] || '')).trim());
        return null;
    }

    function escapeRe(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function matchDishes(text) {
        var found = [];
        catalog.dishes.forEach(function (dish) {
            var name = dish.name.toLowerCase();
            var shortName = name.replace(/\s+with\s+.*$/, '');
            if (text.indexOf(name) >= 0 || text.indexOf(shortName) >= 0) {
                found.push(dish);
                return;
            }
            var tokens = shortName.split(/\s+/).filter(function (word) {
                return word.length >= 5 && word !== 'with';
            });
            for (var i = 0; i < tokens.length; i++) {
                if (new RegExp('\\b' + escapeRe(tokens[i]) + '\\b').test(text)) {
                    found.push(dish);
                    return;
                }
            }
        });
        return found;
    }

    function matchDecor(text) {
        var found = [];
        catalog.decor.forEach(function (item) {
            var name = item.name.toLowerCase();
            if (text.indexOf(name) >= 0) {
                found.push(item);
                return;
            }
            var tokens = name
                .replace(/&/g, ' ')
                .split(/\s+/)
                .filter(function (word) { return word.length >= 6; });
            for (var i = 0; i < tokens.length; i++) {
                if (new RegExp('\\b' + escapeRe(tokens[i]) + '\\b').test(text)) {
                    found.push(item);
                    return;
                }
            }
        });
        return found;
    }

    function extractEntities(raw) {
        var text = ' ' + raw.toLowerCase().replace(/[’']/g, "'") + ' ';
        var entities = {};
        var eventType = detectEventType(text);
        var guests = extractGuests(text);
        var budget = extractBudget(raw, text);
        var diet = detectDiet(text);
        var date = extractDate(raw);
        var time = extractTime(raw);
        var email = extractEmail(raw);
        var name = extractName(raw);
        var venuePref = null;

        // "Show veg options" is a browsing filter, not a permanent diet change.
        if (diet && /\b(show|options|menu|list|which|what|any|do you have)\b/.test(text) &&
            !/\b(make|keep|switch|include|prefer|only|want|need|use|add)\b/.test(text)) {
            diet = null;
        }

        if (/\b(outdoor|open air|garden|lawn|rooftop)\b/.test(text)) venuePref = 'outdoor';
        else if (/\b(indoor|banquet|hall|ballroom)\b/.test(text)) venuePref = 'indoor';

        if (eventType) entities.eventType = eventType;
        if (guests) entities.guests = guests;
        if (budget) entities.budget = budget;
        if (diet) entities.diet = diet;
        if (date) entities.date = date;
        if (time) entities.time = time;
        if (email) entities.email = email;
        if (name) entities.name = name;
        if (venuePref) entities.venuePref = venuePref;

        return {
            raw: raw,
            text: text,
            entities: entities,
            dishes: matchDishes(text),
            decor: matchDecor(text)
        };
    }

    /* ------------------------------------------------------------------ *
     * Persistent conversation state
     * ------------------------------------------------------------------ */

    function saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                owner: state.owner || null,
                ctx: state.ctx,
                plan: state.plan,
                messages: state.messages.slice(-MAX_STORED_MESSAGES)
            }));
        } catch (e) {}
    }

    function loadState() {
        var saved = null;
        try {
            saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        } catch (e) {
            saved = null;
        }
        if (!saved) return;

        // Conversations belong to the account that started them.
        var key = identityKey();
        if (saved.owner && key && saved.owner !== key) {
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
            return;
        }
        state.owner = saved.owner || null;

        if (saved.ctx && typeof saved.ctx === 'object') {
            state.ctx = Object.assign(emptyContext(), saved.ctx);
            if (!Array.isArray(state.ctx.favorites)) state.ctx.favorites = [];
        }
        if (saved.plan && Array.isArray(saved.plan.dishes)) state.plan = saved.plan;
        if (Array.isArray(saved.messages)) {
            state.messages = saved.messages.filter(function (message) {
                return message && (message.who === 'bot' || message.who === 'user') && typeof message.text === 'string';
            }).slice(-MAX_STORED_MESSAGES);
        }
    }

    /* ------------------------------------------------------------------ *
     * Recommendation engine
     * ------------------------------------------------------------------ */

    function pickCategory(pool, category, tier) {
        var list = pool.filter(function (dish) {
            return dish.category === category;
        }).sort(function (a, b) { return a.cost - b.cost; });

        if (!list.length) return [];
        if (tier === 'essential') return [list[0]];
        if (tier === 'premium') {
            if (list.length === 1) return [list[0]];
            return [list[list.length - 2], list[list.length - 1]];
        }
        return [list[Math.min(1, list.length - 1)]];
    }

    function chooseDishes(pool, tier, ctx) {
        var categories = ['Starters', 'Main course', 'Sides', 'Desserts', 'Beverages'];
        var picks = [];

        categories.forEach(function (category) {
            pickCategory(pool, category, tier).forEach(function (dish) {
                picks.push(dish.id);
            });
        });

        (ctx.favorites || []).forEach(function (id) {
            var dish = dishById(id);
            if (dish && (!pool.length || pool.some(function (item) { return item.id === id; }))) {
                picks.push(id);
            }
        });

        return unique(picks);
    }

    function dishTotal(ids, guests) {
        return ids.reduce(function (sum, id) {
            var dish = dishById(id);
            return sum + (dish ? dish.cost * guests : 0);
        }, 0);
    }

    function dropOptional(ids) {
        var order = ['Beverages', 'Desserts', 'Sides', 'Starters'];
        for (var i = 0; i < order.length; i++) {
            for (var j = ids.length - 1; j >= 0; j--) {
                var dish = dishById(ids[j]);
                if (dish && dish.category === order[i]) {
                    ids.splice(j, 1);
                    return true;
                }
            }
        }
        return false;
    }

    function chooseDecor(ctx, tier, decorBudget) {
        var names = (EVENT_DECOR[ctx.eventType] || EVENT_DECOR.party).slice();
        var items = [];
        var total = 0;
        var limits = { essential: 3, signature: 4, premium: 6 };
        var limit = limits[tier] || 4;

        names.forEach(function (name) {
            if (items.length >= limit) return;
            var item = decorByName(name);
            if (!item) return;
            if (decorBudget > 0 && total + item.cost > decorBudget) return;
            items.push({ name: item.name, cost: item.cost });
            total += item.cost;
        });

        if (!items.length && decorBudget > 0) {
            var cheapest = catalog.decor.slice().sort(function (a, b) { return a.cost - b.cost; })[0];
            if (cheapest && cheapest.cost <= decorBudget) {
                items.push({ name: cheapest.name, cost: cheapest.cost });
            }
        }

        return items;
    }

    function buildPlan(ctx) {
        var guests = Math.max(1, Number(ctx.guests) || 0);
        var budget = Number(ctx.budget) || 0;
        var vegOnly = ctx.diet === 'vegetarian' || ctx.diet === 'vegan' || ctx.diet === 'jain';
        var pool = catalog.dishes.filter(function (dish) {
            return !vegOnly || dish.veg;
        });

        var perGuest = budget ? budget / guests : 0;
        var tier = ctx.tier || (perGuest >= 1500 ? 'premium' : perGuest >= 600 ? 'signature' : 'essential');
        if (!ctx.tier && !budget) tier = 'signature';

        var foodShare = ctx.eventType === 'wedding' ? 0.50 : 0.55;
        var decorShare = ctx.eventType === 'wedding' ? 0.25 : 0.20;
        var foodBudget = budget ? budget * foodShare : 0;
        var decorBudget = budget ? budget * decorShare : 0;

        var ids = chooseDishes(pool, tier, ctx);
        var totalFood = dishTotal(ids, guests);

        while (foodBudget > 0 && totalFood > foodBudget) {
            if (TIER_RANK[tier] > 0) {
                tier = tier === 'premium' ? 'signature' : 'essential';
                ids = chooseDishes(pool, tier, ctx);
                totalFood = dishTotal(ids, guests);
                continue;
            }
            var trimmed = dropOptional(ids);
            if (!trimmed) break;
            totalFood = dishTotal(ids, guests);
        }

        var dishes = ids.map(function (id) {
            var dish = dishById(id);
            return {
                id: id,
                name: dish.name,
                cost: dish.cost,
                category: dish.category,
                veg: dish.veg,
                qty: guests,
                subtotal: dish.cost * guests
            };
        });

        var decor = chooseDecor(ctx, tier, decorBudget);
        var decorTotal = decor.reduce(function (sum, item) { return sum + item.cost; }, 0);
        var total = totalFood + decorTotal;
        var advance = Math.round(total * 0.30);
        var withinBudget = !budget || total <= budget;

        var plan = {
            tier: tier,
            label: TIER_LABEL[tier],
            guests: guests,
            budget: budget,
            diet: ctx.diet || null,
            eventType: ctx.eventType || null,
            dishes: dishes,
            decor: decor,
            foodTotal: totalFood,
            decorTotal: decorTotal,
            total: total,
            advance: advance,
            perGuest: Math.round(total / guests),
            withinBudget: withinBudget,
            foodBudget: Math.round(foodBudget),
            decorBudget: Math.round(decorBudget),
            remaining: budget ? Math.max(0, budget - total) : 0,
            createdAt: Date.now()
        };

        if (budget && total > budget) {
            plan.note = 'This is the leanest version of the menu I can build from the site pricing. Reducing the guest count or raising the budget slightly would let me add more variety.';
        } else if (!budget) {
            plan.note = 'No budget was set, so this is a mid-range plan. Share a cap and I will tune it.';
        } else if (plan.remaining > budget * 0.35) {
            plan.note = 'Prices are estimates from the menu and decor on this site; the venue visit confirms the final quote.';
        } else {
            plan.note = 'The plan sits inside your budget based on the prices on this site. The venue visit confirms the final quote.';
        }

        return plan;
    }

    function planLines(plan, options) {
        var opts = options || {};
        var lines = [];
        var dishes = opts.compact ? plan.dishes.slice(0, 5) : plan.dishes;
        var decor = opts.compact ? plan.decor.slice(0, 4) : plan.decor;

        lines.push('**' + plan.label + '** · ' + titleCase(eventTypeLabel(plan.eventType)) + ' · ' + plan.guests + ' guests');
        if (plan.diet) lines.push('Menu style: **' + dietLabel(plan.diet) + '**');

        if (dishes.length) {
            lines.push('');
            lines.push('**Menu**');
            dishes.forEach(function (dish) {
                lines.push('• ' + dish.name + ' — ' + inr(dish.cost) + '/plate × ' + dish.qty + ' = ' + inr(dish.subtotal));
            });
            if (plan.dishes.length > dishes.length) {
                lines.push('• +' + (plan.dishes.length - dishes.length) + ' more dish(es)');
            }
        }

        if (decor.length) {
            lines.push('');
            lines.push('**Decor**');
            decor.forEach(function (item) {
                lines.push('• ' + item.name + ' — ' + inr(item.cost));
            });
            if (plan.decor.length > decor.length) {
                lines.push('• +' + (plan.decor.length - decor.length) + ' more decor item(s)');
            }
        }

        lines.push('');
        lines.push('**Menu + decor estimate: ' + inr(plan.total) + '** · ' + inr(plan.perGuest) + '/guest');
        lines.push('Advance (30%): ' + inr(plan.advance));

        if (plan.budget) {
            lines.push('Your budget: ' + inr(plan.budget) + (plan.withinBudget
                ? ' — inside it with about ' + inr(plan.remaining) + ' left for venue, cake and entertainment.'
                : ' — currently over by ' + inr(plan.total - plan.budget) + '.'));
        }

        if (plan.note) lines.push('');
        if (plan.note) lines.push(plan.note);
        return lines.join('\n');
    }

    function planSummary(plan) {
        return plan.label + ' · ' + plan.guests + ' guests · menu + decor ' + inr(plan.total) +
            ' · advance ' + inr(plan.advance);
    }

    function invalidatePlan() {
        state.plan = null;
        state.applied = false;
    }

    function mergeContext(entities) {
        var coreChanged = false;
        var changed = [];

        if (entities.eventType && entities.eventType !== state.ctx.eventType) {
            state.ctx.eventType = entities.eventType;
            coreChanged = true;
            changed.push(titleCase(eventTypeLabel(entities.eventType)));
        }
        if (entities.guests && entities.guests !== state.ctx.guests) {
            state.ctx.guests = entities.guests;
            coreChanged = true;
            changed.push(entities.guests + ' guests');
        }
        if (entities.budget && entities.budget !== state.ctx.budget) {
            state.ctx.budget = entities.budget;
            state.ctx.budgetFlexible = false;
            coreChanged = true;
            changed.push(inr(entities.budget) + ' budget');
        }
        if (entities.diet && entities.diet !== state.ctx.diet) {
            state.ctx.diet = entities.diet;
            coreChanged = true;
            changed.push(dietLabel(entities.diet));
        }
        if (entities.date) {
            state.ctx.date = entities.date;
            changed.push('date: ' + entities.date);
        }
        if (entities.time) {
            state.ctx.time = entities.time;
            changed.push('time: ' + entities.time);
        }
        if (entities.name) state.ctx.name = entities.name;
        if (entities.email) state.ctx.email = entities.email;
        if (entities.venuePref) state.ctx.venuePref = entities.venuePref;

        if (coreChanged) {
            invalidatePlan();
            delete state.ctx.tier;
        }
        saveState();
        return changed;
    }

    /* ------------------------------------------------------------------ *
     * Driving the existing page (no booking logic is reimplemented)
     * ------------------------------------------------------------------ */

    function clearSelections() {
        $$('.item-checkbox, .decor-checkbox').forEach(function (box) {
            box.checked = false;
        });
        $$('.item-quantity').forEach(function (input) {
            input.value = 0;
            if (input.parentElement) input.parentElement.style.display = 'none';
        });
    }

    function selectDish(id, qty) {
        var box = $('.item-checkbox[data-item-id="' + id + '"]');
        if (!box) return false;
        box.checked = true;
        box.dispatchEvent(new Event('change', { bubbles: true }));
        var input = document.getElementById(id + '-qty');
        if (input) {
            input.value = qty;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return true;
    }

    function selectDecor(name) {
        var boxes = $$('.decor-checkbox');
        for (var i = 0; i < boxes.length; i++) {
            if (boxes[i].getAttribute('data-item-name') === name) {
                boxes[i].checked = true;
                boxes[i].dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
        }
        return false;
    }

    function refreshSummary() {
        var checked = $('.item-checkbox:checked');
        var input = checked
            ? document.getElementById(checked.getAttribute('data-item-id') + '-qty')
            : $('.item-quantity');
        if (input) input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function applyPlan(plan) {
        clearSelections();
        plan.dishes.forEach(function (dish) {
            selectDish(dish.id, dish.qty);
        });
        plan.decor.forEach(function (item) {
            selectDecor(item.name);
        });
        refreshSummary();

        var guests = document.getElementById('guests');
        if (guests && state.ctx.guests) guests.value = state.ctx.guests;

        var rsvpTab = document.getElementById('rsvp-tab');
        if (rsvpTab) rsvpTab.checked = true;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        state.applied = true;
        saveState();
    }

    function selectedCount() {
        return $$('.item-checkbox:checked, .decor-checkbox:checked').length;
    }

    function collectPayload() {
        var items = [];
        var summaryLines = [];
        var total = 0;

        $$('.item-checkbox:checked').forEach(function (box) {
            var id = box.getAttribute('data-item-id');
            var input = document.getElementById(id + '-qty');
            var qty = input ? parseInt(input.value, 10) || 0 : 0;
            var cost = parseInt(box.getAttribute('data-item-cost'), 10) || 0;
            var subtotal = cost * qty;
            total += subtotal;
            items.push({
                id: id,
                name: box.getAttribute('data-item-name'),
                type: 'dish',
                quantity: qty,
                cost: cost,
                subtotal: subtotal
            });
            summaryLines.push(box.getAttribute('data-item-name') + ' x ' + qty + ' = ' + inr(subtotal));
        });

        $$('.decor-checkbox:checked').forEach(function (box) {
            var cost = parseInt(box.getAttribute('data-item-cost'), 10) || 0;
            total += cost;
            items.push({
                id: box.getAttribute('data-item-id') || box.getAttribute('data-item-name'),
                name: box.getAttribute('data-item-name'),
                type: 'decor',
                quantity: 1,
                cost: cost,
                subtotal: cost
            });
            summaryLines.push(box.getAttribute('data-item-name') + ' = ' + inr(cost));
        });

        var nameInput = document.getElementById('name');
        var emailInput = document.getElementById('email');
        var formName = nameInput && nameInput.value ? nameInput.value.trim() : '';
        var formEmail = emailInput && emailInput.value ? emailInput.value.trim() : '';
        if (formName) state.ctx.name = formName;
        if (formEmail) state.ctx.email = formEmail;

        return {
            name: formName || state.ctx.name || '',
            email: formEmail || state.ctx.email || '',
            guests: Number(state.ctx.guests) || 1,
            itemsSummary: summaryLines.join('\n'),
            items: items,
            totalCost: total,
            advancePayment: Math.round(total * 0.30)
        };
    }

    function currentUser() {
        if (window.BlissAuth && typeof window.BlissAuth.currentUser === 'function') {
            try {
                var user = window.BlissAuth.currentUser();
                if (user) return user;
            } catch (e) {}
        }
        try {
            return JSON.parse(localStorage.getItem('blissUser') || 'null');
        } catch (e) {
            return null;
        }
    }

    function identityKey() {
        var user = currentUser();
        if (!user) return null;
        return user.uid || user.email || user.name || null;
    }

    /**
     * Keeps the conversation tied to the current account. Called whenever the
     * planner opens: a different guest/login (or an unattributed conversation
     * from an older build) starts from a clean chat.
     */
    function adoptIdentity() {
        var key = identityKey();
        if (!key) return false;
        if (state.owner === key) return false;

        if (!state.owner && !state.messages.length) {
            state.owner = key;
            saveState();
            return false;
        }

        state.ctx = emptyContext();
        state.plan = null;
        state.pending = null;
        state.expect = null;
        state.booking = false;
        state.applied = false;
        state.messages = [];
        state.owner = key;
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        seedIdentity();
        if (els.log) els.log.innerHTML = '';
        welcome();
        renderQuickForContext();
        saveState();
        return true;
    }

    function seedIdentity() {
        var user = currentUser();
        if (!user) return;
        var isGuest = user.isAnonymous || user.type === 'guest' || user.isGuest;
        var name = user.displayName || user.name || '';
        var email = user.email || '';
        if (!isGuest) {
            if (name && name !== 'Guest User' && !state.ctx.name) state.ctx.name = name;
            if (email && !state.ctx.email) state.ctx.email = email;
        }
    }

    /* ------------------------------------------------------------------ *
     * Chat panel UI
     * ------------------------------------------------------------------ */

    function cacheElements() {
        els.root = document.getElementById('blissChat');
        els.panel = document.getElementById('blissChatPanel');
        els.log = document.getElementById('blissChatLog');
        els.quick = document.getElementById('blissChatQuick');
        els.form = document.getElementById('blissChatForm');
        els.input = document.getElementById('blissChatInput');
        els.send = document.getElementById('blissChatSend');
        els.launcher = document.getElementById('blissChatLauncher');
        els.close = document.getElementById('blissChatClose');
        els.reset = document.getElementById('blissChatReset');
        els.teaser = document.getElementById('blissChatTeaser');
        els.badge = document.getElementById('blissChatBadge');
    }

    function scrollLog() {
        if (!els.log) return;
        var apply = function () {
            els.log.scrollTop = els.log.scrollHeight;
        };
        apply();
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(apply);
        }
    }

    function addMessage(who, text, options) {
        var opts = options || {};
        var message = { who: who, text: String(text == null ? '' : text) };
        state.messages.push(message);
        if (state.messages.length > MAX_LOG_MESSAGES) {
            state.messages = state.messages.slice(-MAX_LOG_MESSAGES);
        }
        saveState();
        if (els.log) renderMessage(message);
        if (opts.quick) renderQuick(opts.quick);
        scrollLog();
    }

    function renderMessage(message) {
        if (!els.log) return;
        var row = document.createElement('div');
        row.className = 'bliss-msg bliss-msg--' + (message.who === 'user' ? 'user' : 'bot');

        if (message.who !== 'user') {
            var avatar = document.createElement('span');
            avatar.className = 'bliss-msg-avatar';
            avatar.setAttribute('aria-hidden', 'true');
            avatar.textContent = 'B';
            row.appendChild(avatar);
        }

        var bubble = document.createElement('div');
        bubble.className = 'bliss-bubble';
        bubble.innerHTML = enrich(message.text);
        row.appendChild(bubble);
        els.log.appendChild(row);
    }

    function renderStoredMessages() {
        if (!els.log) return;
        els.log.innerHTML = '';
        state.messages.forEach(renderMessage);
        scrollLog();
    }

    function renderQuick(items) {
        if (!els.quick) return;
        els.quick.innerHTML = '';
        var labels = (items || []).filter(Boolean).slice(0, 6);
        els.quick.hidden = labels.length === 0;
        labels.forEach(function (label) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'bliss-quick-btn';
            button.textContent = label;
            button.addEventListener('click', function () {
                sendText(label);
            });
            els.quick.appendChild(button);
        });
        els.quick.scrollLeft = 0;
    }

    function showTyping() {
        if (!els.log) return;
        hideTyping();
        var row = document.createElement('div');
        row.id = 'blissTyping';
        row.className = 'bliss-msg bliss-msg--bot bliss-msg--typing';
        var avatar = document.createElement('span');
        avatar.className = 'bliss-msg-avatar';
        avatar.setAttribute('aria-hidden', 'true');
        avatar.textContent = 'B';
        var bubble = document.createElement('div');
        bubble.className = 'bliss-bubble bliss-bubble--typing';
        bubble.innerHTML = '<span></span><span></span><span></span>';
        bubble.setAttribute('aria-label', 'Bliss is typing');
        row.appendChild(avatar);
        row.appendChild(bubble);
        els.log.appendChild(row);
        scrollLog();
    }

    function hideTyping() {
        var row = document.getElementById('blissTyping');
        if (row && row.parentNode) row.parentNode.removeChild(row);
    }

    function setLauncherOpen(open) {
        if (!els.launcher) return;
        els.launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
        els.launcher.classList.toggle('is-open', open);
        if (els.badge) els.badge.hidden = open;
    }

    function hideTeaser() {
        if (teaserTimer) {
            clearTimeout(teaserTimer);
            teaserTimer = null;
        }
        if (els.teaser) els.teaser.hidden = true;
    }

    function closeSitePanels() {
        var themePanel = document.getElementById('themePanel');
        var accountMenu = document.getElementById('accountMenu');
        var brandBtn = document.getElementById('brandBtn');
        var themeBtn = document.getElementById('themeBtn');
        if (themePanel) themePanel.hidden = true;
        if (accountMenu) accountMenu.hidden = true;
        if (brandBtn) brandBtn.setAttribute('aria-expanded', 'false');
        if (themeBtn) themeBtn.setAttribute('aria-expanded', 'false');
    }

    function openChat() {
        if (!els.panel) return;
        adoptIdentity();
        hideTeaser();
        closeSitePanels();
        els.panel.hidden = false;
        state.open = true;
        setLauncherOpen(true);
        if (!state.started || !state.messages.length) {
            state.started = true;
            if (!state.messages.length) welcome();
        }
        renderStoredMessages();
        renderQuickForContext();
        scrollLog();
        setTimeout(function () {
            scrollLog();
            if (els.input) els.input.focus();
        }, 120);
    }

    function closeChat() {
        if (!els.panel) return;
        els.panel.hidden = true;
        state.open = false;
        setLauncherOpen(false);
    }

    function toggleChat() {
        if (state.open) closeChat();
        else openChat();
    }

    function resetChat() {
        state.ctx = emptyContext();
        state.plan = null;
        state.pending = null;
        state.expect = null;
        state.booking = false;
        state.applied = false;
        state.messages = [];
        state.owner = identityKey();
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        seedIdentity();
        if (els.log) els.log.innerHTML = '';
        welcome();
        renderQuickForContext();
        scrollLog();
    }

    function welcome() {
        var user = currentUser();
        var known = state.ctx.name || (user && !user.isAnonymous && user.displayName ? user.displayName : '');
        var name = known ? String(known).trim().split(/\s+/)[0] : '';
        var hello = name ? 'Hi ' + name + '!' : 'Hi there!';
        addMessage('bot',
            hello + ' I am **Bliss**, your AI event planner. 🎉\n' +
            'Tell me what you are celebrating and I will shape the menu, decor and budget around it — for example: *"Plan a birthday for 50 guests with a ₹50,000 budget."*\n\n' +
            'I can also answer menu, decor, venue, schedule and booking questions.',
            {
                quick: ['Plan a birthday', 'Plan a wedding', 'Show the menu', 'What can you do?']
            }
        );
    }

    function renderQuickForContext() {
        if (!state.messages.length) return;
        var c = state.ctx;
        if (state.plan && !state.applied) {
            renderQuick(['Apply this plan', 'Make it cheaper', 'Book now', 'My bookings']);
        } else if (state.applied) {
            renderQuick(['Book now', 'Make it vegetarian', 'My bookings', 'Start over']);
        } else if (c.eventType && c.guests && !c.budget) {
            renderQuick(['Budget is ₹50,000', 'Build my plan', 'Show the menu']);
        } else if (c.eventType) {
            renderQuick(['Build my plan', 'Show veg options', 'My bookings']);
        } else {
            renderQuick(['Plan a birthday', 'Plan a wedding', 'Show the menu', 'What can you do?']);
        }
    }

    /* ------------------------------------------------------------------ *
     * Message queue — keeps replies ordered while the bot is "typing"
     * ------------------------------------------------------------------ */

    function sendText(raw) {
        var text = String(raw || '').trim();
        if (!text) return;
        if (!state.started) {
            state.started = true;
            if (!state.messages.length) welcome();
        }
        addMessage('user', text);
        renderQuick([]);
        if (els.input) {
            els.input.value = '';
            autoGrow();
        }
        queue.push(text);
        processQueue();
    }

    function processQueue() {
        if (processing || !queue.length) return;
        processing = true;
        var text = queue.shift();
        showTyping();
        var delay = clamp(360 + text.length * 9, 420, 1100);
        replyTimer = setTimeout(function () {
            hideTyping();
            Promise.resolve()
                .then(function () { return respond(text); })
                .then(function (reply) {
                    var value = reply || { text: 'Something went wrong on my side. Could you try that again?' };
                    addMessage('bot', value.text, { quick: value.quick });
                })
                .catch(function (error) {
                    addMessage('bot', 'I hit a snag: ' + ((error && error.message) || 'please try again.'));
                })
                .then(function () {
                    processing = false;
                    replyTimer = null;
                    processQueue();
                });
        }, delay);
    }

    function autoGrow() {
        if (!els.input) return;
        els.input.style.height = 'auto';
        els.input.style.height = Math.min(110, els.input.scrollHeight) + 'px';
    }

    /* ------------------------------------------------------------------ *
     * Navigation helpers
     * ------------------------------------------------------------------ */

    function goToTab(id) {
        var tab = document.getElementById(id);
        if (!tab) return false;
        tab.checked = true;
        closeChat();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return true;
    }

    function openBookingsModal() {
        var button = document.getElementById('myBookingsBtn');
        var gate = document.getElementById('authGate');
        if (!button || gate) return false;
        button.click();
        return true;
    }

    function openExternal(href) {
        if (!href) return false;
        window.open(href, '_blank', 'noopener');
        return true;
    }

    /* ------------------------------------------------------------------ *
     * Intent detection
     * ------------------------------------------------------------------ */

    function isAffirm(text) {
        return /\b(yes|yeah|yep|yup|sure|ok|okay|please|definitely|absolutely|go ahead|do it|sounds good|looks good|perfect|great|confirm|confirmed|apply|proceed|book it|book now)\b/.test(text);
    }

    function isDeny(text) {
        return /\b(no|nope|nah|not now|later|cancel|don'?t|do not|stop|never mind|nevermind|choose something else|something else|different plan|change it)\b/.test(text);
    }

    function detectIntent(text) {
        if (/\b(plan|organi[sz]e|arrange|host|throwing|celebrat(?:e|ing)|need|want|looking (?:for|to)|help me (?:plan|with))\b/.test(text) &&
            /\b(birthday|wedding|corporate|party|anniversary|event|function|baby shower|engagement|graduation|housewarming|reception|conference)\b/.test(text)) return 'info';
        if (/\b(plan another|another event|new event|different event|book another)\b/.test(text)) return 'newEvent';
        if (/\b(reset|start over|start again|new chat|clear chat|forget (?:everything|my event|this))\b/.test(text)) return 'reset';
        if (/\b(change|adjust|update|edit)\b[^.]*\b(budget|guests?|guest count|menu|decor|date|plan)\b|\b(change something|adjust the plan)\b/.test(text)) return 'change';
        if (/\b(make|keep|switch|use|go|include)\b[^.]*\b(veg|vegetarian|vegan|jain|non[\s-]?veg)\b/.test(text)) return 'diet';
        if (/\b(open|go to|take me to|navigate to)\b[^.]*\b(schedule|agenda|itinerary|venue|location|map|contact|menu|decor|rsvp|home)\b/.test(text)) return 'navigate';
        if (/\b(my bookings|my booking|booking status|reservations?|booked|past bookings|view bookings)\b/.test(text)) return 'bookings';
        if (/\b(contact|phone|email the team|email us|support|help me reach)\b/.test(text) || /\bcall\b/.test(text)) return 'contact';
        if (/\b(venue|location|address|map|where is|directions|parking)\b/.test(text)) return 'venue';
        if (/\b(schedule|itinerary|agenda|timings?|what happens|events? on|day wise|day-wise)\b/.test(text)) return 'schedule';
        if (/\b(help|what can you do|how can you help|who are you|features|capabilities)\b/.test(text)) return 'help';
        if (/^\s*(hi|hello|hey|hai|namaste|namaskar|good (?:morning|afternoon|evening)|yo)\b/.test(text)) return 'greeting';
        if (/\b(thanks|thank you|thankyou|thx|appreciate it)\b/.test(text)) return 'thanks';
        if (/\btry again\b/.test(text)) return 'affirm';
        if (/\b(cheaper|budget[\s-]?friendly|less expensive|reduce (?:the )?(?:cost|budget|price)|lower (?:the )?(?:cost|budget|price)|save money|too expensive)\b/.test(text)) return 'cheaper';
        if (/\b(upgrade|make it grand|premium|luxur(?:y|ious)|more elaborate|bigger package)\b/.test(text)) return 'upgrade';
        if (/\b(apply|use this plan|select (?:this|these)|go with (?:this|it)|set (?:it|this) up|add (?:it|these|this) to (?:my|the) (?:rsvp|booking))\b/.test(text)) return 'apply';
        if (/\b(book|reserve|rsvp|submit|finali[sz]e)\b/.test(text)) return 'book';
        if (/\b(build|prepare|create|make|show|see|what(?:'s| is)) (?:me )?(?:a |the )?(?:plan|package|quote|recommendation)|recommend|suggest|package|plan my|event plan|how much (?:will|would|does)|what(?:'s| is) the (?:cost|price|estimate)\b/.test(text)) return 'plan';
        if (/\b(menu|food|dish|dishes|starter|starters|main course|dessert|desserts|drink|drinks|beverage|beverages|veg|vegetarian|vegan|jain|paneer|chicken|naan|rice|brownie|rasmalai|cheesecake|mojito|coffee|chai|price|cost|per plate)\b/.test(text)) return 'menu';
        if (/\b(decor|decoration|decorations|theme|balloon|flower|flowers|light|lights|stage|backdrop|mandap|rangoli|garland)\b/.test(text)) return 'decor';
        if (/\b(open|go to|take me to|navigate|show me the)\b/.test(text)) return 'navigate';
        if (isAffirm(text)) return 'affirm';
        if (isDeny(text)) return 'deny';
        return 'unknown';
    }

    /* ------------------------------------------------------------------ *
     * Core reply router
     * ------------------------------------------------------------------ */

    async function respond(raw) {
        var analysis = extractEntities(raw);
        var text = analysis.text;
        var entities = analysis.entities;
        var intent = detectIntent(text);
        var merged = mergeContext(entities);

        if (intent === 'reset') {
            resetChat();
            return { text: 'Fresh start. What are we celebrating?' , quick: ['Plan a birthday', 'Plan a wedding', 'Show the menu'] };
        }

        if (intent === 'help') return helpReply();
        if (intent === 'greeting') return greetingReply();
        if (intent === 'thanks') return { text: 'Anytime! I am here whenever you want to adjust the menu, decor, budget or booking.', quick: renderQuickLabels() };

        if (state.expect) {
            var expected = await handleExpected(raw, analysis);
            if (expected) return expected;
            // Another topic interrupted the pending question — drop the slot
            // so the next message is not mistaken for an answer.
            state.expect = null;
            saveState();
        }

        if (state.pending === 'book') {
            if (isAffirm(text)) return submitBooking();
            if (isDeny(text)) {
                state.pending = null;
                saveState();
                return {
                    text: 'No problem — nothing has been submitted. Your selections are still saved on the RSVP page, so we can pick this up whenever you are ready.',
                    quick: ['Keep this plan', 'Change something', 'My bookings']
                };
            }
            // Any other topic replaces the pending confirmation so a later
            // "yes" cannot submit a stale booking by accident.
            state.pending = null;
            saveState();
        }

        if (state.pending === 'applyBook') {
            if (isAffirm(text)) {
                state.pending = null;
                saveState();
                if (!state.plan) state.plan = buildPlan(state.ctx);
                if (state.plan) applyPlan(state.plan);
                return continueBooking();
            }
            if (isDeny(text)) {
                state.pending = null;
                saveState();
                return {
                    text: 'Okay — I will not apply that plan. Tell me what you would like to change, or say **show menu** and I will suggest alternatives.',
                    quick: ['Show the menu', 'Make it vegetarian', 'Cheaper option']
                };
            }
            state.pending = null;
            saveState();
        }

        switch (intent) {
            case 'newEvent':
                return newEventReply();
            case 'change':
                return changeReply(text);
            case 'diet':
                return dietReply();
            case 'bookings':
                return bookingsReply();
            case 'contact':
                return contactReply(text);
            case 'venue':
                return venueReply();
            case 'schedule':
                return scheduleReply(analysis);
            case 'cheaper':
                return cheaperReply();
            case 'upgrade':
                return upgradeReply();
            case 'apply':
                return applyReply();
            case 'book':
                state.booking = true;
                return continueBooking();
            case 'plan':
                return planReply();
            case 'menu':
                return menuReply(analysis);
            case 'decor':
                return decorReply(analysis);
            case 'navigate':
                return navigateReply(text);
            case 'affirm':
                return affirmReply();
            case 'deny':
                return {
                    text: 'No problem. What would you like to adjust — the occasion, guest count, budget, menu or decor?',
                    quick: ['Change budget', 'Make it vegetarian', 'Show the menu']
                };
            default:
                if (merged.length) return infoReply(analysis, merged);
                return fallbackReply(raw);
        }
    }

    function renderQuickLabels() {
        if (state.plan && !state.applied) return ['Apply this plan', 'Book now', 'My bookings'];
        return ['Plan a birthday', 'Show the menu', 'My bookings'];
    }

    function newEventReply() {
        var name = state.ctx.name;
        var email = state.ctx.email;
        state.ctx = emptyContext();
        state.ctx.name = name;
        state.ctx.email = email;
        state.plan = null;
        state.pending = null;
        state.expect = null;
        state.booking = false;
        state.applied = false;
        saveState();
        return {
            text: 'Fresh event — let us plan it. What are we celebrating?',
            quick: ['Birthday', 'Wedding', 'Corporate event', 'Anniversary']
        };
    }

    function changeReply(text) {
        var c = state.ctx;
        if (/\bbudget\b/.test(text)) {
            state.expect = 'budget';
            return {
                text: 'What budget should I aim for? A rough figure works — for example **₹50,000** — or say **flexible**.',
                quick: ['₹50,000', '₹1,00,000', 'Flexible budget']
            };
        }
        if (/\b(guests?|guest count)\b/.test(text)) {
            state.expect = 'guests';
            return {
                text: 'How many guests should I plan for?',
                quick: ['50 guests', '100 guests', '200 guests']
            };
        }
        if (/\bmenu\b/.test(text)) {
            return menuReply({ text: ' menu ', dishes: [], decor: [] });
        }
        if (/\bdecor\b/.test(text)) {
            return decorReply({ text: ' decor ', dishes: [], decor: [] });
        }
        if (/\bdate\b/.test(text)) {
            return { text: 'Sure — what is the new date? For example **12 December** or **next Saturday**.' };
        }
        if (/\bplan\b/.test(text)) {
            return planReply();
        }
        return {
            text: 'What would you like to change — the budget, guest count, menu, decor or date?',
            quick: ['Change budget', 'Change guests', 'Change menu', 'Change decor']
        };
    }

    function dietReply() {
        var c = state.ctx;
        if (!c.eventType || !c.guests) {
            return {
                text: 'Noted — **' + dietLabel(c.diet) + '** menu. ' + missingQuestion(),
                quick: quickForSlots()
            };
        }
        if (!c.budget) {
            state.expect = 'budget';
            return {
                text: 'Noted — **' + dietLabel(c.diet) + '** menu. What budget should I aim for? A rough figure works, or say **flexible**.',
                quick: ['₹50,000', '₹1,00,000', 'Flexible budget']
            };
        }
        var wasApplied = state.applied;
        state.plan = buildPlan(c);
        state.applied = false;
        saveState();
        return {
            text: 'Switched to a **' + dietLabel(c.diet) + '** menu.\n\n' +
                planLines(state.plan, { compact: true }) +
                (wasApplied ? '\n\nSay **apply this plan** and I will update the selections on the RSVP page.' : '\n\nWould you like me to apply it?'),
            quick: ['Apply this plan', 'Make it cheaper', 'Book now']
        };
    }

    function helpReply() {
        return {
            text:
                '**I can be your event planner.** Try asking me to:\n' +
                '• Plan a birthday, wedding, corporate event or party\n' +
                '• Fit a menu and decor into a budget\n' +
                '• Filter vegetarian, vegan or Jain dishes\n' +
                '• Explain menu prices and decoration options\n' +
                '• Open the schedule, venue or contact details\n' +
                '• Apply a plan to the RSVP page and save the booking\n\n' +
                'I remember details across messages, so you can say *"birthday for 50"* and later *"my budget is ₹50,000"* — they stay on the same event.',
            quick: ['Plan a birthday for 50', 'Show the menu', 'Vegetarian options', 'My bookings']
        };
    }

    function greetingReply() {
        var c = state.ctx;
        if (c.eventType || c.guests || c.budget) {
            return {
                text: 'Hello again! Here is what I have so far: ' + contextSummary() + '.\n' +
                    (c.eventType && c.guests && c.budget
                        ? 'I can build the plan whenever you are ready.'
                        : missingQuestion()),
                quick: ['Build my plan', 'Change budget', 'Start over']
            };
        }
        return {
            text: 'Hello! I am **Bliss**, your AI event planner. What are we celebrating — a birthday, wedding, corporate event or something else?',
            quick: ['Birthday for 50', 'Plan a wedding', 'What can you do?']
        };
    }

    function contextSummary() {
        var c = state.ctx;
        var bits = [];
        if (c.eventType) bits.push(titleCase(eventTypeLabel(c.eventType)));
        if (c.guests) bits.push(c.guests + ' guests');
        if (c.budget) bits.push(inr(c.budget) + ' budget');
        if (c.diet) bits.push(dietLabel(c.diet));
        if (c.date) bits.push(c.date);
        if (c.time) bits.push(c.time);
        return bits.length ? bits.join(' · ') : 'no event details yet';
    }

    function missingQuestion() {
        var c = state.ctx;
        if (!c.eventType) return 'What are we celebrating — a birthday, wedding, or something else?';
        if (!c.guests) return 'How many guests are you expecting?';
        if (!c.budget) return 'What is your approximate budget? A rough figure like ₹50,000 is fine.';
        return '';
    }

    function infoReply(analysis, merged) {
        var c = state.ctx;
        var changedLine = merged.length ? 'Noted: **' + unique(merged).join(' · ') + '**.' : '';

        if (c.eventType && c.guests && c.budget) {
            state.plan = buildPlan(c);
            state.applied = false;
            saveState();
            return {
                text: changedLine + '\n\n' +
                    'For **' + c.guests + ' guests** within **' + inr(c.budget) + '**, I suggest this' +
                    (c.diet ? ' **' + dietLabel(c.diet) + '**' : '') + ' plan:\n\n' +
                    planLines(state.plan, { compact: true }) +
                    '\n\nWould you like me to apply it to the RSVP page?',
                quick: ['Apply this plan', 'Make it cheaper', 'Make it vegetarian', 'Book now']
            };
        }

        var question = missingQuestion();
        var extras = [];
        if (!c.diet) extras.push('Any dietary preference — vegetarian, non-vegetarian or no preference?');
        if (c.eventType && c.guests && !c.budget) {
            extras.push('If you do not have a fixed budget, just say **flexible**.');
        }

        return {
            text: (changedLine ? changedLine + '\n\n' : '') + question +
                (extras.length ? '\n\n' + extras.join(' ') : ''),
            quick: quickForSlots()
        };
    }

    function quickForSlots() {
        var c = state.ctx;
        if (!c.eventType) return ['Birthday', 'Wedding', 'Corporate event'];
        if (!c.guests) return ['50 guests', '100 guests', '200 guests'];
        if (!c.budget) return ['Budget ₹50,000', 'Budget ₹1,00,000', 'Flexible budget'];
        return ['Build my plan', 'Show the menu', 'Make it vegetarian'];
    }

    function planReply() {
        var c = state.ctx;
        if (!c.guests) {
            state.expect = 'guests';
            return {
                text: 'Happy to build it. ' + (c.eventType
                    ? 'How many guests are you expecting for the ' + eventTypeLabel(c.eventType) + '?'
                    : 'What are we celebrating, and roughly how many guests?'),
                quick: ['50 guests', '100 guests', '200 guests']
            };
        }
        if (!c.budget) {
            state.expect = 'budget';
            return {
                text: 'What budget should I aim for? A rough figure works — for example **₹50,000**. Or say **flexible** and I will use a mid-range plan.',
                quick: ['₹50,000', '₹1,00,000', 'Flexible budget']
            };
        }
        if (!c.eventType) {
            state.expect = 'occasion';
            return {
                text: 'Almost there — what is the occasion? Birthday, wedding, corporate event, baby shower, anniversary…?',
                quick: ['Birthday', 'Wedding', 'Corporate event', 'Anniversary']
            };
        }

        state.plan = buildPlan(c);
        state.applied = false;
        saveState();
        return {
            text: 'Here is what I would put together for your ' + eventTypeLabel(c.eventType) + ':\n\n' +
                planLines(state.plan) +
                '\n\nI can apply this to the RSVP page, or adjust it first.',
            quick: ['Apply this plan', 'Make it cheaper', 'Make it vegetarian', 'Book now']
        };
    }

    function cheaperReply() {
        var c = state.ctx;
        if (!c.guests) {
            state.expect = 'guests';
            return { text: 'How many guests should I plan for?', quick: ['50 guests', '100 guests'] };
        }
        if (c.budget) {
            c.budget = Math.max(5000, Math.round(c.budget * 0.8 / 500) * 500);
            if (c.budget < 5000) c.budget = 5000;
        } else {
            c.budgetFlexible = true;
            if (state.plan) c.tier = state.plan.tier === 'premium' ? 'signature' : 'essential';
        }
        if (state.plan && state.plan.tier === 'premium') c.tier = 'signature';
        else if (state.plan && state.plan.tier === 'signature') c.tier = 'essential';
        else c.tier = 'essential';

        state.plan = buildPlan(c);
        state.applied = false;
        saveState();
        return {
            text: 'I have tightened the plan to **' + inr(state.plan.total) + '** (' + inr(state.plan.perGuest) + '/guest).\n\n' +
                planLines(state.plan, { compact: true }),
            quick: ['Apply this plan', 'Book now', 'Make it vegetarian']
        };
    }

    function upgradeReply() {
        var c = state.ctx;
        if (!c.guests) {
            state.expect = 'guests';
            return { text: 'How many guests are we planning for?', quick: ['50 guests', '100 guests', '200 guests'] };
        }
        c.tier = state.plan && state.plan.tier === 'signature' ? 'premium' : 'signature';
        if (state.plan && state.plan.tier === 'essential') c.tier = 'signature';
        state.plan = buildPlan(c);
        state.applied = false;
        saveState();
        return {
            text: 'Upgraded to the **' + state.plan.label + '** plan — more variety in the menu and decor.\n\n' +
                planLines(state.plan, { compact: true }),
            quick: ['Apply this plan', 'Book now', 'Make it cheaper']
        };
    }

    function applyReply() {
        if (!state.plan) {
            if (state.ctx.eventType && state.ctx.guests && state.ctx.budget) {
                state.plan = buildPlan(state.ctx);
            } else {
                return planReply();
            }
        }
        applyPlan(state.plan);
        return {
            text: 'Done — I have selected the **' + state.plan.label + '** menu and decor on the RSVP page and set the guest count to **' + state.plan.guests + '**.\n\n' +
                'Menu + decor: **' + inr(state.plan.total) + '** · advance ' + inr(state.plan.advance) + '.\n\n' +
                'Review the selections, then say **book now** and I will save the RSVP for you.',
            quick: ['Book now', 'Adjust the plan', 'My bookings']
        };
    }

    function affirmReply() {
        if (state.plan && !state.plan.applied && !state.applied) {
            applyPlan(state.plan);
            return {
                text: 'Applied! Your menu and decor are selected on the RSVP page — **' + inr(state.plan.total) + '** for ' + state.plan.guests + ' guests. Say **book now** when you are ready to save it.',
                quick: ['Book now', 'Make it vegetarian', 'Change budget']
            };
        }
        if (state.ctx.eventType && state.ctx.guests && state.ctx.budget) {
            state.plan = buildPlan(state.ctx);
            state.applied = false;
            saveState();
            return {
                text: 'Great — here is the plan:\n\n' + planLines(state.plan, { compact: true }) +
                    '\n\nWould you like me to apply it to the RSVP page?',
                quick: ['Apply this plan', 'Make it vegetarian', 'Book now']
            };
        }
        return {
            text: missingQuestion() || 'Tell me a little more about the event and I will shape a plan.',
            quick: quickForSlots()
        };
    }

    /* ------------------------------------------------------------------ *
     * Information intents
     * ------------------------------------------------------------------ */

    function menuReply(analysis) {
        var text = analysis.text;
        var c = state.ctx;
        var wantsNonVeg = /\b(non[\s-]?veg|non[\s-]?vegetarian)\b/.test(text) || c.diet === 'nonveg';
        var wantsVeg = !wantsNonVeg && (/\bveg(?:etarian)?\b/.test(text) || c.diet === 'vegetarian' || c.diet === 'vegan' || c.diet === 'jain');
        var categoryFilter = null;
        if (/\b(dessert|desserts|sweet|sweets)\b/.test(text)) categoryFilter = 'Desserts';
        else if (/\b(starter|starters|appetizer|appetizers)\b/.test(text)) categoryFilter = 'Starters';
        else if (/\b(main course|mains|curry|curries)\b/.test(text)) categoryFilter = 'Main course';
        else if (/\b(side|sides|rice|naan|bread)\b/.test(text)) categoryFilter = 'Sides';
        else if (/\b(drink|drinks|beverage|beverages)\b/.test(text)) categoryFilter = 'Beverages';

        var pool = catalog.dishes.filter(function (dish) {
            if (categoryFilter && dish.category !== categoryFilter) return false;
            if (wantsNonVeg) return true;
            if (wantsVeg) return dish.veg;
            return true;
        });

        if (analysis.dishes.length) {
            var picked = analysis.dishes.map(function (dish) {
                var line = '**' + dish.name + '** — ' + inr(dish.cost) + ' per plate · ' +
                    (dish.veg ? 'vegetarian' : 'non-vegetarian') + ' · ' + dish.category;
                return line;
            }).join('\n');
            var message = picked;

            if (/\b(add|include|want|prefer|like)\b/.test(text)) {
                analysis.dishes.forEach(function (dish) {
                    if (state.ctx.favorites.indexOf(dish.id) < 0) state.ctx.favorites.push(dish.id);
                });
                invalidatePlan();
                saveState();
                message += '\n\nAdded to your preferences. I will include ' +
                    (analysis.dishes.length > 1 ? 'them' : 'it') + ' in the next plan.';
            }

            return {
                text: message + '\n\nPrices on the site are per plate. Tell me your guest count and I will estimate the total.' +
                    (state.ctx.diet && wantsNonVeg ? '' : ''),
                quick: ['Build my plan', 'Show full menu', 'Vegetarian options']
            };
        }

        var groups = {};
        pool.forEach(function (dish) {
            if (!groups[dish.category]) groups[dish.category] = [];
            groups[dish.category].push(dish);
        });

        var lines = [];
        Object.keys(groups).forEach(function (category) {
            lines.push('**' + category + '**');
            lines.push(groups[category].map(function (dish) {
                return '• ' + dish.name + ' — ' + inr(dish.cost) + (dish.veg ? ' 🌱' : '');
            }).join('\n'));
        });

        var header = wantsNonVeg ? 'Here is the full menu:' : (wantsVeg ? 'Here are the vegetarian options:' : 'Here is the menu:');
        return {
            text: header + '\n\n' + lines.join('\n\n') +
                '\n\n🌱 = vegetarian. Dishes run from ' + inr(30) + ' to ' + inr(180) + ' per plate.',
            quick: ['Vegetarian options', 'Non-veg options', 'Desserts', 'Build my plan']
        };
    }

    function decorReply(analysis) {
        if (analysis.decor.length) {
            var lines = analysis.decor.map(function (item) {
                return '• **' + item.name + '** — ' + inr(item.cost);
            });
            return {
                text: 'Decor pricing:\n' + lines.join('\n') +
                    '\n\nDecor is priced per arrangement for the event, while dishes are per plate. I can fit a set into your budget.',
                quick: ['Apply this plan', 'Show decor for a birthday', 'Build my plan']
            };
        }

        var names = EVENT_DECOR[state.ctx.eventType] || EVENT_DECOR.party;
        var suggestions = names.map(function (name) {
            var item = decorByName(name);
            return item ? '• ' + item.name + ' — ' + inr(item.cost) : null;
        }).filter(Boolean);

        return {
            text: 'For a **' + eventTypeLabel(state.ctx.eventType) + '**, I would start with:\n' +
                suggestions.join('\n') +
                '\n\nDecor on the site runs from ' + inr(220) + ' to ' + inr(700) + ' per item. Tell me your budget and guest count and I will include the best mix.',
            quick: ['Build my plan', 'Show the menu', 'Make it premium']
        };
    }

    function scheduleReply(analysis) {
        var text = analysis.text;
        var dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        var requested = null;
        dayNames.forEach(function (day) {
            if (text.indexOf(day) >= 0) requested = day;
        });

        if (!catalog.schedule.length) {
            return { text: 'The full schedule is on the Schedule page — I can take you there.', quick: ['Open schedule'] };
        }

        if (requested) {
            var day = catalog.schedule.filter(function (entry) {
                return entry.title.toLowerCase().indexOf(requested) >= 0;
            })[0];
            if (day) {
                var details = day.lines.map(function (line) { return '• ' + line; });
                var items = day.items.slice(0, 7).map(function (item) { return '• ' + item; });
                if (day.items.length > 7) items.push('• +' + (day.items.length - 7) + ' more');
                return {
                    text: '**' + day.title + '**\n' + details.concat(items).join('\n'),
                    quick: ['Open schedule', 'Venue details', 'Contact the team']
                };
            }
        }

        var lines = catalog.schedule.map(function (entry) {
            var time = entry.lines[0] || '';
            return '• **' + entry.title + '**' + (time ? ' — ' + time : '');
        });

        return {
            text: 'The celebration runs across seven days:\n' + lines.join('\n') +
                '\n\nAsk me about any day, or open the full schedule for the detailed agenda.',
            quick: ['Open schedule', 'Venue details', 'Contact the team']
        };
    }

    function contactReply(text) {
        var lowered = String(text || '');
        if (/\bemail\b/.test(lowered) && !/\bphone|call\b/.test(lowered)) {
            window.location.href = catalog.contact.emailHref;
            return {
                text: 'Opening your email app to reach **' + catalog.contact.email + '**. You can also call **' + catalog.contact.phone + '**.',
                quick: ['Call the team', 'Book now']
            };
        }
        if (/\b(call|phone)\b/.test(lowered)) {
            window.location.href = catalog.contact.phoneHref;
            return {
                text: 'Calling **' + catalog.contact.phone + '**. If your device does not open the dialer, the number is above.',
                quick: ['Email the team', 'Book now']
            };
        }
        return {
            text: 'You can reach the Bliss Bloom team here:\n' +
                '• Email: **' + catalog.contact.email + '**\n' +
                '• Phone: **' + catalog.contact.phone + '**\n\n' +
                'For bookings, the fastest path is to let me prepare the plan and submit the RSVP — then the team follows up to confirm the visit.',
            quick: ['Email the team', 'Call the team', 'Book now']
        };
    }

    function venueReply() {
        var address = catalog.venue.address ||
            'Celebration Hall, Cambridge Institute of Technology, Bengaluru.';
        var pref = state.ctx.venuePref ? '\n\nYou mentioned preferring an **' + state.ctx.venuePref + '** setting — note that on the RSVP and the team can discuss options at the visit.' : '';
        return {
            text: '**Event venue**\n' + address + pref +
                '\n\nThe venue page has a QR code and a Google Maps link for directions.',
            quick: ['Open venue page', 'Open in Maps', 'Contact the team', 'Book now']
        };
    }

    function navigateReply(text) {
        if (/\b(map|directions|location)\b/.test(text) && catalog.venue.mapHref) {
            openExternal(catalog.venue.mapHref);
            return { text: 'Opening the venue in Google Maps.', quick: ['Open venue page', 'Book now'] };
        }
        if (/\b(menu|dish|decor)/.test(text)) {
            goToTab('decor-tab');
            return { text: 'Opened Dishes & Decor.', quick: ['Show the menu', 'Build my plan'] };
        }
        if (/\b(schedule|agenda|itinerary)/.test(text)) {
            goToTab('schedule-tab');
            return { text: 'Opened the event schedule.', quick: ['Schedule for Tuesday', 'Venue details'] };
        }
        if (/\b(venue|location|address)/.test(text)) {
            goToTab('venue-tab');
            return { text: 'Opened the venue page.', quick: ['Open in Maps', 'Contact the team'] };
        }
        if (/\b(contact|phone|email)/.test(text)) {
            goToTab('contact-tab');
            return { text: 'Opened the contact page.', quick: ['Email the team', 'Call the team'] };
        }
        if (/\b(rsvp|booking|reserve)/.test(text)) {
            goToTab('rsvp-tab');
            return { text: 'Opened the RSVP page.', quick: ['Book now', 'My bookings'] };
        }
        if (/\b(home|main page)/.test(text)) {
            goToTab('home-tab');
            return { text: 'Back to the home page.', quick: ['Build my plan', 'Show the menu'] };
        }
        return fallbackReply(text);
    }

    async function bookingsReply() {
        var opened = openBookingsModal();
        var rows = null;

        if (window.BlissDB && typeof window.BlissDB.listMyRsvps === 'function') {
            try {
                rows = await withTimeout(window.BlissDB.listMyRsvps(), 8000);
            } catch (error) {
                rows = null;
            }
        }

        if (Array.isArray(rows)) {
            if (!rows.length) {
                return {
                    text: (opened ? 'I opened My Bookings. ' : '') +
                        'You do not have any saved RSVPs yet.\n\nGive me an occasion, guest count and budget and I will prepare one you can submit in a couple of taps.',
                    quick: ['Plan a birthday', 'Plan a wedding', 'Book now']
                };
            }
            var lines = rows.slice(0, 3).map(function (row) {
                var total = Number(row.totalCost) || 0;
                return '• **#' + row.id + '** · ' + (row.guests || '?') + ' guests · ' + inr(total) +
                    ' · ' + (row.status || 'pending');
            });
            return {
                text: (opened ? 'Opening My Bookings. ' : '') + 'You have **' + rows.length + '** saved RSVP' +
                    (rows.length === 1 ? '' : 's') + ':\n' + lines.join('\n'),
                quick: ['Book another event', 'Show the menu', 'Start over']
            };
        }

        if (opened) {
            return { text: 'Opening your saved bookings now.', quick: ['Book another event', 'Show the menu'] };
        }

        return {
            text: 'I could not load bookings right now. You can open **My Bookings** from the gear menu, or try again in a moment.',
            quick: ['Try again', 'Book now']
        };
    }

    /* ------------------------------------------------------------------ *
     * Slot answers (when the assistant asked a direct question)
     * ------------------------------------------------------------------ */

    async function handleExpected(raw, analysis) {
        var text = analysis.text;
        var entities = analysis.entities;
        var strong = ['menu', 'decor', 'venue', 'schedule', 'contact', 'bookings', 'help', 'reset'];
        var intent = detectIntent(text);
        if (strong.indexOf(intent) >= 0) return null;

        // A short "cancel"/"never mind" stops the current capture instead of
        // being read as a name, email or guest count.
        if (/^\s*(cancel|never ?mind|stop|quit|no|nope|nah|not now|later)\s*[.!]?\s*$/i.test(raw)) {
            var wasBooking = state.booking;
            state.expect = null;
            state.booking = false;
            saveState();
            return {
                text: wasBooking
                    ? 'Okay — I have paused the booking. Your selections stay on the RSVP page, and nothing has been submitted.'
                    : 'Okay, cancelled. What would you like to do next?',
                quick: ['Keep this plan', 'Show the menu', 'My bookings']
            };
        }

        if (state.expect === 'name') {
            var name = entities.name || cleanName(raw);
            if (!name) {
                return { text: 'I did not catch a valid name. Please type the name the booking should be under — for example, **Ravi Kumar**.' };
            }
            state.ctx.name = name;
            state.expect = null;
            saveState();
            if (state.booking) return continueBooking();
            return { text: 'Nice to meet you, **' + name + '**. ' + (missingQuestion() || 'Tell me what you would like to change.'), quick: quickForSlots() };
        }

        if (state.expect === 'email') {
            if (!entities.email) {
                return { text: 'That does not look like an email. Please type a valid address such as **name@example.com**.' };
            }
            state.ctx.email = entities.email;
            state.expect = null;
            saveState();
            if (state.booking) return continueBooking();
            return { text: 'Saved **' + entities.email + '**. ' + (missingQuestion() || 'What would you like to do next?'), quick: quickForSlots() };
        }

        if (state.expect === 'guests') {
            var guests = entities.guests;
            if (!guests) {
                var m = raw.match(/\b(\d{1,4}(?:,\d{3})*)\b/);
                if (m) guests = toNumber(m[1]);
            }
            if (!guests || guests < 1 || guests > 5000) {
                return { text: 'How many guests should I plan for? A number between 1 and 5,000 works.' };
            }
            state.ctx.guests = Math.round(guests);
            invalidatePlan();
            state.expect = null;
            saveState();
            if (state.booking) return continueBooking();
            if (state.ctx.eventType && state.ctx.budget) {
                state.plan = buildPlan(state.ctx);
                return {
                    text: 'Set to **' + state.ctx.guests + ' guests**.\n\n' + planLines(state.plan, { compact: true }),
                    quick: ['Apply this plan', 'Book now', 'Make it vegetarian']
                };
            }
            return {
                text: 'Set to **' + state.ctx.guests + ' guests**. ' + missingQuestion(),
                quick: quickForSlots()
            };
        }

        if (state.expect === 'budget') {
            if (/\b(flexible|no idea|not sure|don'?t know|whatever|you decide|no budget|any budget)\b/.test(text)) {
                state.ctx.budgetFlexible = true;
                state.ctx.budget = null;
                delete state.ctx.tier;
                invalidatePlan();
                state.expect = null;
                saveState();
                if (state.booking) return continueBooking();
                if (state.ctx.eventType && state.ctx.guests) {
                    state.plan = buildPlan(state.ctx);
                    return {
                        text: 'No problem — I will use a sensible mid-range plan and you can tighten it later.\n\n' +
                            planLines(state.plan, { compact: true }),
                        quick: ['Apply this plan', 'Make it cheaper', 'Book now']
                    };
                }
                return { text: 'No problem. ' + missingQuestion(), quick: quickForSlots() };
            }

            var budget = entities.budget;
            if (!budget) {
                var amount = raw.match(/([\d,]+(?:\.\d+)?)\s*(k|lakh|lac)?/i);
                if (amount) {
                    budget = formatAmount(amount[1], amount[2]);
                    if (budget && budget < 1000) budget *= 1000;
                }
            }
            if (!budget || budget < 1000) {
                return { text: 'Just a rough figure in rupees works — for example **₹50,000**. Or say **flexible**.' };
            }
            state.ctx.budget = Math.round(budget);
            state.ctx.budgetFlexible = false;
            delete state.ctx.tier;
            invalidatePlan();
            state.expect = null;
            saveState();
            if (state.booking) return continueBooking();
            if (state.ctx.eventType && state.ctx.guests) {
                state.plan = buildPlan(state.ctx);
                return {
                    text: 'Budget set to **' + inr(state.ctx.budget) + '**.\n\n' +
                        planLines(state.plan, { compact: true }) +
                        '\n\nWould you like me to apply it to the RSVP page?',
                    quick: ['Apply this plan', 'Make it cheaper', 'Book now']
                };
            }
            return { text: 'Budget set to **' + inr(state.ctx.budget) + '**. ' + missingQuestion(), quick: quickForSlots() };
        }

        if (state.expect === 'occasion') {
            if (!entities.eventType) {
                return {
                    text: 'What is the occasion? For example a birthday, wedding, corporate event, baby shower or anniversary.',
                    quick: ['Birthday', 'Wedding', 'Corporate event', 'Anniversary']
                };
            }
            state.ctx.eventType = entities.eventType;
            invalidatePlan();
            state.expect = null;
            saveState();
            if (state.booking) return continueBooking();
            return {
                text: 'A **' + eventTypeLabel(entities.eventType) + '** — lovely. ' + missingQuestion(),
                quick: quickForSlots()
            };
        }

        return null;
    }

    /* ------------------------------------------------------------------ *
     * Booking flow
     * ------------------------------------------------------------------ */

    async function continueBooking() {
        var c = state.ctx;
        state.booking = true;

        // Reuse anything already typed into the real RSVP form.
        var nameField = document.getElementById('name');
        var emailField = document.getElementById('email');
        var guestField = document.getElementById('guests');
        if (!c.name && nameField && nameField.value.trim()) c.name = nameField.value.trim();
        if (!c.email && emailField && emailField.value.trim()) c.email = emailField.value.trim();
        if (!c.guests && guestField) {
            var formGuests = parseInt(guestField.value, 10);
            if (formGuests > 0) c.guests = formGuests;
        }

        if (!c.eventType) {
            state.expect = 'occasion';
            return {
                text: 'I can save the RSVP for you. First — what are we celebrating?',
                quick: ['Birthday', 'Wedding', 'Corporate event', 'Anniversary']
            };
        }
        if (!c.guests) {
            state.expect = 'guests';
            return {
                text: 'How many guests should the booking be for?',
                quick: ['50 guests', '100 guests', '200 guests']
            };
        }

        if (selectedCount() === 0) {
            if (!state.plan) state.plan = buildPlan(c);
            if (state.plan) {
                state.pending = 'applyBook';
                saveState();
                return {
                    text: 'I have a plan ready:\n\n**' + state.plan.label + '** · ' + state.plan.guests +
                        ' guests · menu + decor **' + inr(state.plan.total) + '** · advance ' + inr(state.plan.advance) + '.\n\n' +
                        'Shall I apply it to the RSVP page and continue?',
                    quick: ['Yes, apply', 'Choose something else']
                };
            }
        }

        if (!c.name) {
            state.expect = 'name';
            saveState();
            return {
                text: 'Great — the items are selected. What name should the booking be under?',
                quick: []
            };
        }
        if (!c.email) {
            state.expect = 'email';
            saveState();
            return {
                text: 'Which email should I use for the confirmation?',
                quick: []
            };
        }

        return confirmBooking();
    }

    function confirmBooking() {
        var nameInput = document.getElementById('name');
        var emailInput = document.getElementById('email');
        if (nameInput && state.ctx.name) nameInput.value = state.ctx.name;
        if (emailInput && state.ctx.email) emailInput.value = state.ctx.email;

        var payload = collectPayload();
        if (!payload.items.length) return applyReply();

        var dishCount = payload.items.filter(function (item) { return item.type === 'dish'; }).length;
        var decorCount = payload.items.length - dishCount;
        var schedule = [state.ctx.date, state.ctx.time].filter(Boolean).join(' · ');
        state.pending = 'book';
        state.expect = null;
        saveState();

        return {
            text: 'Ready to submit your RSVP:\n' +
                '• Name: **' + state.ctx.name + '**\n' +
                '• Email: **' + state.ctx.email + '**\n' +
                '• Guests: **' + payload.guests + '**\n' +
                (schedule ? '• When: **' + schedule + '**\n' : '') +
                '• Items: **' + dishCount + ' dishes**' + (decorCount ? ' and **' + decorCount + ' decor items**' : '') + '\n' +
                '• Menu + decor: **' + inr(payload.totalCost) + '**\n' +
                '• Advance (30%): **' + inr(payload.advancePayment) + '**\n\n' +
                'Reply **confirm** and I will save it. You can still cancel or change anything first.',
            quick: ['Confirm booking', 'Cancel']
        };
    }

    async function submitBooking() {
        if (!state.ctx.name) {
            state.expect = 'name';
            return { text: 'What name should the booking be under?' };
        }
        if (!state.ctx.email) {
            state.expect = 'email';
            return { text: 'Which email should I use for the confirmation?' };
        }

        var payload = collectPayload();
        if (!payload.items.length) {
            state.pending = null;
            return {
                text: 'There are no items selected on the RSVP page right now. I can apply the plan again first.',
                quick: ['Apply this plan', 'Show the menu']
            };
        }

        if (!window.BlissDB || typeof window.BlissDB.addRsvp !== 'function') {
            state.pending = null;
            return {
                text: 'The booking service is not ready yet. Please reload the page, or submit the RSVP form directly — your selections are already filled in.',
                quick: ['Open RSVP form', 'Try again']
            };
        }

        try {
            var result = await withTimeout(window.BlissDB.addRsvp(payload), 15000,
                'The online database did not respond in time');
            state.pending = null;
            state.booking = false;
            state.applied = true;
            saveState();
            return {
                text: '**Booking saved!** 🎉\n' +
                    'Booking ID: **' + result.id + '**\n' +
                    'Guests: **' + payload.guests + '** · menu + decor **' + inr(payload.totalCost) + '** · advance ' + inr(payload.advancePayment) + '.\n\n' +
                    (result.local
                        ? 'This was saved on this device in demo mode because the online database is not connected.'
                        : 'The team will review your RSVP and contact you to confirm the visit.') +
                    '\n\nYou can revisit it any time under **My Bookings**.',
                quick: ['View my bookings', 'Plan another event', 'Show the menu']
            };
        } catch (error) {
            var reason = ((error && error.message) || 'unknown error').replace(/\.+$/, '');
            return {
                text: 'I could not save the booking: ' + reason + '.\n\n' +
                    'Your selections are safe on the RSVP page. Say **confirm** to try again, or submit the form manually.',
                quick: ['Confirm booking', 'Open RSVP form']
            };
        }
    }

    function fallbackReply(raw) {
        if (/\b(flexible|no idea|not sure|don'?t know)\b/i.test(raw)) {
            state.ctx.budgetFlexible = true;
            state.ctx.budget = null;
            delete state.ctx.tier;
            invalidatePlan();
            if (state.ctx.eventType && state.ctx.guests) {
                state.plan = buildPlan(state.ctx);
                saveState();
                return {
                    text: 'Understood — I will work without a fixed cap.\n\n' + planLines(state.plan, { compact: true }),
                    quick: ['Apply this plan', 'Make it cheaper', 'Book now']
                };
            }
        }

        return {
            text: 'I can help with planning, menus, decor, budgets, the schedule, the venue and bookings.\n\n' +
                'Try something like *"Plan a birthday for 50 guests with a ₹50,000 budget"* or tap a suggestion below.',
            quick: ['Plan a birthday', 'Plan a wedding', 'Show the menu', 'What can you do?']
        };
    }

    /* ------------------------------------------------------------------ *
     * Boot
     * ------------------------------------------------------------------ */

    function bindEvents() {
        if (els.launcher) els.launcher.addEventListener('click', toggleChat);
        if (els.close) els.close.addEventListener('click', closeChat);
        if (els.reset) els.reset.addEventListener('click', resetChat);
        if (els.teaser) els.teaser.addEventListener('click', openChat);

        if (els.form) {
            els.form.addEventListener('submit', function (event) {
                event.preventDefault();
                sendText(els.input ? els.input.value : '');
            });
        }

        if (els.input) {
            els.input.addEventListener('input', autoGrow);
            els.input.addEventListener('keydown', function (event) {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    sendText(els.input.value);
                }
            });
        }

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && state.open) closeChat();
        });

        var brandBtn = document.getElementById('brandBtn');
        var themeBtn = document.getElementById('themeBtn');
        if (brandBtn) brandBtn.addEventListener('click', closeChat);
        if (themeBtn) themeBtn.addEventListener('click', closeChat);
    }

    function startTeaser() {
        if (state.messages.length || state.open) return;
        var seen = false;
        try { seen = sessionStorage.getItem('blissChatTeaserSeen') === '1'; } catch (e) {}
        if (seen) return;
        teaserTimer = setTimeout(function () {
            teaserTimer = null;
            if (state.open || state.messages.length) return;
            if (els.teaser) els.teaser.hidden = false;
            try { sessionStorage.setItem('blissChatTeaserSeen', '1'); } catch (e) {}
        }, 3200);
    }

    document.addEventListener('DOMContentLoaded', function () {
        cacheElements();
        if (!els.launcher || !els.panel) return;

        loadCatalog();
        loadState();
        seedIdentity();

        if (state.plan && !state.ctx.guests) state.plan = null;
        if (state.ctx.eventType && state.ctx.diet) {
            state.plan = state.plan || buildPlan(state.ctx);
        }

        bindEvents();
        startTeaser();
    });
})();
