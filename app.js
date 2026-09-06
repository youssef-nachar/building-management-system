/*
 * FOYER NOHAD — Firebase Edition
 * ---------------------------------------------------------
 * Before running:
 * 1) Create a Firebase project.
 * 2) Enable Authentication > Email/Password.
 * 3) Create a Firestore database.
 * 4) Enable Storage.
 * 5) Paste your Firebase Web App config below.
 *
 * Data is stored in Firestore:
 *   customers/{bed-0 ... bed-143}
 *   expenses/{auto-id}
 *   paymentHistory/{YYYY-MM}
 *   settings/app
 *
 * ID photos are stored in Firebase Storage:
 *   customer-images/{uid}/{bedIndex}-{timestamp}-{filename}
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app-check.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    onAuthStateChanged,
    signOut,
    setPersistence,
    browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
    getFirestore,
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    query,
    orderBy,
    writeBatch,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
    getStorage,
    ref,
    uploadBytes,
    getBlob
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

/* =========================================================
   FIREBASE CONFIG — REPLACE THESE VALUES
   ========================================================= */
const firebaseConfig = {
    apiKey: "AIzaSyDa9c8KhArVSz7tZz0IOM6_TsRJZa2GqCU",
    authDomain: "foyer-nohad.firebaseapp.com",
    databaseURL: "https://foyer-nohad-default-rtdb.firebaseio.com",
    projectId: "foyer-nohad",
    storageBucket: "foyer-nohad.firebasestorage.app",
    messagingSenderId: "1007865928692",
    appId: "1:1007865928692:web:843f27e83f0e3f204ef7a1",
    measurementId: "G-FC5X4P9YTZ"
};

/* App Check (recommended: enable reCAPTCHA Enterprise in Firebase Console). */
const APP_CHECK_SITE_KEY = "YOUR_RECAPTCHA_ENTERPRISE_SITE_KEY";

const firebaseReady =
    firebaseConfig.apiKey !== "YOUR_API_KEY" &&
    firebaseConfig.projectId !== "YOUR_PROJECT_ID" &&
    firebaseConfig.appId !== "YOUR_APP_ID";

let firebaseApp, auth, db, storage, appCheck;
let currentRole = null;
let currentCompanyId = null;
let currentUserProfile = null;
const imageObjectUrls = new Map();

if (firebaseReady) {
    firebaseApp = initializeApp(firebaseConfig);
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
    storage = getStorage(firebaseApp);

    if (APP_CHECK_SITE_KEY !== "YOUR_RECAPTCHA_ENTERPRISE_SITE_KEY") {
        appCheck = initializeAppCheck(firebaseApp, {
            provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
            isTokenAutoRefreshEnabled: true
        });
    }
} else {
    console.warn("Firebase is not configured. Paste your Firebase Web App config in firebaseConfig.");
}

/* =========================================================
   CONFIG & STATE
   ========================================================= */
// Commercial v1: every business record is scoped under companies/{companyId}.

const building = document.getElementById("building");
const floors = 6;
const apartments = 4;
const rooms = 3;
const beds = 2;
const totalBeds = floors * apartments * rooms * beds;
const MONTHLY_RENT = 235;

let customers = new Array(totalBeds).fill(null);
let expenses = [];
let paymentHistory = {};
let selectedBed = null;
let unsubscribeCustomers = null;
let unsubscribeExpenses = null;
let dataLoaded = false;

const modal = document.getElementById("customerModal");
const editModal = document.getElementById("editModal");
const confirmModal = document.getElementById("confirmModal");
const kpiModal = document.getElementById("kpiModal");
const expenseModal = document.getElementById("expenseModal");

const saveBtn = document.getElementById("saveCustomer");
const cancelBtn = document.getElementById("cancelCustomer");
const checkoutBtn = document.getElementById("checkoutCustomer");
const updateBtn = document.getElementById("updateCustomer");
const confirmOk = document.getElementById("confirmOk");
const confirmCancel = document.getElementById("confirmCancel");
const addExpenseBtn = document.getElementById("addExpenseBtn");
const saveExpenseBtn = document.getElementById("saveExpense");
const cancelExpenseBtn = document.getElementById("cancelExpense");
const expenseTableBody = document.getElementById("expenseTableBody");

const $ = id => document.getElementById(id);

function firebaseErrorMessage(error) {
    const code = error?.code || "";
    const map = {
        "auth/invalid-credential": "Invalid email or password.",
        "auth/invalid-login-credentials": "Invalid email or password.",
        "auth/user-not-found": "No account exists with this email.",
        "auth/wrong-password": "Wrong password.",
        "auth/too-many-requests": "Too many attempts. Please try again later.",
        "auth/network-request-failed": "Network error. Check your internet connection.",
        "auth/invalid-email": "Please enter a valid email address.",
        "auth/email-already-in-use": "This email is already registered. Use Sign In or resend verification.",
        "auth/weak-password": "Password is too weak. Use at least 8 characters.",
        "auth/operation-not-allowed": "Email/password authentication is disabled in Firebase.",
        "auth/user-disabled": "This account has been disabled by an administrator.",
        "auth/too-many-requests": "Too many email/authentication requests. Wait a few minutes before trying again.",
        "auth/quota-exceeded": "Firebase email sending quota has been exceeded. Try again later or configure a custom email domain/provider.",
        "auth/requires-recent-login": "Please sign in again and retry.",
        "permission-denied": "Firebase permission denied. Check Firestore/Storage rules.",
        "storage/unauthorized": "Storage permission denied. Check Storage rules."
    };
    return map[code] || error?.message || "An unexpected error occurred.";
}

function requireFirebase() {
    if (!firebaseReady || !auth || !db || !storage) {
        throw new Error("Firebase is not configured.");
    }
    if (!auth.currentUser) {
        throw new Error("You must be signed in.");
    }
}

function requireRole(...allowedRoles) {
    requireFirebase();
    requireCompany();
    if (!currentRole || !allowedRoles.includes(currentRole)) {
        throw new Error("You do not have permission to perform this action.");
    }
}

function requireCompany() {
    requireFirebase();
    if (!currentCompanyId) throw new Error("No company is assigned to this account.");
    return currentCompanyId;
}

function companyCollection(name) {
    return collection(db, "companies", requireCompany(), name);
}

