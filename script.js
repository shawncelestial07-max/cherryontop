
import { db, auth } from "./firebase.js";

import {
  collection,
  getDocs,
  doc,
  runTransaction,
  query,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";


import Chart from "https://cdn.jsdelivr.net/npm/chart.js/auto/+esm";

// --------------------------------------------------
// HELPERS AND STATE
// --------------------------------------------------

const $ = (id) => document.getElementById(id);

const money = (value) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP"
  }).format(Number(value) || 0);

const normalizeName = (name) =>
  String(name || "").trim().toLocaleLowerCase();

let cart = [];
let savedProducts = [];
let importedProducts = [];
let isCheckingOut = false;

const importedProductsRef = collection(db, "products");
const ordersRef = collection(db, "orders");
const savedProductsRef = collection(db, "savedProducts");

// --------------------------------------------------
// CLOCK
// --------------------------------------------------

function updateClock() {
  $("currentDateTime").textContent = new Date().toLocaleString(
    "en-PH",
    { dateStyle: "medium", timeStyle: "short" }
  );
}

updateClock();
setInterval(updateClock, 30000);

// --------------------------------------------------
// ERROR MESSAGES
// --------------------------------------------------

function readableError(error) {
  console.error(error);

  const map = {
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/too-many-requests": "Too many attempts. Try again later.",
    "permission-denied": "Permission denied. Check your Firestore security rules.",
    "failed-precondition": "A required Firestore index or database setup may be missing."
  };

  return map[error.code] || error.message || "Something went wrong.";
}

// --------------------------------------------------
// AUTHENTICATION
// --------------------------------------------------

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("loginMessage").textContent = "Signing in...";

  try {
    await signInWithEmailAndPassword(
      auth,
      $("email").value.trim(),
      $("password").value
    );

    $("loginMessage").textContent = "";
  } catch (error) {
    $("loginMessage").textContent = readableError(error);
  }
});

$("signOutBtn").addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    alert(readableError(error));
  }
});

onAuthStateChanged(auth, async (user) => {
  $("loginPanel").hidden = !!user;
  $("posApp").hidden = !user;

  if (!user) {
    cart = [];
    savedProducts = [];
    importedProducts = [];

    renderCart();

    $("cashierLabel").textContent = "Cashier";
    $("saleProductName").value = "";
    $("saleQuantity").value = "1";
    $("salePrice").value = "";
    $("cashReceived").value = "";

    return;
  }

  $("cashierLabel").textContent =
    `Cashier: ${user.email || user.uid}`;

  await loadImportedProducts();
  await loadSavedProducts();
  await loadDailySummary();
  await loadHistory();
  await loadBestSellers();
  await loadRevenue();
});

// --------------------------------------------------
// SUPPLIER COST AND IMPORTED PRODUCTS
// --------------------------------------------------

function getSupplierCost(product) {
  const fields = [
    "cost",
    "supplierCost",
    "supplierPrice",
    "purchasePrice",
    "buyingPrice",
    "wholesalePrice"
  ];

  for (const field of fields) {
    const value = product?.[field];

    if (
      value !== null &&
      value !== undefined &&
      value !== "" &&
      Number.isFinite(Number(value)) &&
      Number(value) >= 0
    ) {
      return Number(value);
    }
  }

  return null;
}

function findImportedProduct(name) {
  const normalized = normalizeName(name);

  return importedProducts.find(
    (product) => normalizeName(product.name) === normalized
  ) || null;
}

async function loadImportedProducts() {
  try {
    const snapshot = await getDocs(importedProductsRef);

    importedProducts = snapshot.docs.map((productDoc) => ({
      id: productDoc.id,
      ...productDoc.data()
    }));

    console.log(`Loaded ${importedProducts.length} imported products.`);
  } catch (error) {
    console.error("Could not load imported products:", error);
    importedProducts = [];
  }
}

// --------------------------------------------------
// SAVED PRODUCTS AND SUGGESTIONS
// --------------------------------------------------

