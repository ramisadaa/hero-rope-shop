/* Shared, DOM-independent product and cart rules. Also usable by Node tests. */
(function (root, factory) {
    "use strict";
    const core = factory();
    if (typeof module === "object" && module.exports) module.exports = core;
    else root.ShopCore = core;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const MAX_QUANTITY = 99;
    const MAX_ITEMS = 200;
    const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

    function safeImageUrl(value) {
        if (typeof value !== "string") return "";
        if (/^assets\/[a-z0-9-]+\.(?:svg|png|webp)$/.test(value)) return value;
        try {
            const url = new URL(value);
            return url.protocol === "https:" ? url.href : "";
        } catch { return ""; }
    }

    function normalizeProduct(value) {
        if (!value || !Number.isSafeInteger(value.id) || value.id < 1 ||
            typeof value.title !== "string" || !value.title.trim() ||
            typeof value.price !== "number" || !Number.isFinite(value.price) ||
            value.price < 0 || value.price > 1000000) return null;
        return {
            id: value.id,
            title: value.title.trim().slice(0, 300),
            description: typeof value.description === "string" ? value.description.slice(0, 3000) : "",
            category: typeof value.category === "string" && value.category.trim() ? value.category.trim().slice(0, 100) : "Other",
            price: Math.round(value.price * 100) / 100,
            image: safeImageUrl(value.image)
        };
    }

    function normalizeProducts(values) {
        if (!Array.isArray(values)) throw new TypeError("Unexpected product data");
        const unique = new Map();
        values.forEach(value => {
            const product = normalizeProduct(value);
            if (product) unique.set(product.id, product);
        });
        const products = [...unique.values()].sort((a, b) => a.id - b.id);
        if (values.length && !products.length) throw new TypeError("No valid products returned");
        return products;
    }

    function normalizeCart(values) {
        if (!Array.isArray(values)) return [];
        const unique = new Map();
        values.slice(0, MAX_ITEMS).forEach(value => {
            const product = normalizeProduct(value);
            if (!product || !Number.isSafeInteger(value.quantity) || value.quantity < 1) return;
            const previous = unique.get(product.id);
            const quantity = Math.min(MAX_QUANTITY, value.quantity);
            const quoteCents = Number.isSafeInteger(value.quoteCents) && value.quoteCents >= 0 && value.quoteCents <= 100000000
                ? value.quoteCents : Math.round(product.price * 100);
            unique.set(product.id, { ...product, quoteCents, quantity: Math.min(MAX_QUANTITY, (previous?.quantity || 0) + quantity) });
        });
        return [...unique.values()];
    }

    function reconcileCart(cart, products) {
        const latest = new Map(products.map(product => [product.id, product]));
        return cart.map(item => {
            const current = latest.get(item.id);
            const quoteCents = item.quoteCents ?? unitCents(item);
            return { ...(current || item), quoteCents, quantity: item.quantity,
                available: !!current, priceChanged: !!current && quoteCents !== unitCents(current) };
        });
    }

    function addItem(cart, product) {
        const existing = cart.find(item => item.id === product.id);
        if (existing?.quantity >= MAX_QUANTITY) return cart;
        if (existing) return cart.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
        if (cart.length >= MAX_ITEMS) return cart;
        return [...cart, { ...product, quoteCents: unitCents(product), quantity: 1, available: true, priceChanged: false }];
    }

    function changeQuantity(cart, id, delta) {
        if (!Number.isSafeInteger(delta)) return cart;
        return cart.map(item => item.id === id ? { ...item, quantity: Math.min(MAX_QUANTITY, Math.max(0, item.quantity + delta)) } : item)
            .filter(item => item.quantity > 0);
    }

    function removeItem(cart, id) { return cart.filter(item => item.id !== id); }
    function unitCents(item) { return Math.round(item.price * 100); }
    function subtotalCents(item) { return unitCents(item) * item.quantity; }
    function totalCents(cart) { return cart.reduce((sum, item) => sum + subtotalCents(item), 0); }
    function totalQuantity(cart) { return cart.reduce((sum, item) => sum + item.quantity, 0); }
    function formatCents(value) { return money.format(value / 100); }

    function words(value) {
        return (value.toLocaleLowerCase("en-US").normalize("NFKD").replace(/['’]s\b/g, "").match(/[\p{L}\p{N}]+/gu) || [])
            .map(word => word === "mens" ? "men" : word === "womens" ? "women" : word);
    }
    function categoryLabel(value) {
        return ({ "men's clothing": "Men’s clothing", "women's clothing": "Women’s clothing", jewelery: "Jewelry", electronics: "Electronics" })[value]
            || value.replace(/^./, character => character.toUpperCase());
    }
    function filterProducts(products, query = "", category = "all", sort = "default") {
        const terms = [...new Set(words(query))];
        const scores = new Map();
        const visible = products.filter(product => {
            if (category !== "all" && product.category !== category) return false;
            const fields = [words(product.title), words(product.category), words(product.description)];
            let score = 0;
            for (const term of terms) {
                const index = fields.findIndex(tokens => tokens.some(word => word.startsWith(term)));
                if (index === -1) return false;
                score += [12, 5, 1][index];
            }
            scores.set(product.id, score);
            return true;
        });
        if (sort === "default" && terms.length) visible.sort((a, b) => scores.get(b.id) - scores.get(a.id) || a.id - b.id);
        if (sort === "price-low") visible.sort((a, b) => a.price - b.price || a.id - b.id);
        if (sort === "price-high") visible.sort((a, b) => b.price - a.price || a.id - b.id);
        if (sort === "name") visible.sort((a, b) => a.title.localeCompare(b.title, "en", { numeric: true, sensitivity: "base" }) || a.id - b.id);
        return visible;
    }

    function validExpiry(value, today = new Date()) {
        const match = /^(0[1-9]|1[0-2])\/([0-9]{2}|20[0-9]{2})$/.exec(value.trim());
        const year = match && (match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]));
        return !!match && new Date(year, Number(match[1]), 1) > today;
    }

    function createShufflePicker(random = Math.random) {
        let bag = [], signature = "", previous = null;
        return function pick(products) {
            if (!products.length) return null;
            const nextSignature = products.map(product => product.id).sort((a, b) => a - b).join(",");
            if (signature !== nextSignature) { signature = nextSignature; bag = []; }
            if (!bag.length) {
                bag = products.map(product => product.id);
                for (let i = bag.length - 1; i > 0; i--) {
                    const j = Math.floor(random() * (i + 1));
                    [bag[i], bag[j]] = [bag[j], bag[i]];
                }
                if (bag.length > 1 && bag[bag.length - 1] === previous) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
            }
            const id = bag.pop();
            previous = id;
            return products.find(product => product.id === id);
        };
    }

    return Object.freeze({ MAX_QUANTITY, MAX_ITEMS, normalizeProduct, normalizeProducts, normalizeCart,
        reconcileCart, addItem, changeQuantity, removeItem, unitCents, subtotalCents, totalCents,
        totalQuantity, formatCents, filterProducts, validExpiry, safeImageUrl, categoryLabel, createShufflePicker });
});