function companyDoc(name, id) {
    return doc(db, "companies", requireCompany(), name, id);
}

function companyStoragePath(...parts) {
    return ["companies", requireCompany(), ...parts].filter(Boolean).join("/");
}

function isAdminRole() {
    return ["owner", "admin"].includes(currentRole);
}

function hasPermission(permission) {
    const permissions = {
        "customers.read": ["owner", "admin", "manager", "staff", "viewer"],
        "customers.write": ["owner", "admin", "manager", "staff"],
        "customers.delete": ["owner", "admin", "manager"],
        "finance.read": ["owner", "admin", "manager", "accountant", "viewer"],
        "finance.write": ["owner", "admin", "manager", "accountant"],
        "finance.delete": ["owner", "admin"],
        "settings.write": ["owner", "admin"],
        "users.manage": ["owner", "admin"],
        "audit.read": ["owner", "admin", "manager"],
        "reports.read": ["owner", "admin", "manager", "accountant", "viewer"]
    };
    return (permissions[permission] || []).includes(currentRole);
}

function requirePermission(permission) {
    requireCompany();
    if (!hasPermission(permission)) throw new Error("You do not have permission to perform this action.");
}

async function loadCurrentUserRole(user) {
    requireFirebase();
    const roleSnap = await getDoc(doc(db, "users", user.uid));
    if (!roleSnap.exists()) {
        currentRole = null;
        currentCompanyId = null;
        currentUserProfile = null;
        throw new Error("This account is not authorized. Ask the company owner to assign you to a company.");
    }
    const profile = roleSnap.data() || {};
    const allowedRoles = ["owner", "admin", "manager", "staff", "accountant", "viewer"];
    if (!allowedRoles.includes(profile.role) || !profile.companyId || profile.status === "suspended") {
        currentRole = null;
        currentCompanyId = null;
        currentUserProfile = null;
        throw new Error("This account is not authorized for a company.");
    }
    currentRole = profile.role;
    currentCompanyId = String(profile.companyId);
    currentUserProfile = { uid: user.uid, ...profile };
}

function applyRoleUI() {
    const adminOnly = document.querySelectorAll("[data-admin-only]");
    adminOnly.forEach(el => {
        el.style.display =
            ["owner", "admin"].includes(currentRole) ? "" : "none";
    });

    const financeOnly = document.querySelectorAll("[data-finance-only]");
    financeOnly.forEach(el => {
        el.style.display = hasPermission("finance.read") ? "" : "none";
    });
}
function formatCurrency(amount) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD"
    }).format(Number(amount) || 0);
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function getLocation(index) {
    const bedsPerApartment = rooms * beds;
    const bedsPerFloor = apartments * rooms * beds;
    return {
        floor: Math.floor(index / bedsPerFloor) + 1,
        apartment: Math.floor((index % bedsPerFloor) / bedsPerApartment) + 1,
        room: Math.floor((index % bedsPerApartment) / beds) + 1,
        bed: (index % beds) + 1
    };
}

function getMonthKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getStayDays(dateString) {
    if (!dateString) return "-";
    const start = new Date(dateString);
    if (Number.isNaN(start.getTime())) return "-";
    return Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000));
}

function customerDocId(index) {
    return `bed-${index}`;
}

function expenseCollection() {
    return companyCollection("expenses");
}

function customerCollection() {
    return companyCollection("customers");
}

function paymentHistoryCollection() {
    return companyCollection("paymentHistory");
}

function settingsDoc() {
    return companyDoc("settings", "app");
}

/* =========================================================
   BUILDING UI
   ========================================================= */
let index = 0;

for (let floor = 1; floor <= floors; floor++) {
    const floorDiv = document.createElement("div");
    floorDiv.className = "floor";
    floorDiv.innerHTML = `<h2>Floor ${floor}</h2>`;

    const apartmentContainer = document.createElement("div");
    apartmentContainer.className = "apartments";

    for (let apartment = 1; apartment <= apartments; apartment++) {
        const apartmentDiv = document.createElement("div");
        apartmentDiv.className = "apartment";
        apartmentDiv.innerHTML = `<div class="apartment-header">🏢 Apartment ${apartment}</div>`;

        for (let room = 1; room <= rooms; room++) {
            const roomDiv = document.createElement("div");
            roomDiv.className = "room";
            roomDiv.innerHTML = `<h4>Room ${room}</h4>`;

            for (let bed = 1; bed <= beds; bed++) {
                const button = document.createElement("button");
                button.className = "available";
                button.innerText = `Bed ${bed}`;
                button.dataset.index = index;
                button.dataset.bedName = `Bed ${bed}`;

                button.onclick = () => openCustomerForBed(button);
                button.oncontextmenu = e => {
                    e.preventDefault();
                    openCustomerForBed(button);
                };

                roomDiv.appendChild(button);
                index++;
            }
            apartmentDiv.appendChild(roomDiv);
        }
        apartmentContainer.appendChild(apartmentDiv);
    }

    floorDiv.appendChild(apartmentContainer);
    if (building) building.appendChild(floorDiv);
}

function openCustomerForBed(button) {
    selectedBed = button;
    const i = Number(button.dataset.index);
    const customer = customers[i];

    if (customer) {
        $("editName").value = customer.name || "";
        $("editPhone").value = customer.phone || "";
        $("editPaid").value = customer.paid || "Unpaid";
        $("editParentPhone").value = customer.parentPhone || "";
        editModal.style.display = "flex";
    } else {
        modal.style.display = "flex";
    }
}

/* =========================================================
   AUTHENTICATION — FIREBASE AUTH
   ========================================================= */
async function login() {
    const email = $("loginUser").value.trim().toLowerCase();
    const password = $("loginPass").value;

    if (!firebaseReady) { $("loginError").innerText = "Firebase is not configured."; return; }
    if (!email || !password) { $("loginError").innerText = "Please enter your email and password."; return; }

    const button = document.querySelector(".login-btn");
    if (button) button.disabled = true;
    $("loginError").innerText = "Signing in...";

    try {
        await setPersistence(auth, browserSessionPersistence);
        const credential = await signInWithEmailAndPassword(auth, email, password);
        await loadCurrentUserRole(credential.user);
        $("loginError").innerText = "";
    } catch (error) {
        console.error(error);
        $("loginError").innerText = firebaseErrorMessage(error);
        currentRole = null;
        try { await signOut(auth); } catch (_) { }
    } finally {
        if (button) button.disabled = false;
    }
}