async function loadSavedProducts() {
  $("productSuggestionMessage").textContent = "Loading saved products...";

  try {
    const snapshot = await getDocs(savedProductsRef);

    savedProducts = snapshot.docs.map((productDoc) => ({
      id: productDoc.id,
      ...productDoc.data()
    }));

    renderProductSuggestions();
    renderProductsTable();

    $("productSuggestionMessage").textContent =
      `${savedProducts.length} saved product(s) available.`;
 
  } catch (error) {
    console.error("Could not load saved products:", error);

    savedProducts = [];

    renderProductSuggestions();
    renderProductsTable();

    $("productSuggestionMessage").textContent =
      `Could not load saved products: ${readableError(error)}`;
  }
}



function renderProductSuggestions() {
  const dropdown = $("savedProductSuggestions");

  if (!dropdown) return;

  dropdown.replaceChildren();

  savedProducts.forEach((product) => {
    if (!product.name) return;

    const option = document.createElement("button");
    option.type = "button";
    option.className = "product-dropdown-option";

    const name = document.createElement("span");
    name.textContent = product.name;

    const price = document.createElement("small");
    price.textContent =
      product.lastPrice !== undefined &&
      product.lastPrice !== null &&
      product.lastPrice !== ""
        ? `Last price: ${money(product.lastPrice)}`
        : "Previously sold product";

    option.append(name, price);

    option.addEventListener("click", () => {
      $("saleProductName").value = product.name;
      dropdown.hidden = true;

      // Trigger existing product-name handling, if any.
      $("saleProductName").dispatchEvent(
        new Event("change", { bubbles: true })
      );
    });

    dropdown.appendChild(option);
  });
}


const productNameInput = $("saleProductName");
const productDropdown = $("savedProductSuggestions");

if (productNameInput && productDropdown) {
  productNameInput.addEventListener("focus", () => {
    renderProductSuggestions();
    productDropdown.hidden = false;
  });

  productNameInput.addEventListener("input", () => {
    const search = productNameInput.value.trim().toLowerCase();

    productDropdown.querySelectorAll(".product-dropdown-option")
      .forEach((option) => {
        option.hidden = !option.textContent.toLowerCase().includes(search);
      });

    productDropdown.hidden = false;
  });


document.addEventListener("click", (event) => {
  if (
    !event.target.closest(".product-dropdown") &&
    !event.target.closest("#saleProductName") &&
    !event.target.closest(".product-search-wrapper") &&
    !event.target.closest(".product-input-wrapper")
  ) {
    productDropdown.hidden = true;
  }
});

}


$("saleProductName").addEventListener("change", () => {
  const name = normalizeName($("saleProductName").value);

  const product = savedProducts.find(
    (item) => normalizeName(item.name) === name
  );

  if (
    product &&
    product.lastPrice !== undefined &&
    product.lastPrice !== null &&
    product.lastPrice !== "" &&
    Number.isFinite(Number(product.lastPrice))
  ) {
    $("salePrice").value = Number(product.lastPrice).toFixed(2);

    $("productSuggestionMessage").textContent =
      `Last recorded price: ${money(product.lastPrice)}. You can change it.`;
  }
});

// --------------------------------------------------
// ADD ITEMS TO CURRENT ORDER
// --------------------------------------------------

$("quickSaleForm").addEventListener("submit", (event) => {
  event.preventDefault();

  const name = $("saleProductName").value.trim();
  const quantity = Number($("saleQuantity").value);
  const priceInput = $("salePrice").value.trim();
  const price = Number(priceInput);

  if (!name) {
    $("productSuggestionMessage").textContent = "Enter a product name.";
    return;
  }

  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    $("productSuggestionMessage").textContent =
      "Quantity must be a whole number greater than zero.";
    return;
  }

  if (
    priceInput === "" ||
    !Number.isFinite(price) ||
    price < 0
  ) {
    $("productSuggestionMessage").textContent =
      "Enter a valid selling price.";
    return;
  }

  const importedProduct = findImportedProduct(name);
  const supplierCost = importedProduct
    ? getSupplierCost(importedProduct)
    : null;

  const existing = cart.find(
    (item) =>
      normalizeName(item.name) === normalizeName(name) &&
      item.price === price
  );

  if (existing) {
    existing.qty += quantity;

    if (supplierCost !== null) {
      existing.supplierCost = supplierCost;
    }
  } else {
    cart.push({
      name,
      price,
      qty: quantity,
      supplierCost
    });
  }

  $("checkoutMessage").textContent = "";
  $("checkoutMessage").classList.remove("success");

  $("saleProductName").value = "";
  $("saleQuantity").value = "1";
  $("salePrice").value = "";

  renderCart();
  $("saleProductName").focus();
});

