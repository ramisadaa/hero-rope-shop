/* Store controller. Product/cart calculations live in store-core.js. */
(() => {
    "use strict";
    document.documentElement.classList.replace("no-js", "js");
    const Core = window.ShopCore;
    const API_URL = "https://fakestoreapi.com/products";
    const CART_KEY = "shopCart"; // Preserves the original hero-rope cart.
    const DRAFT_KEY = "customerDraft";
    const CATALOG_KEY = "shopCatalogV2";
    const RECEIPT_KEY = "shopLastReceiptV2";
    const $ = selector => document.querySelector(selector);
    const ui = {
        header: $(".site-header"), products: $(".products"), loading: $(".loading-state"),
        error: $(".error-state"), empty: $(".empty-state"), count: $(".result-count"),
        search: $("#search"), category: $("#category"), sort: $("#sort"),
        cartButton: $(".cart"), popup: $(".popup"), closeCart: $(".close-popup"),
        cartBody: $(".popup-body"), cartItems: $(".cart-items"), emptyCart: $(".empty-cart"),
        cartFooter: $(".popup-footer"), cartCount: $(".counter"), cartTotal: $(".total-price"),
        cartNote: $(".cart-price-note"), storageNote: $(".storage-message"),
        checkoutButton: $(".checkout-button"), checkout: $(".checkout-screen"),
        checkoutItems: $(".checkout-items"), checkoutCount: $(".checkout-count"),
        checkoutTotal: $(".checkout-total"), checkoutNote: $(".checkout-availability"),
        form: $(".checkout-form"), name: $("#customer-name"), email: $("#customer-email"),
        card: $("#card-number"), expiry: $("#card-expiry"), cvv: $("#card-cvv"),
        draftNote: $(".draft-message"), checkoutMessage: $(".checkout-message"),
        submit: $(".place-order-button"), success: $(".checkout-success"),
        detail: $(".product-dialog"), info: $(".info-dialog"), toast: document.body.querySelector(":scope > .toast")
    };
    const state = { products: [], cart: [], status: "loading", confirmedOrder: null, detailId: null, source: "sample", refreshing: false };
    let currentRequest = null, requestNumber = 0, previousDetailTrigger, draftTimer, migratedLegacy = false, migrationNotice = "";
    const toastActions = new WeakMap(), toastTimers = new WeakMap(), cartRows = new Map();

    function node(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function imageFor(product, className = "", eager = false) {
        const fallback = () => node("span", "image-unavailable", "Image unavailable");
        if (!product.image) return fallback();
        const image = node("img", className);
        image.alt = ""; // The adjacent name / button label already identifies the product.
        image.loading = eager ? "eager" : "lazy";
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";
        image.width = 200;
        image.height = 180;
        image.addEventListener("error", () => image.replaceWith(fallback()), { once: true });
        image.src = product.image;
        return image;
    }



    function showToast(message, undo) {
        const dialog = document.querySelector("dialog[open]");
        const toast = dialog?.querySelector(".dialog-toast") || ui.toast;
        const live = dialog?.querySelector(".modal-live") || $(".page-live");
        live.textContent = "";
        requestAnimationFrame(() => { live.textContent = message + (undo ? " Undo is available." : ""); });
        clearTimeout(toastTimers.get(toast));
        toast.querySelector(".toast-text").textContent = message;
        toast.querySelector(".toast-undo").hidden = !undo;
        toastActions.set(toast, undo);
        toast.classList.add("visible");
        if (!undo) toastTimers.set(toast, setTimeout(() => toast.classList.remove("visible"), 4500));
    }



    function storageWarning(message = "") {
        ui.storageNote.textContent = message;
        ui.storageNote.hidden = !message;
    }

    function loadCart() {
        try {
            const saved = localStorage.getItem(CART_KEY);
            const legacy = saved === null ? localStorage.getItem("my-shop-cart-v1") : null;
            const record = JSON.parse(saved ?? legacy ?? "[]");
            migratedLegacy = legacy !== null;
            if (record?.version === 2 && Array.isArray(record.items)) {
                const catalog = new Map(state.products.map(product => [product.id, product]));
                return Core.normalizeCart(record.items.slice(0, Core.MAX_ITEMS).flatMap(item => {
                    if (!Number.isSafeInteger(item.id) || item.id < 1 || !Number.isSafeInteger(item.quoteCents) || item.quoteCents < 0 || item.quoteCents > 100000000) return [];
                    return [{ ...(catalog.get(item.id) || { id: item.id, title: `Product #${item.id}`, price: item.quoteCents / 100, image: "", category: "Other" }), quantity: item.quantity, quoteCents: item.quoteCents }];
                }));
            }
            const result = Core.normalizeCart(record);
            if (Array.isArray(record) && (record.length > result.length || record.some(item => item?.quantity > Core.MAX_QUANTITY))) migrationNotice = "Saved cart entries were checked; duplicate, oversized or invalid entries were normalized.";
            return result;
        } catch {
            migrationNotice = "Saved cart could not be read. A new in-memory cart has been started.";
            storageWarning(migrationNotice);
            return [];
        }
    }



    function saveCart() {
        try {
            const items = state.cart.map(item => ({ id: item.id, quantity: item.quantity, quoteCents: item.quoteCents ?? Core.unitCents(item) }));
            localStorage.setItem(CART_KEY, JSON.stringify({ version: 2, items }));
            if (migratedLegacy) { localStorage.removeItem("my-shop-cart-v1"); migratedLegacy = false; }
            storageWarning();
        } catch { storageWarning("Your browser could not save the cart. Keep this tab open to retain it."); }
    }



    function saveDraft() {
        clearTimeout(draftTimer);
        try {
            sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ name: ui.name.value, email: ui.email.value }));
            ui.draftNote.hidden = true;
        } catch {
            ui.draftNote.textContent = "Your browser could not save this name and email for the session.";
            ui.draftNote.hidden = false;
        }
    }

    function restoreDraft() {
        try {
            const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "{}");
            if (!draft || typeof draft !== "object") return;
            ui.name.value = typeof draft.name === "string" ? draft.name.slice(0, 100) : "";
            ui.email.value = typeof draft.email === "string" ? draft.email.slice(0, 254) : "";
        } catch {
            ui.draftNote.textContent = "Saved customer details could not be restored.";
            ui.draftNote.hidden = false;
        }
    }

    function clearDraft() {
        try { sessionStorage.removeItem(DRAFT_KEY); }
        catch { /* The cart and form still work when browser storage is blocked. */ }
    }

    function cartIssue() {
        if (!state.cart.length) return "Your cart is empty.";
        if (state.status === "loading") return "Checking the latest product prices…";
        if (state.status === "error") return "Reload the products before checkout so prices can be checked.";
        if (state.cart.some(item => item.available === false)) return "Remove unavailable products before checkout.";
        if (state.cart.some(item => item.priceChanged)) return "Prices have changed. Review the highlighted prices and accept them before checkout.";
        return "";
    }

    function emitCatalog() {
        document.dispatchEvent(new CustomEvent("shop:catalog", { detail: { status: state.status } }));
    }

    function updateOverlayState() {
        const active = !!document.querySelector("dialog[open]");
        document.body.classList.toggle("modal-open", active);
        document.dispatchEvent(new CustomEvent("shop:overlay", { detail: { active } }));
    }

    // Keep Tab/Shift+Tab inside the modal, including browsers that allow a
    // transient focus stop on browser chrome after the dialog's final control.
    [ui.detail, ui.checkout, ui.info].forEach(dialog => dialog.addEventListener("keydown", event => {
        if (event.key !== "Tab") return;
        const controls = Array.from(dialog.querySelectorAll(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]'
        )).filter(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
        if (!controls.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }));

    async function loadProducts() {
        currentRequest?.abort();
        const id = ++requestNumber;
        state.refreshing = true;
        ui.error.hidden = true;
        ui.loading.hidden = state.products.length > 0;
        document.querySelectorAll(".refresh-catalog,.retry-button").forEach(button => { button.disabled = true; });
        updateCatalogMessage();
        let lastError;
        for (let attempt = 0; attempt < 2; attempt++) {
            const controller = new AbortController();
            currentRequest = controller;
            const timeout = setTimeout(() => controller.abort(), 6000);
            try {
                const response = await fetch(API_URL, { signal: controller.signal, cache: "no-store" });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const products = Core.normalizeProducts(await response.json());
                if (id !== requestNumber) return;
                applyCatalog(products, "live");
                try { localStorage.setItem(CATALOG_KEY, JSON.stringify({ version: 2, savedAt: Date.now(), products })); } catch { /* In-memory and packaged catalogs remain usable. */ }
                state.refreshing = false;
                finish();
                return;
            } catch (error) {
                lastError = error;
                if (id !== requestNumber) return;
            } finally { clearTimeout(timeout); }
            if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 350));
        }
        if (id !== requestNumber) return;
        state.refreshing = false;
        if (!state.products.length) { ui.error.hidden = false; state.status = "error"; }
        $(".page-alert").textContent = state.products.length
            ? "The live catalog is unavailable. The displayed backup collection remains usable for demo orders."
            : "Products could not be loaded. Please retry.";
        console.info("Live catalog unavailable; retaining displayed catalog.", lastError?.name);
        finish();
        function finish() {
            ui.loading.hidden = true;
            ui.products.setAttribute("aria-busy", "false");
            document.querySelectorAll(".refresh-catalog,.retry-button").forEach(button => { button.disabled = false; });
            updateCatalogMessage();
            renderCart();
            emitCatalog();
            currentRequest = null;
        }
    }

    function updateCatalogMessage() {
        const panel = $(".catalog-message");
        panel.hidden = state.source === "live" && !state.refreshing;
        const label = state.source === "cache" ? "Saved catalog — prices may be out of date." : state.source === "sample" ? "Offline sample catalog — illustrative demo products and prices." : "Live catalog.";
        panel.querySelector("p").textContent = label + (state.refreshing ? " Checking for live updates…" : " You can continue using this demo or retry the live catalog.");
    }

    function applyCatalog(products, source) {
        state.products = products;
        state.source = source;
        state.status = "ready";
        state.cart = Core.reconcileCart(state.cart, products);
        if (ui.detail.open && state.detailId) {
            const displayed = products.find(product => product.id === state.detailId);
            $(".detail-add").disabled = !displayed;
            if (displayed) $(".detail-price").textContent = Core.formatCents(Core.unitCents(displayed));
        }
        populateCategories();
        saveCart();
        renderProducts();
        renderCart();
        if (ui.checkout.open && !state.confirmedOrder) renderCheckout();
        updateCatalogMessage();
        emitCatalog();
    }



    function populateCategories() {
        const previous = ui.category.value;
        ui.category.replaceChildren(new Option("All categories", "all"));
        [...new Set(state.products.map(product => product.category))].sort().forEach(category => {
            ui.category.add(new Option(Core.categoryLabel(category), category));
        });
        ui.category.value = [...ui.category.options].some(option => option.value === previous) ? previous : "all";
    }

    function productButton(text, action, id, className) {
        const button = node("button", className, text);
        button.type = "button";
        button.dataset.action = action;
        button.dataset.productId = id;
        return button;
    }

    function createProductCard(product, index = 10) {
        const card = node("article", "product-card");
        const media = productButton("", "details", product.id, "product-media");
        media.setAttribute("aria-label", `View details of ${product.title}`);
        media.tabIndex = -1;
        media.appendChild(imageFor(product, "", index < 4));
        const content = node("div", "product-content");
        const title = node("h3", "", product.title);
        title.title = product.title;
        const details = productButton("View details", "details", product.id, "view-details");
        details.setAttribute("aria-label", `View details of ${product.title}`);
        const add = productButton("+ Add to cart", "add", product.id, "add-to-cart");
        add.setAttribute("aria-label", `Add ${product.title} to cart`);
        const bottom = node("div", "product-bottom");
        bottom.append(node("p", "product-price", Core.formatCents(Core.unitCents(product))), add);
        content.append(node("p", "product-category", Core.categoryLabel(product.category)), title,
            node("p", "product-description", product.description), details, bottom);
        card.append(media, content);
        return card;
    }

    function renderProducts() {
        if (state.status !== "ready") return;
        const visible = Core.filterProducts(state.products, ui.search.value, ui.category.value, ui.sort.value);
        ui.products.replaceChildren(...visible.map(createProductCard));
        ui.empty.hidden = visible.length > 0;
        ui.count.textContent = `${visible.length} ${visible.length === 1 ? "product" : "products"}`;
    }

    function commitCart(focusIntent) {
        saveCart();
        renderCart(focusIntent);
        if (ui.checkout.open && !state.confirmedOrder) renderCheckout();
        document.dispatchEvent(new CustomEvent("shop:cart"));
    }

    function addToCart(id) {
        const product = state.products.find(item => item.id === id);
        if (!product || state.status !== "ready") { showToast("Wait for the products to load first."); return false; }
        const next = Core.addItem(state.cart, product);
        if (next === state.cart) { showToast(`Maximum ${Core.MAX_QUANTITY} pieces per product.`); return false; }
        state.cart = next;
        commitCart();
        showToast("Added to your cart");
        return true;
    }

    function renderCart(focusIntent) {
        const scroll = ui.cartBody.scrollTop;
        const quantity = Core.totalQuantity(state.cart);
        ui.cartCount.textContent = quantity;
        ui.cartButton.setAttribute("aria-label", `Shopping cart, ${quantity} ${quantity === 1 ? "item" : "items"}`);
        ui.emptyCart.hidden = state.cart.length > 0;
        ui.cartFooter.hidden = state.cart.length === 0;
        ui.cartTotal.textContent = Core.formatCents(Core.totalCents(state.cart));
        const issue = state.cart.length ? cartIssue() : "";
        ui.cartNote.textContent = issue;
        ui.cartNote.hidden = !issue;
        ui.checkoutButton.disabled = !!cartIssue();
        document.querySelectorAll(".accept-prices").forEach(button => { button.hidden = !state.cart.some(item => item.priceChanged); });
        const ids = new Set(state.cart.map(item => item.id));
        for (const [id, refs] of cartRows) if (!ids.has(id)) { refs.row.remove(); cartRows.delete(id); }
        state.cart.forEach((item, index) => {
            let refs = cartRows.get(item.id);
            if (!refs) {
                const row = node("li", "cart-item"), media = node("div", "cart-image-slot"), content = node("div", "cart-item-details"), controls = node("div", "cart-controls");
                const minus = productButton("−", "decrease", item.id, "quantity-button");
                const plus = productButton("+", "increase", item.id, "quantity-button");
                const remove = productButton("Remove", "remove", item.id, "remove-item");
                const count = node("span", "quantity-value"), heading = node("h3"), total = node("p"), note = node("p", "price-change-note");
                controls.append(minus, count, plus, remove);content.append(heading, total, note, controls);row.append(media, content);
                refs = { row, media, minus, plus, remove, count, heading, total, note, imageUrl: null };cartRows.set(item.id, refs);
                ui.cartItems.appendChild(row);
            }
            refs.heading.textContent = item.title;
            refs.total.textContent = `${Core.formatCents(Core.unitCents(item))} × ${item.quantity} = ${Core.formatCents(Core.subtotalCents(item))}`;
            refs.count.textContent = item.quantity;
            refs.minus.setAttribute("aria-label", `Decrease quantity of ${item.title}`);
            refs.plus.setAttribute("aria-label", `Increase quantity of ${item.title}`);
            refs.remove.setAttribute("aria-label", `Remove ${item.title}`);
            refs.plus.disabled = item.quantity >= Core.MAX_QUANTITY || state.status !== "ready" || item.available === false;
            refs.note.hidden = item.available !== false && !item.priceChanged;
            refs.note.textContent = item.available === false ? "Currently unavailable" : item.priceChanged ? `Price changed: ${Core.formatCents(item.quoteCents)} → ${Core.formatCents(Core.unitCents(item))}. Your acceptance is required.` : "";
            if (refs.imageUrl !== item.image) { refs.media.replaceChildren(imageFor(item, "cart-item-image")); refs.imageUrl = item.image; }
            if (ui.cartItems.children[index] !== refs.row) ui.cartItems.insertBefore(refs.row, ui.cartItems.children[index] || null);
        });
        ui.cartBody.scrollTop = scroll;
        if (focusIntent) {
            const replacement = ui.cartItems.querySelector(`button[data-product-id="${focusIntent.id}"][data-action="${focusIntent.action}"]`);
            if (replacement && !replacement.disabled) replacement.focus();
            else (ui.cartItems.querySelector("button:not(:disabled)") || ui.closeCart).focus();
        }
    }



    function closeCart(restoreFocus = false) {
        ui.popup.hidden = true;
        ui.cartButton.setAttribute("aria-expanded", "false");
        if (restoreFocus) ui.cartButton.focus();
    }

    function openDetails(id, trigger, updateUrl = true) {
        const product = state.products.find(item => item.id === id);
        if (!product) return;
        previousDetailTrigger = trigger;
        if (updateUrl) history.replaceState(null, "", `#product-${id}`);
        state.detailId = id;
        $(".detail-media").replaceChildren(imageFor(product));
        $(".detail-category").textContent = Core.categoryLabel(product.category);
        $("#detail-title").textContent = product.title;
        $(".detail-description").textContent = product.description;
        $(".detail-price").textContent = Core.formatCents(Core.unitCents(product));
        ui.detail.showModal();
        $(".close-detail").focus();
        updateOverlayState();
    }

    function renderCheckout() {
        const items = state.confirmedOrder?.items || state.cart;
        ui.checkoutItems.replaceChildren(...items.map(item => {
            const row = node("tr");
            const productCell = node("td");
            const product = node("div", "checkout-product");
            product.append(imageFor(item), node("span", "", item.title));
            productCell.appendChild(product);
            const quantityCell = node("td", "", item.quantity);
            const priceCell = node("td", "", Core.formatCents(Core.unitCents(item)));
            const subtotalCell = node("td", "", Core.formatCents(Core.subtotalCents(item)));
            quantityCell.dataset.label = "Quantity";
            priceCell.dataset.label = "Price";
            subtotalCell.dataset.label = "Subtotal";
            row.append(productCell, quantityCell, priceCell, subtotalCell);
            return row;
        }));
        ui.checkoutCount.textContent = Core.totalQuantity(items);
        ui.checkoutTotal.textContent = Core.formatCents(Core.totalCents(items));
        const issue = state.confirmedOrder ? "" : cartIssue();
        ui.checkoutNote.textContent = issue;
        ui.checkoutNote.hidden = !issue;
        ui.submit.disabled = !!issue || !!state.confirmedOrder;
    }

    function resetForm() {
        ui.form.reset();
        ui.form.querySelectorAll("input").forEach(input => input.setCustomValidity(""));
    }

    function openCheckout() {
        const issue = cartIssue();
        if (issue) { showToast(issue); return; }
        state.confirmedOrder = null;
        resetForm();
        ui.draftNote.hidden = true;
        restoreDraft();
        ui.form.hidden = false;
        ui.success.hidden = true;
        ui.checkoutMessage.textContent = "";
        ui.submit.textContent = "Confirm Demo Order";
        renderCheckout();
        closeCart();
        ui.checkout.showModal();
        ui.checkout.scrollTop = 0;
        ui.name.focus();
        updateOverlayState();
    }

    function validateCheckout() {
        [ui.name, ui.card, ui.expiry, ui.cvv].forEach(input => input.setCustomValidity(""));
        if (!ui.name.value.trim()) ui.name.setCustomValidity("Please enter your name.");
        if (ui.card.value.replace(/[\s-]/g, "") !== "4242424242424242") ui.card.setCustomValidity("Demo only: use 4242 4242 4242 4242. Do not enter a real card.");
        if (!Core.validExpiry(ui.expiry.value)) ui.expiry.setCustomValidity("Use MM/YY or MM/YYYY with this month or a later expiry date.");
        if (ui.cvv.value !== "123") ui.cvv.setCustomValidity("Use test CVV 123 only.");
        return ui.form.reportValidity();
    }



    ui.products.addEventListener("click", event => {
        const button = event.target.closest("button[data-product-id]");
        if (!button || !ui.products.contains(button)) return;
        const id = Number(button.dataset.productId);
        if (button.dataset.action === "add") addToCart(id);
        else openDetails(id, button);
    });
    ui.cartItems.addEventListener("click", event => {
        const button = event.target.closest("button[data-product-id]");
        if (!button || button.disabled) return;
        const id = Number(button.dataset.productId), action = button.dataset.action;
        const item = state.cart.find(product => product.id === id);
        if (!item) return;
        if (action === "increase" && (state.status !== "ready" || item.available === false)) return;
        const removed = action === "remove" || (action === "decrease" && item.quantity === 1) ? [{ ...item }] : [];
        state.cart = action === "remove" ? Core.removeItem(state.cart, id) : Core.changeQuantity(state.cart, id, action === "increase" ? 1 : -1);
        commitCart({ id, action });
        if (removed.length) showToast("Product removed", () => restoreRemoved(removed));
    });
    ui.cartButton.addEventListener("click", () => {
        ui.popup.hidden = !ui.popup.hidden;
        ui.cartButton.setAttribute("aria-expanded", String(!ui.popup.hidden));
        if (!ui.popup.hidden) ui.closeCart.focus();
    });
    ui.closeCart.addEventListener("click", () => closeCart(true));
    $(".clear-cart").addEventListener("click", () => {
        const removed = state.cart.map(item => ({ ...item }));
        state.cart = [];
        commitCart();
        ui.closeCart.focus();
        showToast("Cart cleared", () => restoreRemoved(removed));
    });
    document.addEventListener("click", event => {
        // Quantity edits replace their button; the original event path stays valid.
        if (!ui.popup.hidden && !event.composedPath().includes(ui.popup.parentElement)) closeCart();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !ui.popup.hidden) { event.preventDefault(); closeCart(true); }
    });
    ui.search.addEventListener("input", renderProducts);
    ui.category.addEventListener("change", renderProducts);
    ui.sort.addEventListener("change", renderProducts);
    $(".reset-filters").addEventListener("click", () => {
        ui.search.value = ""; ui.category.value = "all"; ui.sort.value = "default";
        renderProducts(); ui.search.focus();
    });
    $(".retry-button").addEventListener("click", loadProducts);
    $(".refresh-catalog").addEventListener("click", loadProducts);
    $(".close-detail").addEventListener("click", () => ui.detail.close());
    $(".detail-add").addEventListener("click", () => addToCart(state.detailId));
    ui.detail.addEventListener("close", () => {
        if (location.hash.startsWith("#product-")) history.replaceState(null, "", location.pathname + location.search);
        updateOverlayState();
        if (previousDetailTrigger?.isConnected) previousDetailTrigger.focus();
    });
    ui.detail.addEventListener("click", event => {
        if (event.target !== ui.detail) return;
        const box = ui.detail.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) ui.detail.close();
    });
    ui.checkoutButton.addEventListener("click", openCheckout);
    $(".back-to-shop").addEventListener("click", () => ui.checkout.close());
    $(".continue-shopping").addEventListener("click", () => ui.checkout.close());
    ui.checkout.addEventListener("close", () => {
        if (!state.confirmedOrder) saveDraft();
        resetForm();
        updateOverlayState();
        ui.cartButton.focus();
    });
    [ui.name, ui.email].forEach(input => {
        input.addEventListener("input", () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 250); });
        input.addEventListener("change", saveDraft);
    });
    ui.form.querySelectorAll("input").forEach(input => input.addEventListener("input", () => input.setCustomValidity("")));
    ui.card.addEventListener("blur", () => {
        const digits = ui.card.value.replace(/[\s-]/g, "");
        if (/^[0-9]{16}$/.test(digits)) ui.card.value = digits.match(/.{4}/g).join(" ");
    });
    ui.form.addEventListener("submit", event => {
        event.preventDefault();
        if (state.confirmedOrder) return;
        const issue = cartIssue();
        if (issue) { ui.checkoutMessage.textContent = issue; return; }
        if (!validateCheckout()) return;
        const name = ui.name.value.trim();
        const items = state.cart.map(item => ({ ...item }));
        const total = Core.totalCents(items);
        state.confirmedOrder = { items, total, reference: `DEMO-${newReference()}`, createdAt: new Date().toISOString() };
        saveReceipt(state.confirmedOrder);
        clearTimeout(draftTimer);
        ui.submit.disabled = true;
        state.cart = [];
        commitCart();
        resetForm();
        clearDraft();
        renderCheckout();
        ui.form.hidden = true;
        ui.success.hidden = false;
        $(".success-summary").textContent = `Thank you, ${name}. ${state.confirmedOrder.reference} · ${Core.formatCents(total)} · ${Core.totalQuantity(items)} ${Core.totalQuantity(items) === 1 ? "item" : "items"}.`;
        ui.success.querySelector("h3").focus();
    });
    window.addEventListener("storage", event => {
        if (event.storageArea !== localStorage || (event.key !== CART_KEY && event.key !== null)) return;
        state.cart = loadCart();
        if (state.status === "ready") state.cart = Core.reconcileCart(state.cart, state.products);
        const active = document.activeElement;
        const intent = ui.cartItems.contains(active) && active.dataset.productId
            ? { id: Number(active.dataset.productId), action: active.dataset.action } : null;
        renderCart(intent);
        if (ui.checkout.open && !state.confirmedOrder) {
            renderCheckout();
            showToast("Your cart was updated in another tab.");
        }
        document.dispatchEvent(new CustomEvent("shop:cart"));
    });

    const shareUrl = new URL(window.location.href);
    shareUrl.hash = "";
    $(".share-facebook").href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl.href)}`;
    $(".share-twitter").href = `https://x.com/intent/tweet?text=${encodeURIComponent("Good finds at My Shop")}&url=${encodeURIComponent(shareUrl.href)}`;
    [$(".share-facebook"), $(".share-twitter")].forEach(link => link.addEventListener("click", event => {
        if (shareUrl.protocol === "file:") { event.preventDefault(); showToast("Share this store after hosting it at a web address."); }
    }));
    $(".share-copy").addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(shareUrl.href); showToast("Page link copied"); }
        catch { showToast("Copy this page’s address from your browser to share it."); }
    });

    function measureHeader() {
        document.documentElement.style.setProperty("--header-height", `${ui.header.getBoundingClientRect().height}px`);
    }
    if ("ResizeObserver" in window) new ResizeObserver(measureHeader).observe(ui.header);
    else window.addEventListener("resize", measureHeader);
    measureHeader();

    function restoreRemoved(items) {
        state.cart = Core.reconcileCart(Core.normalizeCart([...state.cart, ...items]), state.products);
        commitCart();
        showToast("Cart items restored");
    }
    document.querySelectorAll(".toast").forEach(toast => {
        toast.querySelector(".toast-undo").addEventListener("click", () => { const undo = toastActions.get(toast); toastActions.delete(toast); toast.classList.remove("visible"); undo?.(); });
        toast.querySelector(".toast-close").addEventListener("click", () => { toast.classList.remove("visible"); toastActions.delete(toast); });
    });
    document.querySelectorAll(".accept-prices").forEach(button => button.addEventListener("click", () => {
        state.cart = state.cart.map(item => ({ ...item, quoteCents: Core.unitCents(item), priceChanged: false }));
        commitCart();
        (ui.checkout.open ? ui.name : ui.checkoutButton).focus();
        showToast("Updated prices accepted");
    }));
    function newReference() {
        if (crypto.randomUUID) return crypto.randomUUID();
        return Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, "0")).join("");
    }
    function saveReceipt(receipt) {
        try {
            localStorage.setItem(RECEIPT_KEY, JSON.stringify({ version: 2, reference: receipt.reference, createdAt: receipt.createdAt, items: receipt.items.map(({ id, title, price, quantity }) => ({ id, title, price, quantity, image: "" })) }));
            $(".receipt-note").hidden = true;
            $(".view-receipt").hidden = false;
        } catch { $(".receipt-note").textContent = "This receipt is available only in this tab because storage is blocked."; $(".receipt-note").hidden = false; }
    }
    function loadReceipt() {
        try {
            const record = JSON.parse(localStorage.getItem(RECEIPT_KEY) || "null");
            if (record?.version !== 2 || typeof record.reference !== "string" || !/^DEMO-[a-f0-9-]{32,36}$/i.test(record.reference) || !Number.isFinite(Date.parse(record.createdAt))) return null;
            const items = Core.normalizeCart(record.items);
            return items.length ? { ...record, items, total: Core.totalCents(items) } : null;
        } catch { return null; }
    }
    $(".view-receipt").addEventListener("click", () => {
        const receipt = loadReceipt();
        if (!receipt) { showToast("No saved demo receipt is available."); return; }
        state.confirmedOrder = receipt;
        resetForm(); ui.form.hidden = true; ui.success.hidden = false;
        $(".success-summary").textContent = `${receipt.reference} · ${Core.formatCents(receipt.total)} · ${new Date(receipt.createdAt).toLocaleString("en")}`;
        renderCheckout(); closeCart(); ui.checkout.showModal(); ui.success.querySelector("h3").focus(); updateOverlayState();
    });
    const infoText = {
        about: ["About My Shop", "My Shop is a JavaScript learning project with a surprise rope, a cart and a local demo checkout. It does not sell or deliver products. No business contact details have been supplied; the footer links share this demo rather than representing merchant accounts."],
        privacy: ["Demo privacy", "The cart, the last successful catalog and the latest demo receipt are stored in this browser. The session draft contains only your name and email. Card fields are never saved or sent. Product images and live catalog requests contact Fake Store API without a referrer. Use Clear saved store data to remove this demo’s stored data."],
        terms: ["Demo terms", "This is a simulated USD storefront, not a merchant checkout. Offline sample prices are illustrative. No payments, shipping, tax calculation, returns or fulfillment occur. Live service availability is outside this demo’s control. These notes describe the demo and are not production merchant policies."]
    };
    document.querySelectorAll(".open-info").forEach(button => button.addEventListener("click", () => {
        const [title, text] = infoText[button.dataset.info];
        $("#info-title").textContent = title; $(".info-body").replaceChildren(node("p", "", text));
        $(".clear-saved-data").hidden = button.dataset.info !== "privacy";
        ui.info.showModal(); $(".close-info").focus(); updateOverlayState();
    }));
    $(".close-info").addEventListener("click", () => ui.info.close());
    ui.info.addEventListener("close", updateOverlayState);
    $(".clear-saved-data").addEventListener("click", () => {
        clearTimeout(draftTimer); currentRequest?.abort(); requestNumber++; currentRequest = null; state.refreshing = false;
        document.querySelectorAll(".refresh-catalog,.retry-button").forEach(button => { button.disabled = false; });
        updateCatalogMessage();
        try {
            [CART_KEY, CATALOG_KEY, RECEIPT_KEY, "my-shop-cart-v1"].forEach(key => localStorage.removeItem(key));
            sessionStorage.removeItem(DRAFT_KEY);
            state.cart = []; renderCart(); resetForm(); $(".view-receipt").hidden = true;
            showToast("Saved store data cleared");
        } catch { showToast("Browser storage is blocked; data could not be cleared."); }
    });

    // A small, read-only product API for the rope; no scraping of product cards.
    window.MyShop = Object.freeze({
        getProducts: () => state.status === "ready" ? state.products.map(product => ({ ...product })) : [],
        getCatalogStatus: () => state.status,
        getCatalogSource: () => state.source,
        addToCart,
        formatPrice: price => Core.formatCents(Math.round(price * 100))
    });
    let catalog = Core.normalizeProducts(window.OfflineCatalog);
    let source = "sample";
    try {
        const cached = JSON.parse(localStorage.getItem(CATALOG_KEY) || "null");
        if (cached?.version === 2 && Number.isFinite(cached.savedAt) && cached.savedAt <= Date.now() && Array.isArray(cached.products)) {
            const valid = Core.normalizeProducts(cached.products);
            if (valid.length) { catalog = valid; source = "cache"; }
        }
    } catch { /* A packaged catalog is always available. */ }
    state.products = catalog;
    state.cart = loadCart();
    applyCatalog(catalog, source);
    if (migrationNotice) showToast(migrationNotice);
    loadProducts();
    window.addEventListener("pagehide", () => { if (ui.checkout.open && !state.confirmedOrder) saveDraft(); });
    window.addEventListener("scroll", () => ui.header.classList.toggle("scrolled", scrollY > 8), { passive: true });
    $(".year").textContent = new Date().getFullYear();
    $(".view-receipt").hidden = !loadReceipt();
    const deepLink = /^#product-([0-9]+)$/.exec(location.hash);
    if (deepLink) {
        const openLinkedProduct = () => {
            if (state.products.some(product => product.id === Number(deepLink[1]))) { openDetails(Number(deepLink[1]), null, false); document.removeEventListener("shop:catalog", openLinkedProduct); }
        };
        document.addEventListener("shop:catalog", openLinkedProduct);
        openLinkedProduct();
    }
})();