async function registerAccount() {
    const email = $("loginUser").value.trim().toLowerCase();
    const password = $("loginPass").value;
    if (!firebaseReady) { $("loginError").innerText = "Firebase is not configured."; return; }
    if (!email || !password) { $("loginError").innerText = "Enter an email and password first."; return; }
    if (password.length < 8) { $("loginError").innerText = "Password must be at least 8 characters."; return; }

    const buttons = document.querySelectorAll(".auth-link, .login-btn");
    buttons.forEach(b => b.disabled = true);
    $("loginError").innerText = "Creating account...";
    try {
        await setPersistence(auth, browserSessionPersistence);
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        await signOut(auth);
        $("loginError").innerText = "✅ Account created successfully. You can sign in now. A company owner must assign your company and role before you can enter the system.";
    } catch (error) {
        console.error(error);
        $("loginError").innerText = firebaseErrorMessage(error);
        try { await signOut(auth); } catch (_) { }
    } finally { buttons.forEach(b => b.disabled = false); }
}

async function resetPassword() {
    const email = $("loginUser").value.trim().toLowerCase();
    if (!firebaseReady) { $("loginError").innerText = "Firebase is not configured."; return; }
    if (!email) { $("loginError").innerText = "Enter your email first."; return; }
    try {
        await sendPasswordResetEmail(auth, email);
        $("loginError").innerText = "📩 If the account is eligible, a password reset email has been sent. Check your Inbox/Spam.";
    } catch (error) {
        console.error(error);
        $("loginError").innerText = firebaseErrorMessage(error);
    }
}

function showMainApp() {
    const loginPage = $("loginPage");
    const appContent = $("appContent");

    if (loginPage) loginPage.style.display = "none";
    if (appContent) {
        appContent.classList.remove("hidden");
        appContent.style.display = "block";
    }

    applyRoleUI();
    openTab("residents");
}

function logout() {
    showConfirm("Are you sure you want to log out?", async () => {
        try {
            await signOut(auth);
            currentRole = null;
            imageObjectUrls.forEach(url => URL.revokeObjectURL(url));
            imageObjectUrls.clear();
        } catch (error) {
            alert(firebaseErrorMessage(error));
        }
    });
}

function checkAuthOnLoad() {
    if (!firebaseReady) {
        const loginPage = $("loginPage");
        const appContent = $("appContent");
        if (loginPage) loginPage.style.display = "flex";
        if (appContent) appContent.style.display = "none";
        return;
    }

    onAuthStateChanged(auth, async user => {
        if (user) {
            try {
                await loadCurrentUserRole(user);
                showMainApp();
                await startRealtimeData();
            } catch (error) {
                currentRole = null;
                console.error(error);
                const loginPage = $("loginPage");
                const appContent = $("appContent");
                if (loginPage) loginPage.style.display = "flex";
                if (appContent) appContent.style.display = "none";
                if ($("loginError")) $("loginError").innerText = firebaseErrorMessage(error);
            }
        } else {
            if (unsubscribeCustomers) unsubscribeCustomers();
            if (unsubscribeExpenses) unsubscribeExpenses();

            const loginPage = $("loginPage");
            const appContent = $("appContent");
            if (loginPage) loginPage.style.display = "flex";
            if (appContent) appContent.style.display = "none";
        }
    });
}

function togglePassword() {
    const input = $("loginPass");
    const icon = $("eyeIcon");

    if (input.type === "password") {
        input.type = "text";
        icon.classList.replace("fa-eye", "fa-eye-slash");
    } else {
        input.type = "password";
        icon.classList.replace("fa-eye-slash", "fa-eye");
    }
}

/* =========================================================
   REAL-TIME FIRESTORE DATA
   ========================================================= */
async function startRealtimeData() {
    requireFirebase();

    if (unsubscribeCustomers) unsubscribeCustomers();
    if (unsubscribeExpenses) unsubscribeExpenses();

    const initialCustomers = await getDocs(customerCollection());
    customers = new Array(totalBeds).fill(null);
    initialCustomers.forEach(snap => {
        const data = snap.data();
        const index = Number(data.index);
        if (Number.isInteger(index) && index >= 0 && index < totalBeds) {
            customers[index] = { id: snap.id, ...data };
        }
    });
    dataLoaded = true;
    loadCustomers();
    updateDashboard();

    unsubscribeCustomers = onSnapshot(
        customerCollection(),
        snapshot => {
            customers = new Array(totalBeds).fill(null);

            snapshot.forEach(snap => {
                const data = snap.data();
                const index = Number(data.index);
                if (Number.isInteger(index) && index >= 0 && index < totalBeds) {
                    customers[index] = { id: snap.id, ...data };
                }
            });

            dataLoaded = true;
            loadCustomers();
            updateDashboard();
        },
        error => {
            console.error("Customers listener:", error);
            alert(`Customer data error: ${firebaseErrorMessage(error)}`);
        }
    );

if (hasPermission("finance.read")) {
    const expensesQuery = query(
        expenseCollection(),
        orderBy("date", "desc")
    );

    unsubscribeExpenses = onSnapshot(
        expensesQuery,
        snapshot => {
            expenses = snapshot.docs.map(snap => ({
                id: snap.id,
                ...snap.data()
            }));

            renderExpenses();
            updateFinanceDashboard();
        },
        error => {
            console.error("Expenses listener:", error);
        }
    );

    await loadPaymentHistory();
} else {
    expenses = [];
    paymentHistory = {};
}
    await loadPaymentHistory();
    if (["owner", "admin"].includes(currentRole)) {
        await resetMonthlyPayments();
    }
}

async function loadPaymentHistory() {
    requireFirebase();

    const snapshot = await getDocs(
        query(paymentHistoryCollection(), orderBy("monthKey", "desc"))
    );

    paymentHistory = {};
    snapshot.forEach(snap => {
        const data = snap.data();
        paymentHistory[data.monthKey || snap.id] = data.records || [];
    });
}

/* =========================================================
   CUSTOMER CRUD — FIRESTORE + STORAGE
   ========================================================= */