// --------------------------------------------------
// CART
// --------------------------------------------------

function renderCart() {
  const container = $("cartItems");
  container.replaceChildren();

  if (!cart.length) {
    const empty = document.createElement("div");
    empty.className = "empty-cart";

    const icon = document.createElement("div");
    icon.textContent = "🛒";

    const message = document.createElement("p");
    message.textContent = "No items in order";

    const help = document.createElement("small");
    help.textContent = "Add a product to begin a sale.";

    empty.append(icon, message, help);
    container.append(empty);
  } else {
    cart.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "cart-item";

      const info = document.createElement("div");

      const name = document.createElement("div");
      name.className = "cart-item-name";
      name.textContent = item.name;

      const price = document.createElement("div");
      price.className = "cart-item-price";
      price.textContent = `${money(item.price)} each`;

      const controls = document.createElement("div");
      controls.className = "cart-item-controls";

      const minus = document.createElement("button");
      minus.type = "button";
      minus.className = "qty-btn";
      minus.textContent = "−";
      minus.setAttribute("aria-label", `Remove one ${item.name}`);
      minus.addEventListener("click", () => changeQty(index, -1));

      const quantity = document.createElement("span");
      quantity.className = "qty";
      quantity.textContent = String(item.qty);

      const plus = document.createElement("button");
      plus.type = "button";
      plus.className = "qty-btn";
      plus.textContent = "+";
      plus.setAttribute("aria-label", `Add one ${item.name}`);
      plus.addEventListener("click", () => changeQty(index, 1));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-btn";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        cart.splice(index, 1);
        renderCart();
      });

      controls.append(minus, quantity, plus, remove);
      info.append(name, price, controls);

      const lineTotal = document.createElement("div");
      lineTotal.className = "cart-item-total";
      lineTotal.textContent = money(item.price * item.qty);

      row.append(info, lineTotal);
      container.append(row);
    });
  }

  const subtotal = getCartTotal();

  $("subtotal").textContent = money(subtotal);
  $("discount").textContent = money(0);
  $("total").textContent = money(subtotal);

  updateChange();
}

function getCartTotal() {
  return cart.reduce(
    (sum, item) => sum + item.price * item.qty,
    0
  );
}

function changeQty(index, delta) {
  const item = cart[index];
  if (!item) return;

  const next = item.qty + delta;

  if (next <= 0) {
    cart.splice(index, 1);
  } else {
    item.qty = next;
  }

  renderCart();
}

function updateChange() {
  const total = getCartTotal();
  const cash = Number($("cashReceived").value) || 0;

  $("change").textContent = money(Math.max(0, cash - total));
}

$("cashReceived").addEventListener("input", updateChange);

$("clearCart").addEventListener("click", () => {
  cart = [];
  $("cashReceived").value = "";
  $("checkoutMessage").textContent = "";
  $("checkoutMessage").classList.remove("success");

  renderCart();
});

// --------------------------------------------------
// COMPLETE SALE
// --------------------------------------------------

