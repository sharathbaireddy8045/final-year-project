(function () {
    var THEMES = {
        gold:     { name: 'Bliss Gold',        bg: '#0b0a07', panel: '#15130e', panel2: '#1c1912', border: '#2f2a1f', text: '#f5f1e6', muted: '#9c9583', accent: '#e8c96a', rgb: '232, 201, 106' },
        cyber:    { name: 'Cyber Night',       bg: '#0a0a0b', panel: '#141416', panel2: '#1a1a1d', border: '#2a2a2e', text: '#f2f2f2', muted: '#8a8a92', accent: '#ff6b35', rgb: '255, 107, 53' },
        sunset:   { name: 'Sunset Ember',      bg: '#140b07', panel: '#1c120c', panel2: '#241710', border: '#3a281d', text: '#f6ede7', muted: '#a8968a', accent: '#ff9f43', rgb: '255, 159, 67' },
        violet:   { name: 'Aurora Violet',     bg: '#0d0714', panel: '#150d1f', panel2: '#1d1229', border: '#332146', text: '#f1e9f9', muted: '#a292b5', accent: '#b06bff', rgb: '176, 107, 255' },
        ocean:    { name: 'Ocean Deep',        bg: '#040f14', panel: '#0a1a21', panel2: '#0e222b', border: '#1c3a47', text: '#e8f6fa', muted: '#88a8b3', accent: '#38bdf8', rgb: '56, 189, 248' },
        midnight: { name: 'Midnight Blue',     bg: '#04070f', panel: '#0a0f1c', panel2: '#0d1424', border: '#1c2740', text: '#e8edf9', muted: '#8a97b3', accent: '#5b8cff', rgb: '91, 140, 255' },
        magma:    { name: 'Magma Red',         bg: '#100404', panel: '#1a0808', panel2: '#220b0b', border: '#3d1616', text: '#fbeaea', muted: '#b58a8a', accent: '#ff4d4d', rgb: '255, 77, 77' },
        forest:   { name: 'Forest Moss',       bg: '#04100a', panel: '#081a12', panel2: '#0b2217', border: '#173a29', text: '#e9f7ef', muted: '#8ab39e', accent: '#4ade80', rgb: '74, 222, 128' },
        graphite: { name: 'Titanium Graphite', bg: '#0b0b0d', panel: '#141417', panel2: '#1a1a1e', border: '#2c2c31', text: '#f0f0f2', muted: '#909096', accent: '#c9ced6', rgb: '201, 206, 214' }
    };

    var STORAGE_KEY = 'blissTheme2';

    function applyBlissTheme(key) {
        var valid = !!THEMES[key];
        var t = valid ? THEMES[key] : THEMES.gold;
        var root = document.documentElement;
        var style = root.style;
        style.setProperty('--accent', t.accent);
        style.setProperty('--accent-rgb', t.rgb);
        style.setProperty('--page-bg', t.bg);
        style.setProperty('--panel', t.panel);
        style.setProperty('--panel-2', t.panel2);
        style.setProperty('--panel-border', t.border);
        style.setProperty('--text', t.text);
        style.setProperty('--muted', t.muted);
        root.setAttribute('data-theme', valid ? key : 'gold');
        try { localStorage.setItem(STORAGE_KEY, valid ? key : 'gold'); } catch (e) {}
        return valid ? key : 'gold';
    }

    window.BLISS_THEMES = THEMES;
    window.applyBlissTheme = applyBlissTheme;

    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    applyBlissTheme(THEMES[saved] ? saved : 'gold');
})();