async function saveCustomerToFirebase(index, customer, imageFile = null) {
    requireRole("admin", "staff");

    let idImagePath = customer.idImagePath || null;

    if (imageFile) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(imageFile.type)) {
            throw new Error("Only JPG, PNG, or WEBP images are allowed.");
        }
        if (imageFile.size > 2 * 1024 * 1024) {
            throw new Error("ID image must be 2 MB or smaller.");
        }

        const safeName = imageFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const imageRef = ref(
            storage,
            companyStoragePath("customer-images", customerDocId(index), `${Date.now()}-${safeName}`)
        );

        await uploadBytes(imageRef, imageFile, {
            contentType: imageFile.type || "image/jpeg"
        });

        idImagePath = imageRef.fullPath;
    }

    const data = {
        ...customer,
        index,
        idImagePath,
        idImage: null,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser.uid
    };

    await setDoc(companyDoc("customers", customerDocId(index)), data);
}

if (saveBtn) {
    saveBtn.onclick = async function () {
        try {
            requireFirebase();

            const parentPhone = $("customerParentPhone").value.trim();
            const name = $("customerName").value.trim();
            const phone = $("customerPhone").value.trim();
            const fileInput = $("customerIdImage");

            if (!name || name.length > 120) {
                alert("Customer name is required and must be 120 characters or fewer.");
                return;
            }
            if (phone.length > 40 || parentPhone.length > 40) {
                alert("Phone numbers are too long.");
                return;
            }

            if (!selectedBed) {
                alert("Please select a bed.");
                return;
            }

            const i = Number(selectedBed.dataset.index);
            const file = fileInput?.files?.[0] || null;

            saveBtn.disabled = true;
            saveBtn.innerText = "Saving...";

            await saveCustomerToFirebase(i, {
                name,
                phone,
                parentPhone,
                paid: "Unpaid",
                date: new Date().toISOString()
            }, file);

            finishSave();
        } catch (error) {
            console.error(error);
            alert(`Could not save customer: ${firebaseErrorMessage(error)}`);
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerText = "Save Customer";
        }
    };
}

function finishSave() {
    modal.style.display = "none";
    $("customerName").value = "";
    $("customerPhone").value = "";
    if ($("customerParentPhone")) $("customerParentPhone").value = "";
    $("customerIdImage").value = "";
    updateDashboard();
}

if (cancelBtn) {
    cancelBtn.onclick = function () {
        modal.style.display = "none";
        $("customerName").value = "";
        $("customerPhone").value = "";
        if ($("customerParentPhone")) $("customerParentPhone").value = "";
        $("customerIdImage").value = "";
    };
}

if ($("cancelEdit")) {
    $("cancelEdit").addEventListener("click", () => {
        editModal.style.display = "none";
    });
}

if (checkoutBtn) {
    checkoutBtn.onclick = function () {
        if (!selectedBed) return;

        showConfirm("Are you sure you want to check out this customer?", async () => {
            try {
                requireRole("admin", "staff");

                const i = Number(selectedBed.dataset.index);
                const customer = customers[i];
                if (!customer) return;

                await deleteDoc(companyDoc("customers", customerDocId(i)));

                selectedBed.className = "available";
                selectedBed.innerHTML = selectedBed.dataset.bedName;
                selectedBed.disabled = false;

                editModal.style.display = "none";
                updateDashboard();
            } catch (error) {
                console.error(error);
                alert(`Checkout failed: ${firebaseErrorMessage(error)}`);
            }
        });
    };
}

if (updateBtn) {
    updateBtn.onclick = async function () {
        try {
            requireFirebase();

            if (!selectedBed) return;
            const i = Number(selectedBed.dataset.index);
            const customer = customers[i];

            if (!customer) return;

            const updated = {
                name: $("editName").value.trim(),
                phone: $("editPhone").value.trim(),
                paid: $("editPaid").value === "Paid" ? "Paid" : "Unpaid",
                parentPhone: $("editParentPhone").value.trim(),
                index: i,
                idImagePath: customer.idImagePath || null,
                idImage: null,
                date: customer.date || new Date().toISOString(),
                updatedAt: serverTimestamp(),
                updatedBy: auth.currentUser.uid
            };

            if (!updated.name) {
                alert("Customer name is required.");
                return;
            }

            updateBtn.disabled = true;
            updateBtn.innerText = "Saving...";

            await updateDoc(companyDoc("customers", customerDocId(i)), updated);
            await saveMonthlyPaidRecord();

            editModal.style.display = "none";
        } catch (error) {
            console.error(error);
            alert(`Update failed: ${firebaseErrorMessage(error)}`);
        } finally {
            updateBtn.disabled = false;
            updateBtn.innerText = "Update Customer";
        }
    };
}

function saveCustomers() {
    // Kept as a compatibility function for older inline code.
    // All actual writes are now done directly through Firestore.
    return Promise.resolve();
}

function loadCustomers() {
    for (let i = 0; i < customers.length; i++) {
        updateBedUI(i);
    }
    updateDashboard();
}

/* =========================================================
   DASHBOARD & PAYMENT STATUS
   ========================================================= */
function updateDashboard() {
    let occupied = 0;
    let paid = 0;
    let unpaid = 0;
    let revenue = 0;

    for (let i = 0; i < customers.length; i++) {
        const c = customers[i];

        if (c) {
            occupied++;

            if (c.paid === "Paid") {
                paid++;
                revenue += MONTHLY_RENT;
            } else {
                unpaid++;
            }
        }
    }

    if ($("occupiedBeds")) $("occupiedBeds").innerText = occupied;
    if ($("availableBeds")) $("availableBeds").innerText = totalBeds - occupied;
    if ($("paidCustomers")) $("paidCustomers").innerText = paid;
    if ($("unpaidCustomers")) $("unpaidCustomers").innerText = unpaid;
    if ($("revenue")) $("revenue").innerText = formatCurrency(revenue);

    updateFinanceDashboard();
    renderPaidClients();
}

async function setCustomerPaid(index, status) {
    requireRole("admin", "staff");

    const customer = customers[index];
    if (!customer) return;

    const safeStatus = status === "Paid" ? "Paid" : "Unpaid";
    await updateDoc(companyDoc("customers", customerDocId(index)), {
        paid: safeStatus,
        paymentUpdatedAt: serverTimestamp(),
        paymentUpdatedBy: auth.currentUser.uid
    });

    await saveMonthlyPaidRecord();
}