$("checkoutBtn").addEventListener("click", async () => {
  if (isCheckingOut) return;

  if (!auth.currentUser) {
    $("checkoutMessage").textContent = "Please sign in first.";
    return;
  }

  if (!cart.length) {
    $("checkoutMessage").textContent =
      "Add at least one product before checkout.";
    return;
  }

  const total = getCartTotal();
  const cashInput = $("cashReceived").value.trim();
  const cash = Number(cashInput);

  if (
    cashInput === "" ||
    !Number.isFinite(cash) ||
    cash < total
  ) {
    $("checkoutMessage").textContent =
      "Cash received must be equal to or greater than the total.";
    return;
  }

  const purchased = cart.map((item) => ({ ...item }));
  const cashier = auth.currentUser;

  isCheckingOut = true;
  $("checkoutBtn").disabled = true;
  $("checkoutBtn").textContent = "SAVING SALE...";
  $("checkoutMessage").textContent = "";
  $("checkoutMessage").classList.remove("success");

  try {
    const orderRef = doc(ordersRef);

    const uniqueNames = [
      ...new Set(purchased.map((item) => normalizeName(item.name)))
    ];

    const productRefs = uniqueNames.map((name) => {
      const saved = savedProducts.find(
        (product) => normalizeName(product.name) === name
      );

      return {
        name,
        ref: saved
          ? doc(db, "savedProducts", saved.id)
          : doc(savedProductsRef)
      };
    });

    await runTransaction(db, async (transaction) => {
      const productSnapshots = [];

      for (const product of productRefs) {
        productSnapshots.push(await transaction.get(product.ref));
      }

      const productByName = new Map();

      productRefs.forEach((product, index) => {
        productByName.set(product.name, {
          ref: product.ref,
          snapshot: productSnapshots[index]
        });
      });

      for (const product of productRefs) {
        const matchingItems = purchased.filter(
          (item) => normalizeName(item.name) === product.name
        );

        const latestItem = matchingItems[matchingItems.length - 1];
        const saved = productByName.get(product.name);
        const previous = saved.snapshot.exists()
          ? saved.snapshot.data()
          : {};

        const previousTimesSold = Number(previous.timesSold) || 0;
        const quantitySold = matchingItems.reduce(
          (sum, item) => sum + item.qty,
          0
        );

        transaction.set(
          saved.ref,
          {
            name: latestItem.name,
            lastPrice: latestItem.price,
            updatedAt: serverTimestamp(),
            lastSoldAt: serverTimestamp(),
            timesSold: previousTimesSold + quantitySold
          },
          { merge: true }
        );
      }

      const orderItems = purchased.map(
        ({ name, price, qty, supplierCost }) => {
          const importedProduct = findImportedProduct(name);

          const cost =
            supplierCost !== null && supplierCost !== undefined
              ? Number(supplierCost)
              : importedProduct
                ? getSupplierCost(importedProduct)
                : null;

          const lineTotal = price * qty;

          return {
            name,
            price,
            qty,
            lineTotal,
            supplierCost: cost,
            estimatedProfit:
              cost === null ? null : (price - cost) * qty
          };
        }
      );

      transaction.set(orderRef, {
        orderNumber: orderRef.id,
        status: "completed",
        items: orderItems,
        subtotal: total,
        discount: 0,
        total,
        cashReceived: cash,
        change: cash - total,
        cashierUid: cashier.uid,
        cashierEmail: cashier.email || "",
        createdAt: serverTimestamp(),
        createdAtLocal: new Date().toISOString()
      });
    });

    cart = [];
    $("cashReceived").value = "";
    renderCart();

    $("checkoutMessage").textContent =
      `Sale saved successfully. Order ID: ${orderRef.id}`;
    $("checkoutMessage").classList.add("success");

    alert(
      `Sale saved successfully!\n` +
      `Order: ${orderRef.id}\n` +
      `Total: ${money(total)}\n` +
      `Change: ${money(cash - total)}`
    );

    await Promise.all([
      loadSavedProducts(),
      loadDailySummary(),
      loadHistory(),
      loadBestSellers(),
      loadRevenue()
    ]);
  } catch (error) {
    $("checkoutMessage").textContent = readableError(error);
    $("checkoutMessage").classList.remove("success");
  } finally {
    isCheckingOut = false;
    $("checkoutBtn").disabled = false;
    $("checkoutBtn").textContent = "COMPLETE SALE";
  }
});

// --------------------------------------------------
// NAVIGATION
// --------------------------------------------------


