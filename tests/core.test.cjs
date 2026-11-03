"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../store-core.js");
const product = (id = 1, price = 10) => ({ id, title: `Product ${id}`, price, image: "https://example.com/item.jpg", category: id % 2 ? "clothing" : "tech", description: "Everyday essentials" });

test("normalizes valid products and limits untrusted text", () => {
    const result = Core.normalizeProduct({ ...product(), title: "  Backpack  ", description: "x".repeat(5000) });
    assert.equal(result.title, "Backpack");
    assert.equal(result.description.length, 3000);
});
test("rejects invalid ids, prices and empty names", () => {
    for (const patch of [{ id: 0 }, { id: -1 }, { id: 1.5 }, { price: "10" }, { price: NaN }, { price: Infinity }, { price: -1 }, { price: 1000001 }, { title: " " }]) {
        assert.equal(Core.normalizeProduct({ ...product(), ...patch }), null);
    }
});
test("accepts only HTTPS product images", () => {
    assert.equal(Core.safeImageUrl("javascript:alert(1)"), "");
    assert.equal(Core.safeImageUrl("http://example.com/image.jpg"), "");
    assert.equal(Core.safeImageUrl("bad url"), "");
    assert.equal(Core.safeImageUrl("https://example.com/image.jpg"), "https://example.com/image.jpg");
});
test("catalog deduplicates ids and keeps stable id ordering", () => {
    assert.deepEqual(Core.normalizeProducts([product(2), product(1), product(2, 20)]).map(item => [item.id, item.price]), [[1, 10], [2, 20]]);
    assert.throws(() => Core.normalizeProducts({ products: [] }));
    assert.throws(() => Core.normalizeProducts([{ id: 0 }]));
    assert.deepEqual(Core.normalizeProducts([]), []);
});
test("cart restoration rejects malformed values", () => {
    assert.deepEqual(Core.normalizeCart(null), []);
    assert.deepEqual(Core.normalizeCart([null, { ...product(), quantity: "2" }, { ...product(), quantity: 0 }]), []);
});
test("cart restoration merges duplicate ids and caps quantity", () => {
    const cart = Core.normalizeCart([{ ...product(), quantity: 70 }, { ...product(), quantity: 60 }, { ...product(2), quantity: 10000 }]);
    assert.equal(cart.length, 2);
    assert.deepEqual(cart.map(item => item.quantity), [99, 99]);
});
test("restoration limits the number of stored entries", () => {
    const saved = Array.from({ length: 1000 }, (_, i) => ({ ...product(i + 1), quantity: 1 }));
    assert.equal(Core.normalizeCart(saved).length, 200);
});
test("adding items is immutable and increases the existing line", () => {
    const old = [{ ...product(), quantity: 1 }];
    const result = Core.addItem(old, product());
    assert.equal(old[0].quantity, 1);
    assert.equal(result[0].quantity, 2);
    assert.equal(result.length, 1);
});
test("adding respects maximum quantity", () => {
    const cart = [{ ...product(), quantity: 99 }];
    assert.equal(Core.addItem(cart, product()), cart);
});
test("changing quantity can remove the final piece and cap increases", () => {
    assert.equal(Core.changeQuantity([{ ...product(), quantity: 1 }], 1, -1).length, 0);
    assert.equal(Core.changeQuantity([{ ...product(), quantity: 98 }], 1, 5)[0].quantity, 99);
});
test("remove affects only the requested item", () => {
    const cart = [{ ...product(1), quantity: 1 }, { ...product(2), quantity: 2 }];
    assert.deepEqual(Core.removeItem(cart, 1).map(item => item.id), [2]);
});
test("totals use integer cents", () => {
    const cart = [{ ...product(1, .1), quantity: 3 }, { ...product(2, .2), quantity: 1 }];
    assert.equal(Core.totalCents(cart), 50);
    assert.equal(Core.totalQuantity(cart), 4);
    assert.equal(Core.formatCents(50), "$0.50");
});
test("catalog reconciliation refreshes stored prices and marks missing items", () => {
    const cart = [{ ...product(1, 5), quantity: 2 }, { ...product(2), quantity: 1 }];
    const result = Core.reconcileCart(cart, [product(1, 8)]);
    assert.equal(result[0].price, 8);
    assert.equal(result[0].quantity, 2);
    assert.equal(result[0].available, true);
    assert.equal(result[1].available, false);
    assert.equal(cart[0].price, 5);
});
test("search, category and sorting combine without mutating the catalog", () => {
    const products = [product(1, 30), product(2, 10), product(3, 20)];
    assert.deepEqual(Core.filterProducts(products, "everyday", "clothing", "price-low").map(item => item.id), [3, 1]);
    assert.deepEqual(products.map(item => item.id), [1, 2, 3]);
    assert.equal(Core.filterProducts(products, "missing").length, 0);
    assert.deepEqual(Core.filterProducts(products, " PRODUCT 2 ").map(item => item.id), [2]);
});
test("expiry accepts the current month through its final day", () => {
    const today = new Date(2026, 10, 2);
    assert.equal(Core.validExpiry("11/26", today), true);
    assert.equal(Core.validExpiry("10/26", today), false);
    assert.equal(Core.validExpiry("12/26", today), true);
    assert.equal(Core.validExpiry("13/26", today), false);
    assert.equal(Core.validExpiry("11/2026", today), true);
    assert.equal(Core.validExpiry("11/26", new Date(2026, 10, 30, 23, 59)), true);
    assert.equal(Core.validExpiry("11/26", new Date(2026, 11, 1)), false);
});


test("search uses word prefixes rather than substring matches", () => {
    const products = [{...product(1),title:"Mens Jacket",category:"men's clothing",description:"Warm layer"},{...product(2),title:"Women's Jacket",category:"women's clothing",description:"Cotton jacket"},{...product(3),title:"Backpack",description:"A laptop compartment",category:"accessories"}];
    assert.deepEqual(Core.filterProducts(products,"men").map(item=>item.id),[1]);
    assert.deepEqual(Core.filterProducts(products,"jacket mens").map(item=>item.id),[1]);
});
test("price reconciliation preserves the accepted quote until explicit acceptance", () => {
    const cart = [{...product(1,10),quantity:1,quoteCents:1000}];
    const changed = Core.reconcileCart(cart,[product(1,12)])[0];
    assert.equal(changed.price,12);assert.equal(changed.quoteCents,1000);assert.equal(changed.priceChanged,true);
    assert.equal(Core.reconcileCart([{...changed,quoteCents:1200}],[product(1,12)])[0].priceChanged,false);
});


test("shuffle bag visits every product, resets on catalog changes and avoids cycle-boundary repeats", () => {
    const products = [product(1), product(2), product(3), product(4)];
    const pick = Core.createShufflePicker(() => .25);
    const first = Array.from({length:4},()=>pick(products).id);
    assert.equal(new Set(first).size,4);
    const next = pick(products).id;
    assert.notEqual(next,first[3]);
    assert.equal(pick([product(10)]).id,10);
    assert.equal(pick([]),null);
});