function togglePaid(button, index) {
    if (!customers[index]) return;

    const nextStatus = customers[index].paid === "Paid" ? "Unpaid" : "Paid";

    showConfirm(
        `Change ${escapeHTML(customers[index].name)} to ${nextStatus}?`,
        async () => {
            try {
                await setCustomerPaid(index, nextStatus);
            } catch (error) {
                console.error(error);
                alert(`Payment update failed: ${firebaseErrorMessage(error)}`);
            }
        }
    );
}

function createPaidButton(index) {
    const btn = document.createElement("button");
    const status = customers[index]?.paid || "Unpaid";

    btn.className = "paid-btn " + (status === "Paid" ? "paid" : "unpaid");
    btn.innerText = status;

    btn.onclick = function (e) {
        e.stopPropagation();
        togglePaid(btn, index);
    };

    return btn;
}

function showConfirm(message, callback) {
    $("confirmText").innerText = message;
    confirmModal.style.display = "flex";

    confirmOk.onclick = async function () {
        confirmModal.style.display = "none";
        await callback();
    };

    confirmCancel.onclick = function () {
        confirmModal.style.display = "none";
    };
}

async function getSecureImageUrl(path) {
    if (!path) return null;
    if (imageObjectUrls.has(path)) return imageObjectUrls.get(path);
    try {
        const blob = await getBlob(ref(storage, path));
        const url = URL.createObjectURL(blob);
        imageObjectUrls.set(path, url);
        return url;
    } catch (error) {
        console.warn("Could not load protected image:", error);
        return null;
    }
}

async function updateBedUI(index) {
    const button = document.querySelector(`[data-index="${index}"]`);
    if (!button) return;

    const c = customers[index];

    if (!c) {
        button.className = "available";
        button.innerHTML = escapeHTML(button.dataset.bedName);
        button.disabled = false;
        return;
    }

    button.disabled = false;
    button.className = c.paid === "Unpaid"
        ? "occupied unpaid-card"
        : "occupied paid-card";

    button.innerHTML = `
        <b>${escapeHTML(c.name)}</b><br>
        ${escapeHTML(c.phone || "-")}<br>
        Parent: ${escapeHTML(c.parentPhone || "-")}<br>
        ${escapeHTML(c.date || "-")}<br>
    `;

    const imagePath = c.idImagePath;
    if (imagePath) {
        const url = await getSecureImageUrl(imagePath);
        if (url && customers[index] === c) {
            const img = document.createElement("img");
            img.src = url;
            img.alt = "ID";
            img.style.cssText = "width:40px;height:40px;border-radius:6px;object-fit:cover;";
            button.prepend(img);
        }
    }

    button.appendChild(createPaidButton(index));
}

function showKpi(type) {
    const kpiTitle = $("kpiTitle");
    const kpiList = $("kpiList");
    kpiList.innerHTML = "";

    let title = "";
    const list = [];

    for (let i = 0; i < customers.length; i++) {
        const c = customers[i];
        const location = getLocation(i);

        if (type === "available" && !c) {
            list.push({ type: "available", ...location, index: i });
        }

        if (c) {
            if (type === "occupied") list.push({ ...c, ...location });
            if (type === "paid" && c.paid === "Paid") list.push({ ...c, ...location });
            if (type === "unpaid" && c.paid !== "Paid") list.push({ ...c, ...location });
        }
    }

    if (type === "occupied") title = "Occupied Customers";
    if (type === "available") title = "Available Beds";
    if (type === "paid") title = "Paid Customers";
    if (type === "unpaid") title = "Unpaid Customers";

    kpiTitle.innerText = title;

    list.forEach(item => {
        const div = document.createElement("div");
        div.className = "kpi-item";

        if (item.type === "available") {
            div.innerHTML = `
                <div class="kpi-title">🛏 Empty Bed</div>
                <div class="kpi-row"><span>Floor</span><b>${item.floor}</b></div>
                <div class="kpi-row"><span>Apartment</span><b>${item.apartment}</b></div>
                <div class="kpi-row"><span>Room</span><b>${item.room}</b></div>
                <div class="kpi-row"><span>Bed</span><b>${item.bed}</b></div>
            `;
        } else {
            div.innerHTML = `
                <div class="kpi-title">${escapeHTML(item.name)}</div>
                <div class="kpi-row"><span>Floor</span><b>${item.floor}</b></div>
                <div class="kpi-row"><span>Apartment</span><b>${item.apartment}</b></div>
                <div class="kpi-row"><span>Room</span><b>${item.room}</b></div>
                <div class="kpi-row"><span>Bed</span><b>${item.bed}</b></div>
                <div class="kpi-row"><span>Phone</span><b>${escapeHTML(item.phone || "-")}</b></div>
                <div class="kpi-row"><span>Status</span>
                    <b style="color:${item.paid === "Paid" ? "#22c55e" : "#ef4444"}">
                        ${escapeHTML(item.paid)}
                    </b>
                </div>
            `;
        }

        kpiList.appendChild(div);
    });

    kpiModal.style.display = "flex";
}

function closeKpi() {
    kpiModal.style.display = "none";
}

/* =========================================================
   SEARCH
   ========================================================= */
const searchInput = $("searchInput");

if (searchInput) {
    searchInput.addEventListener("input", function () {
        const value = this.value.toLowerCase().trim();

        document.querySelectorAll(".floor").forEach(floor => {
            let floorHasResult = false;

            floor.querySelectorAll(".apartment").forEach(apartment => {
                let apartmentHasResult = false;

                apartment.querySelectorAll(".room").forEach(room => {
                    let roomHasResult = false;

                    room.querySelectorAll("button").forEach(btn => {
                        const i = Number(btn.dataset.index);
                        const c = customers[i];
                        const location = getLocation(i);

                        let match = value === "";

                        if (!match && c) {
                            const haystack = [
                                c.name,
                                c.phone,
                                c.parentPhone,
                                c.paid
                            ].filter(Boolean).join(" ").toLowerCase();

                            match = haystack.includes(value);
                        }

                        if (!match) {
                            const locationText =
                                `floor ${location.floor} apartment ${location.apartment} room ${location.room} bed ${location.bed}`;
                            match = locationText.includes(value) ||
                                String(location.floor) === value ||
                                String(location.apartment) === value ||
                                String(location.room) === value ||
                                String(location.bed) === value;
                        }

                        btn.style.visibility = match ? "visible" : "hidden";
                        if (match) roomHasResult = true;
                    });

                    room.style.display = roomHasResult ? "" : "none";
                    if (roomHasResult) apartmentHasResult = true;
                });

                apartment.style.display = apartmentHasResult ? "" : "none";
                if (apartmentHasResult) floorHasResult = true;
            });

            floor.style.display = floorHasResult ? "" : "none";
        });
    });
}