document.querySelectorAll(".nav-btn").forEach((button) => {
  button.addEventListener("click", async () => {
    document.querySelectorAll(".nav-btn").forEach((nav) => {
      nav.classList.toggle("active", nav === button);
    });

    document.querySelectorAll(".page").forEach((page) => {
      page.hidden = page.id !== button.dataset.page;
    });

    if (button.dataset.page === "historyPage") {
      await loadHistory();
    }

    if (button.dataset.page === "productsPage") {
      await loadSavedProducts();
    }

    if (button.dataset.page === "revenuePage") {
      await loadRevenue();
    }
  });
});


// --------------------------------------------------
// DATE HELPERS
// --------------------------------------------------

function getOrderDate(order) {
  if (order.createdAt?.toDate) {
    return order.createdAt.toDate();
  }

  if (order.createdAtLocal) {
    const date = new Date(order.createdAtLocal);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function getPeriodStart(period, now) {
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  if (period === "today") return start;

  if (period === "week") {
    const day = start.getDay();
    const daysSinceMonday = (day + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
    return start;
  }

  if (period === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  return null;
}

// --------------------------------------------------
// SALES HISTORY
// --------------------------------------------------

$("refreshHistory").addEventListener("click", loadHistory);

async function loadHistory() {
  if (!auth.currentUser) return;

  $("historyMessage").textContent = "Loading orders...";

  const tbody = $("ordersTable");
  tbody.replaceChildren();

  try {
    const snapshot = await getDocs(
      query(ordersRef, orderBy("createdAt", "desc"), limit(200))
    );

    let totalSales = 0;
    let completedOrderCount = 0;

    snapshot.docs.forEach((orderDoc) => {
      const order = orderDoc.data();

      if (order.status && order.status !== "completed") return;

      totalSales += Number(order.total) || 0;
      completedOrderCount++;

      const date = getOrderDate(order);
      const items = Array.isArray(order.items) ? order.items : [];

      const itemCount = items.reduce(
        (sum, item) => sum + (Number(item.qty) || 0),
        0
      );

      const productsSold = items.map((item) => {
        const name = String(item.name || "Unnamed product");
        const qty = Number(item.qty) || 0;
        return `${name} × ${qty}`;
      }).join(", ");

      const values = [
        order.orderNumber || orderDoc.id,
        date ? date.toLocaleString("en-PH") : "Pending timestamp",
        productsSold || "No items recorded",
        String(itemCount),
        money(order.total),
        money(order.cashReceived),
        money(order.change),
        order.cashierEmail || order.cashierUid || "—"
      ];

      const tr = document.createElement("tr");

      values.forEach((value) => {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      });

      tbody.append(tr);
    });

    if (!tbody.children.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");

      td.colSpan = 8;
      td.textContent = "No completed orders found.";

      tr.append(td);
      tbody.append(tr);
    }

    $("historySales").textContent = money(totalSales);
    $("historyCount").textContent = String(completedOrderCount);

    $("historyMessage").textContent =
      snapshot.size === 200
        ? "Showing up to the latest 200 orders."
        : "";
  } catch (error) {
    console.error("Sales History failed:", error);
    $("historyMessage").textContent =
      `Could not load history: ${readableError(error)}`;
  }
}

// --------------------------------------------------
// TODAY'S SUMMARY
// --------------------------------------------------

async function loadDailySummary() {
  if (!auth.currentUser) return;

  try {
    const snapshot = await getDocs(
      query(ordersRef, orderBy("createdAt", "desc"), limit(500))
    );

    const now = new Date();
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    let total = 0;
    let count = 0;

    snapshot.docs.forEach((orderDoc) => {
      const order = orderDoc.data();

      if (order.status && order.status !== "completed") return;

      const date = getOrderDate(order);

      if (date && date >= start && date < end) {
        total += Number(order.total) || 0;
        count++;
      }
    });

    $("todaySales").textContent = money(total);
    $("todayCount").textContent = String(count);
  } catch (error) {
    console.error("Daily summary failed:", error);
  }
}

// --------------------------------------------------
// BEST SELLERS
// --------------------------------------------------

$("refreshBestSellers").addEventListener("click", loadBestSellers);
$("bestSellerPeriod").addEventListener("change", loadBestSellers);

async function loadBestSellers() {
  if (!auth.currentUser) return;

  $("bestSellersMessage").textContent = "Loading sales data...";

  const tbody = $("bestSellersTable");
  tbody.replaceChildren();

  try {
    const snapshot = await getDocs(ordersRef);
    const now = new Date();
    const start = getPeriodStart($("bestSellerPeriod").value, now);

    const stats = new Map();

    let orderCount = 0;
    let totalUnits = 0;
    let totalRevenue = 0;
    let totalProfit = 0;
    let profitUnknown = false;

    snapshot.docs.forEach((orderDoc) => {
      const order = orderDoc.data();

      if (order.status && order.status !== "completed") return;

      const date = getOrderDate(order);
      if (!date || (start && date < start) || date > now) return;

      orderCount++;
      totalRevenue += Number(order.total) || 0;

      const items = Array.isArray(order.items) ? order.items : [];

      items.forEach((item) => {
        const name = String(item.name || "Unnamed product").trim();
        const key = normalizeName(name);
        const qty = Number(item.qty) || 0;
        const price = Number(item.price);

        const revenue = Number.isFinite(Number(item.lineTotal))
          ? Number(item.lineTotal)
          : Number.isFinite(price)
            ? price * qty
            : 0;

        if (!stats.has(key)) {
          stats.set(key, {
            name,
            units: 0,
            revenue: 0,
            profit: 0,
            profitUnknown: false
          });
        }

        const product = stats.get(key);
        product.units += qty;
        product.revenue += revenue;
        totalUnits += qty;

        let itemProfit = null;

        if (typeof item.estimatedProfit === "number") {
          itemProfit = item.estimatedProfit;
        } else if (
          typeof item.supplierCost === "number" &&
          Number.isFinite(price)
        ) {
          itemProfit = (price - item.supplierCost) * qty;
        }

        if (itemProfit === null) {
          product.profitUnknown = true;
          profitUnknown = true;
        } else {
          product.profit += itemProfit;
          totalProfit += itemProfit;
        }
      });
    });

    $("bestSellerOrderCount").textContent = String(orderCount);
    $("bestSellerUnits").textContent = String(totalUnits);
    $("bestSellerRevenue").textContent = money(totalRevenue);
    $("bestSellerProfit").textContent =
      profitUnknown ? "Unavailable" : money(totalProfit);

    const ranked = [...stats.values()].sort(
      (a, b) => b.units - a.units || b.revenue - a.revenue
    );

    if (!ranked.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");

      td.colSpan = 5;
      td.textContent = "No completed sales found for this period.";

      tr.append(td);
      tbody.append(tr);
    } else {
      ranked.forEach((product, index) => {
        const tr = document.createElement("tr");

        const values = [
          String(index + 1),
          product.name,
          String(product.units),
          money(product.revenue),
          product.profitUnknown ? "Unavailable" : money(product.profit)
        ];

        values.forEach((value) => {
          const td = document.createElement("td");
          td.textContent = value;
          tr.append(td);
        });

        tbody.append(tr);
      });
    }

    $("bestSellersMessage").textContent =
      "Ranked by units sold, with revenue breaking ties. Profit is unavailable when cost information is missing.";
  } catch (error) {
    $("bestSellersMessage").textContent =
      `Could not load Best Sellers: ${readableError(error)}`;
  }
}


/* --------------------------------------------------
   PRODUCTS PAGE TABS
-------------------------------------------------- */

document.querySelectorAll(".product-tab-btn").forEach((button) => {
  button.addEventListener("click", () => {
    const targetId = button.dataset.productTab;

    document.querySelectorAll(".product-tab-btn").forEach((tab) => {
      tab.classList.toggle("active", tab === button);
    });

    document.querySelectorAll(".product-tab-panel").forEach((panel) => {
      panel.hidden = panel.id !== targetId;
    });

    // Load the Best Sellers report when its tab is opened.
    if (targetId === "bestSellersPanel") {
      loadBestSellers();
    }

    // Refresh saved products when All Products is opened.
    if (targetId === "allProductsPanel") {
      loadSavedProducts();
    }
  });
});


/* --------------------------------------------------
   ALL PRODUCTS LIST
-------------------------------------------------- */


function renderProductsTable() {
  const container = $("productsTable");
  const searchInput = $("productSearch");
  const message = $("productsMessage");
  const count = $("productsCount");

  if (!container) return;

  const search = (searchInput?.value || "").trim().toLowerCase();

  const filteredProducts = savedProducts
    .filter((product) =>
      String(product.name || "").toLowerCase().includes(search)
    )
    .sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""))
    );

  container.replaceChildren();

  if (count) {
    count.textContent = `${filteredProducts.length} product(s)`;
  }

  if (filteredProducts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "products-empty";
    empty.textContent = search
      ? "No products match your search."
      : "No saved products found.";

    container.appendChild(empty);

    if (message) message.textContent = "";
    return;
  }

  filteredProducts.forEach((product, index) => {
    const card = document.createElement("article");
    card.className = "saved-product-card";

    const top = document.createElement("div");
    top.className = "product-card-top";

    const icon = document.createElement("div");
    icon.className = "product-card-icon";
    icon.textContent = "▦";
    icon.setAttribute("aria-hidden", "true");

    const info = document.createElement("div");
    info.className = "product-card-info";

    const name = document.createElement("h3");
    name.className = "product-card-name";
    name.textContent = product.name || "Unnamed product";

    const label = document.createElement("span");
    label.className = "product-card-label";
    label.textContent = "Saved product";

    info.append(name, label);
    top.append(icon, info);

    const bottom = document.createElement("div");
    bottom.className = "product-card-bottom";

    const priceInfo = document.createElement("div");

    const priceLabel = document.createElement("span");
    priceLabel.className = "product-price-label";
    priceLabel.textContent = "Last sold price";

    const priceText = document.createElement("div");
    priceText.className = "product-card-price";

    const price = Number(product.lastPrice);

    priceText.textContent =
      product.lastPrice !== undefined &&
      product.lastPrice !== null &&
      product.lastPrice !== "" &&
      Number.isFinite(price)
        ? money(price)
        : "No price saved";

    priceInfo.append(priceLabel, priceText);

    const number = document.createElement("span");
    number.className = "product-card-number";
    number.textContent = `#${index + 1}`;

    bottom.append(priceInfo, number);
    card.append(top, bottom);
    container.appendChild(card);
  });

  if (message) message.textContent = "";
}



// Search products as the user types.
$("productSearch").addEventListener("input", renderProductsTable);


// Refresh saved products from Firebase.
$("refreshProducts").addEventListener("click", loadSavedProducts);



/* SALES OVERVIEW GRAPH */

let salesOverviewChart = null;

function renderSalesOverviewChart(dailySales) {
  const canvas = $("salesOverviewChart");
  const message = $("salesChartMessage");

  if (!canvas) {
    console.warn("Sales Overview canvas was not found.");
    return;
  }

  const entries = [...dailySales.entries()]
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB));

  if (salesOverviewChart) {
    salesOverviewChart.destroy();
    salesOverviewChart = null;
  }

  if (!entries.length) {
    if (message) {
      message.textContent = "No sales data available for this period.";
    }
    return;
  }

  if (message) {
    message.textContent = "";
  }

  salesOverviewChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: entries.map(([date]) => {
        const [year, month, day] = date.split("-").map(Number);

        return new Date(year, month - 1, day)
          .toLocaleDateString("en-PH", {
            month: "short",
            day: "numeric"
          });
      }),
      datasets: [{
        label: "Daily Sales",
        data: entries.map(([, amount]) => amount),
        borderColor: "#16a34a",
        backgroundColor: "rgba(22, 163, 74, 0.12)",
        borderWidth: 3,
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: "#166534"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: "index"
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: (context) => `Sales: ${money(context.parsed.y)}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) =>
              "₱" + Number(value).toLocaleString("en-PH")
          }
        },
        x: {
          ticks: {
            maxRotation: 45,
            autoSkip: true
          }
        }
      }
    }
  });
}


// --------------------------------------------------
// REVENUE & PROFIT
// --------------------------------------------------

$("refreshRevenue").addEventListener("click", loadRevenue);
$("revenuePeriod").addEventListener("change", loadRevenue);

async function loadRevenue() {
  if (!auth.currentUser) return;

  $("revenueMessage").textContent = "Loading revenue report...";

  const tbody = $("revenueTable");
  tbody.replaceChildren();

  try {
    const snapshot = await getDocs(ordersRef);
    const now = new Date();
    const start = getPeriodStart($("revenuePeriod").value, now);

    let revenue = 0;
let cost = 0;
let profit = 0;
let orderCount = 0;
let unknownCosts = false;

const products = new Map();
const dailySales = new Map();

    snapshot.docs.forEach((orderDoc) => {
      const order = orderDoc.data();

      if (order.status && order.status !== "completed") return;

      const date = getOrderDate(order);
      if (!date || (start && date < start) || date > now) return;

      const items = Array.isArray(order.items) ? order.items : [];
      if (!items.length) return;

      orderCount++;

const orderTotal = Number(order.total) || 0;
revenue += orderTotal;

// Group completed sales by local calendar date.
const dateKey = [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, "0"),
  String(date.getDate()).padStart(2, "0")
].join("-");

dailySales.set(
  dateKey,
  (dailySales.get(dateKey) || 0) + orderTotal
);

      items.forEach((item) => {
        const name = String(item.name || "Unnamed product").trim();
        const key = normalizeName(name);
        const qty = Number(item.qty) || 0;
        const price = Number(item.price) || 0;

        const lineRevenue = Number.isFinite(Number(item.lineTotal))
          ? Number(item.lineTotal)
          : price * qty;

        const importedProduct = findImportedProduct(name);

        const storedCost =
          typeof item.supplierCost === "number"
            ? item.supplierCost
            : null;

        const currentCost = importedProduct
          ? getSupplierCost(importedProduct)
          : null;

        const unitCost = storedCost !== null
          ? storedCost
          : currentCost;

        if (!products.has(key)) {
          products.set(key, {
            name,
            units: 0,
            revenue: 0,
            cost: 0,
            profit: 0,
            unknown: false
          });
        }

        const product = products.get(key);

        product.units += qty;
        product.revenue += lineRevenue;

        if (unitCost === null) {
          product.unknown = true;
          unknownCosts = true;
        } else {
          const lineCost = unitCost * qty;
          const lineProfit = lineRevenue - lineCost;

          cost += lineCost;
          profit += lineProfit;
          product.cost += lineCost;
          product.profit += lineProfit;
        }
      });
    });

    $("revenueTotal").textContent = money(revenue);
    $("revenueCost").textContent =
      unknownCosts ? "Incomplete" : money(cost);

    $("revenueProfit").textContent =
      unknownCosts ? "Incomplete" : money(profit);

    $("revenueOrderCount").textContent = String(orderCount);

    renderSalesOverviewChart(dailySales);

    const ranked = [...products.values()].sort(
      (a, b) => b.revenue - a.revenue
    );

    if (!ranked.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");

      cell.colSpan = 5;
      cell.textContent = "No completed sales found for this period.";

      row.append(cell);
      tbody.append(row);
    } else {
      ranked.forEach((product) => {
        const row = document.createElement("tr");

        const values = [
          product.name,
          String(product.units),
          money(product.revenue),
          product.unknown ? "Unknown" : money(product.cost),
          product.unknown ? "Unknown" : money(product.profit)
        ];

        values.forEach((value) => {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.append(cell);
        });

        tbody.append(row);
      });
    }

    $("revenueMessage").textContent = unknownCosts
      ? "Some products have no matching supplier cost. Totals marked Incomplete exclude unknown costs, so actual gross profit may differ."
      : "Report loaded. Older sales without a saved supplier cost use the currently imported cost, which may differ from the cost at the time of sale.";
  } catch (error) {
    console.error("Revenue report failed:", error);

    $("revenueMessage").textContent =
      `Could not load revenue report: ${readableError(error)}`;
  }
}