/* =========================================================
   MONTHLY PAYMENTS + HISTORY
   ========================================================= */
async function saveMonthlyPaidRecord(monthKey = getMonthKey(), sourceCustomers = customers) {
    requireFirebase();

    const paidCustomers = [];

    for (let i = 0; i < sourceCustomers.length; i++) {
        const c = sourceCustomers[i];
        if (!c || c.paid !== "Paid") continue;

        paidCustomers.push({
            ...c,
            ...getLocation(i),
            index: i,
            customerId: customerDocId(i)
        });
    }

    await setDoc(companyDoc("paymentHistory", monthKey), {
        monthKey,
        records: paidCustomers,
        totalPaid: paidCustomers.length,
        totalRevenue: paidCustomers.length * MONTHLY_RENT,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser.uid
    });

    paymentHistory[monthKey] = paidCustomers;
}

async function resetMonthlyPayments() {
    requireRole("owner", "admin");

    const currentMonthKey = getMonthKey();
    const settingsRef = settingsDoc();
    const settingsSnap = await getDoc(settingsRef);
    const settings = settingsSnap.exists() ? settingsSnap.data() : {};
    const lastProcessedMonth = settings.lastPaymentReset || null;

    if (!lastProcessedMonth) {
        await setDoc(settingsRef, {
            lastPaymentReset: currentMonthKey,
            currentMonthKey,
            updatedAt: serverTimestamp()
        }, { merge: true });

        if (customers.some(Boolean)) {
            await saveMonthlyPaidRecord(currentMonthKey);
        }
        return;
    }

    if (lastProcessedMonth === currentMonthKey) return;

    // Archive the previous month BEFORE resetting payment statuses.
    if (lastProcessedMonth) {
        await saveMonthlyPaidRecord(lastProcessedMonth);
    }

    const batch = writeBatch(db);
    let resetCount = 0;

    customers.forEach((customer, i) => {
        if (!customer || customer.paid === "Unpaid") return;

        batch.update(companyDoc("customers", customerDocId(i)), {
            paid: "Unpaid",
            monthlyResetAt: serverTimestamp(),
            monthlyResetBy: auth.currentUser.uid
        });
        resetCount++;
    });

    if (resetCount > 0) {
        await batch.commit();
    }

    await setDoc(settingsRef, {
        lastPaymentReset: currentMonthKey,
        currentMonthKey,
        updatedAt: serverTimestamp()
    }, { merge: true });

    console.log(`Reset ${resetCount} customers for ${currentMonthKey}.`);
}

async function showHistory() {
    try {
        requireRole("admin", "staff");
        await loadPaymentHistory();

        const modalHistory = $("historyModal");
        const container = $("historyContainer");
        container.innerHTML = "";

        const months = Object.keys(paymentHistory).sort().reverse();

        if (months.length === 0) {
            container.innerHTML = "<p style='padding:15px;'>No payment history available.</p>";
            modalHistory.style.display = "flex";
            return;
        }

        months.forEach(month => {
            const monthTitle = document.createElement("div");
            monthTitle.className = "history-month-title";

            monthTitle.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:#f8fafc;border-radius:6px;margin-top:10px;">
                    <span>📅 ${escapeHTML(month)}</span>
                    <button class="delete-history-btn" data-admin-only
                            onclick="deleteHistory('${escapeHTML(month)}')"
                            style="background:#ef4444;color:white;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;">
                        🗑 Delete
                    </button>
                </div>
            `;

            const table = document.createElement("table");
            table.className = "history-table";
            table.innerHTML = `
                <thead>
                    <tr>
                        <th>Customer</th>
                        <th>Phone</th>
                        <th>Parent Phone</th>
                        <th>Location</th>
                        <th>Bed</th>
                        <th>Stay Days</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody></tbody>
            `;

            const tbody = table.querySelector("tbody");

            (paymentHistory[month] || []).forEach(c => {
                const tr = document.createElement("tr");
                const stayDays = getStayDays(c.date);

                let rowColor = "#ffffff";
                if (stayDays >= 90) rowColor = "#dcfce7";
                else if (stayDays >= 30) rowColor = "#fef9c3";

                tr.style.background = rowColor;

                tr.innerHTML = `
                    <td>
                        <div style="display:flex;align-items:center;gap:12px">
                            <div style="width:38px;height:38px;border-radius:50%;background:#e2e8f0;display:flex;align-items:center;justify-content:center;">👤</div>
                            <div>
                                <div style="font-weight:700">${escapeHTML(c.name)}</div>
                                <div style="font-size:11px;color:#94a3b8">Client #${1000 + Number(c.index || 0)}</div>
                            </div>
                        </div>
                    </td>
                    <td>
                        ${escapeHTML(c.phone || "-")}
                        ${c.phone ? `<button type="button" onclick="copyPhone('${escapeHTML(c.phone)}')" style="margin-left:6px;">📋</button>` : ""}
                    </td>
                    <td>${escapeHTML(c.parentPhone || "-")}</td>
                    <td>
                        <span class="location-badge">
                            Fl ${c.floor} • Apt ${c.apartment} • Rm ${c.room}
                        </span>
                    </td>
                    <td><b>Bed ${c.bed}</b></td>
                    <td>${stayDays}</td>
                    <td><span class="status-pill-paid">PAID</span></td>
                `;

                tbody.appendChild(tr);
            });

            container.appendChild(monthTitle);
            container.appendChild(table);
        });

        applyRoleUI();
        modalHistory.style.display = "flex";
    } catch (error) {
        console.error(error);
        alert(`Could not load history: ${firebaseErrorMessage(error)}`);
    }
}

function copyPhone(phone) {
    navigator.clipboard?.writeText(phone).catch(() => { });
}

function closeHistory() {
    $("historyModal").style.display = "none";
}

function deleteHistory(month) {
    showConfirm(
        `Are you sure you want to delete payment history for ${month}?`,
        async () => {
            try {
                requireFirebase();
                await deleteDoc(companyDoc("paymentHistory", month));
                delete paymentHistory[month];
                await showHistory();
            } catch (error) {
                console.error(error);
                alert(`Could not delete history: ${firebaseErrorMessage(error)}`);
            }
        }
    );
}

/* =========================================================
   NAVIGATION
   ========================================================= */
function openTab(tab) {
    $("residentsPage").style.display = "none";
    $("financePage").style.display = "none";
    $("paidClientsPage").style.display = "none";

    const buttons = document.querySelectorAll(".tab-btn");
    buttons.forEach(b => b.classList.remove("active"));

    if (tab === "residents") {
        $("residentsPage").style.display = "block";
        if (buttons[0]) buttons[0].classList.add("active");
    }

    if (tab === "finance") {
        $("financePage").style.display = "block";
        if (buttons[1]) buttons[1].classList.add("active");
        renderExpenses();
    }
if (tab === "finance") {
    if (!hasPermission("finance.read")) {
        alert("You do not have permission to access Finance.");
        return;
    }

    $("financePage").style.display = "block";
    if (buttons[1]) buttons[1].classList.add("active");
    renderExpenses();
}
    if (tab === "paidClients") {
        $("paidClientsPage").style.display = "block";
        if (buttons[2]) buttons[2].classList.add("active");
        renderPaidClients();
    }
}

/* =========================================================
   EXPENSES — FIRESTORE
   ========================================================= */
function openExpenseModal() {
    if (expenseModal) {
        expenseModal.style.display = "flex";
        const dateInput = $("expenseDate");
        if (dateInput) dateInput.value = new Date().toISOString().split("T")[0];
    }
}

function closeExpenseModal() {
    if (!expenseModal) return;

    expenseModal.style.display = "none";
    const form = $("expenseForm");

    if (form) {
        form.reset();
    } else {
        if ($("expenseCategory")) $("expenseCategory").value = "";
        if ($("expenseDescription")) $("expenseDescription").value = "";
        if ($("expenseAmount")) $("expenseAmount").value = "";
    }
}

function renderExpenses(dataToRender = expenses) {
    if (!expenseTableBody) return;

    expenseTableBody.innerHTML = "";

    if (dataToRender.length === 0) {
        expenseTableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center;padding:25px;color:#94a3b8;">
                    <i class="fa-solid fa-folder-open" style="font-size:2rem;margin-bottom:8px;display:block;"></i>
                    No expenses found.
                </td>
            </tr>
        `;
    } else {
        dataToRender.forEach(expense => {
            const tr = document.createElement("tr");

            let badgeClass = "badge-other";
            const catLower = (expense.category || "").toLowerCase();

            if (catLower.includes("maintenance")) badgeClass = "badge-maintenance";
            else if (catLower.includes("utilities")) badgeClass = "badge-utilities";
            else if (catLower.includes("salaries")) badgeClass = "badge-salaries";
            else if (catLower.includes("cleaning")) badgeClass = "badge-cleaning";

            tr.innerHTML = `
                <td><strong>${escapeHTML(expense.date || "N/A")}</strong></td>
                <td><span class="badge-category ${badgeClass}">${escapeHTML(expense.category)}</span></td>
                <td>${escapeHTML(expense.description || "-")}</td>
                <td style="font-weight:700;color:#dc2626;">-${formatCurrency(expense.amount)}</td>
                <td style="text-align:right;">
                    <button class="btn-delete-expense" data-admin-only
                            onclick="deleteExpense('${escapeHTML(expense.id)}')"
                            title="Delete Expense">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2" stroke-linecap="round"
                             stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6l-1 14H6L5 6"></path>
                            <path d="M10 11v6"></path>
                            <path d="M14 11v6"></path>
                            <path d="M9 6V4h6v2"></path>
                        </svg>
                    </button>
                </td>
            `;

            expenseTableBody.appendChild(tr);
        });
    }

    updateFinanceDashboard();
    applyRoleUI();
}

function filterExpenses() {
    const searchVal = ($("expenseSearchInput")?.value || "").toLowerCase().trim();
    const categoryVal = $("expenseCategoryFilter")?.value || "all";

    const filtered = expenses.filter(exp => {
        const matchesSearch =
            (exp.description || "").toLowerCase().includes(searchVal) ||
            (exp.category || "").toLowerCase().includes(searchVal);

        const matchesCategory =
            categoryVal === "all" || exp.category === categoryVal;

        return matchesSearch && matchesCategory;
    });

    renderExpenses(filtered);
}

async function saveNewExpense() {
    try {
        requireRole("admin", "staff");

        const category = $("expenseCategory")?.value || "";
        const description = $("expenseDescription")?.value.trim() || "";
        const amount = Number($("expenseAmount")?.value || 0);
        const date = $("expenseDate")?.value ||
            new Date().toISOString().split("T")[0];

        const allowedCategories = ["Maintenance", "Utilities", "Salaries", "Cleaning", "Other"];
        if (!allowedCategories.includes(category) || !Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
            alert("Please enter a valid category and amount.");
            return;
        }
        if (description.length > 250) {
            alert("Description must be 250 characters or fewer.");
            return;
        }
        if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) {
            alert("Invalid expense date.");
            return;
        }

        saveExpenseBtn.disabled = true;
        saveExpenseBtn.innerText = "Saving...";

        await addDoc(expenseCollection(), {
            date,
            category,
            description,
            amount,
            createdAt: serverTimestamp(),
            createdBy: auth.currentUser.uid
        });

        closeExpenseModal();
    } catch (error) {
        console.error(error);
        alert(`Could not save expense: ${firebaseErrorMessage(error)}`);
    } finally {
        saveExpenseBtn.disabled = false;
        saveExpenseBtn.innerText = "Save Expense Record";
    }
}

function deleteExpense(id) {
    if (currentRole !== "admin") {
        alert("Only an administrator can delete expense records.");
        return;
    }
    showConfirm("Are you sure you want to delete this expense record?", async () => {
        try {
            requireRole("admin");
            if (!/^[A-Za-z0-9_-]{1,200}$/.test(String(id))) throw new Error("Invalid expense ID.");
            await deleteDoc(companyDoc("expenses", id));
        } catch (error) {
            console.error(error);
            alert(`Could not delete expense: ${firebaseErrorMessage(error)}`);
        }
    });
}

function updateFinanceDashboard() {
    let revenue = 0;
    customers.forEach(c => {
        if (c && c.paid === "Paid") revenue += MONTHLY_RENT;
    });

    const expensesTotal = expenses.reduce(
        (sum, e) => sum + Number(e.amount || 0),
        0
    );

    const profit = revenue - expensesTotal;

    if ($("financeRevenue")) $("financeRevenue").innerHTML = formatCurrency(revenue);
    if ($("financeExpenses")) $("financeExpenses").innerHTML = formatCurrency(expensesTotal);

    const profitBox = $("financeProfit");
    if (profitBox) {
        profitBox.innerHTML = formatCurrency(profit);
        profitBox.className = profit >= 0
            ? "kpi-value text-emerald"
            : "kpi-value text-danger";
    }
}

/* =========================================================
   PAID CLIENTS
   ========================================================= */
function renderPaidClients() {
    const body = $("paidClientsBody");
    const countElem = $("paidClientsCount");
    const totalRevElem = $("paidClientsTotalRev");
    const rateElem = $("paidRatePercentage");

    if (!body) return;

    body.innerHTML = "";
    let paidCount = 0;
    let totalOccupied = 0;

    for (let i = 0; i < customers.length; i++) {
        const c = customers[i];
        if (!c) continue;

        totalOccupied++;
        if (c.paid !== "Paid") continue;

        paidCount++;
        const location = getLocation(i);

        const tr = document.createElement("tr");
        tr.dataset.floor = String(location.floor);

        tr.innerHTML = `
            <td>
                <div style="display:flex;align-items:center;gap:12px;">
                    ${c.idImage
                ? `<img src="${escapeHTML(c.idImage)}" alt="ID" style="width:38px;height:38px;border-radius:50%;object-fit:cover;border:1px solid #e2e8f0;">`
                : `<div style="width:38px;height:38px;border-radius:50%;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:16px;">👤</div>`
            }
                    <div>
                        <strong style="color:#0f172a;font-size:14px;">${escapeHTML(c.name)}</strong>
                        <div style="font-size:11px;color:#94a3b8;">Ref: #${1000 + i}</div>
                    </div>
                </div>
            </td>
            <td><strong>${escapeHTML(c.phone || "-")}</strong></td>
            <td>${escapeHTML(c.parentPhone || "-")}</td>
            <td>
                <span class="location-badge">
                    Fl ${location.floor} • Apt ${location.apartment} • Rm ${location.room}
                </span>
            </td>
            <td><b>Bed ${location.bed}</b></td>
            <td><span class="status-pill-paid">PAID</span></td>
        `;

        body.appendChild(tr);
    }

    if (countElem) countElem.innerText = paidCount;
    if (totalRevElem) totalRevElem.innerText = formatCurrency(paidCount * MONTHLY_RENT);

    const rate = totalOccupied > 0
        ? Math.round((paidCount / totalOccupied) * 100)
        : 0;

    if (rateElem) rateElem.innerText = `${rate}%`;
    filterPaidClients();
}

function filterPaidClients() {
    const input = $("paidSearchInput");
    const floorSelect = $("paidFloorFilter");

    const filterText = input ? input.value.toLowerCase().trim() : "";
    const selectedFloor = floorSelect ? floorSelect.value : "all";

    document.querySelectorAll("#paidClientsBody tr").forEach(row => {
        const textMatch = row.innerText.toLowerCase().includes(filterText);
        const floorMatch =
            selectedFloor === "all" || row.dataset.floor === selectedFloor;

        row.style.display = textMatch && floorMatch ? "" : "none";
    });
}

function exportPaidToCSV() {
    let csvContent =
        "data:text/csv;charset=utf-8,Name,Phone,Parent Phone,Location,Bed,Status\n";

    for (let i = 0; i < customers.length; i++) {
        const c = customers[i];
        if (!c || c.paid !== "Paid") continue;

        const l = getLocation(i);
        const location = `Floor ${l.floor} Apt ${l.apartment} Room ${l.room}`;

        const row = [
            c.name,
            c.phone || "",
            c.parentPhone || "",
            location,
            `Bed ${l.bed}`,
            "Paid"
        ].map(value => `"${String(value).replaceAll('"', '""')}"`).join(",");

        csvContent += row + "\n";
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
        "download",
        `Paid_Clients_Report_${new Date().toISOString().slice(0, 10)}.csv`
    );

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/* =========================================================
   EVENT BINDINGS
   ========================================================= */
window.addEventListener("DOMContentLoaded", function () {
    // Firebase Auth is the source of truth for login/session.
    checkAuthOnLoad();

    if ($("loginPass")) {
        $("loginPass").addEventListener("keypress", function (e) {
            if (e.key === "Enter") login();
        });
    }

    if (addExpenseBtn) addExpenseBtn.onclick = openExpenseModal;
    if (saveExpenseBtn) saveExpenseBtn.onclick = saveNewExpense;
    if (cancelExpenseBtn) cancelExpenseBtn.onclick = closeExpenseModal;

    renderExpenses();
    updateDashboard();
});

window.addEventListener("click", function (e) {
    if (e.target === modal) modal.style.display = "none";
    if (e.target === editModal) editModal.style.display = "none";
    if (e.target === confirmModal) confirmModal.style.display = "none";
    if (e.target === kpiModal) kpiModal.style.display = "none";

    const historyModal = $("historyModal");
    if (historyModal && e.target === historyModal) {
        historyModal.style.display = "none";
    }

    if (e.target === expenseModal) closeExpenseModal();
});

/*
 * Expose only functions used by the existing HTML inline onclick handlers.
 * Firebase itself remains modular and data is never stored in localStorage.
 */
Object.assign(window, {
    login,
    registerAccount,
    resetPassword,
    logout,
    togglePassword,
    openTab,
    showKpi,
    closeKpi,
    showHistory,
    closeHistory,
    deleteHistory,
    exportPaidToCSV,
    filterExpenses,
    filterPaidClients,
    openExpenseModal,
    closeExpenseModal,
    saveNewExpense,
    deleteExpense,
    copyPhone
});
