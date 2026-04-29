(() => {
const ROLE_ORDER = {
  guest: 0,
  basic: 1,
  advanced: 2,
  admin: 3,
};

const DEFAULT_SESSION = {
  authenticated: false,
  role: "guest",
  roleLabel: "Guest",
  user: null,
  authConfigured: false,
  availableRoles: [],
};

const ROLE_DESCRIPTIONS = {
  basic: "Browse the site and download files.",
  advanced: "Browse, download, and refresh protocols, laws, votes, and non-LLM data builds.",
  admin: "Full access, including all Gemini-powered analysis actions.",
};

const state = {
  session: { ...DEFAULT_SESSION },
  pending: false,
  loginPending: false,
  error: "",
  activeRequirement: null,
};

let launcherElement = null;
let overlayElement = null;
let dialogElement = null;
let statusElement = null;
let formElement = null;
let usernameInputElement = null;
let passwordInputElement = null;
let errorElement = null;
let accountViewElement = null;
let guestViewElement = null;
let configNoteElement = null;
let userSummaryElement = null;
let permissionsListElement = null;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getRoleValue(role) {
  return ROLE_ORDER[String(role || "").trim()] || 0;
}

function canAccess(minimumRole) {
  return getRoleValue(state.session.role) >= getRoleValue(minimumRole);
}

function getRequiredMessage(minimumRole) {
  if (minimumRole === "admin") {
    return "This action is available to admins only.";
  }

  if (minimumRole === "advanced") {
    return "This action requires an advanced or admin account.";
  }

  return "This action requires a logged-in account.";
}

function getRoleBadge() {
  if (!state.session.authenticated || !state.session.user) {
    return `<span class="auth-launcher__role">Guest</span>`;
  }

  return `<span class="auth-launcher__role">${escapeHtml(state.session.roleLabel || state.session.user.role || "")}</span>`;
}

function renderLauncher() {
  if (!launcherElement) {
    return;
  }

  const label = state.session.authenticated && state.session.user
    ? escapeHtml(state.session.user.displayName || state.session.user.username || "User")
    : "User Login";

  launcherElement.innerHTML = `
    <span class="auth-launcher__label">${label}</span>
    ${getRoleBadge()}
  `;
}

function renderPermissions(role) {
  const visibleRoles = ["basic", "advanced", "admin"];
  return visibleRoles
    .map((candidateRole) => {
      const isCurrent = role === candidateRole;
      return `
        <li class="auth-permission-item ${isCurrent ? "is-current" : ""}">
          <strong>${escapeHtml(candidateRole[0].toUpperCase() + candidateRole.slice(1))}</strong>
          <span>${escapeHtml(ROLE_DESCRIPTIONS[candidateRole])}</span>
        </li>
      `;
    })
    .join("");
}

function renderDialog() {
  if (!dialogElement) {
    return;
  }

  if (statusElement) {
    statusElement.textContent = state.activeRequirement
      ? getRequiredMessage(state.activeRequirement)
      : "Choose an account level to unlock additional actions on the site.";
  }

  if (guestViewElement) {
    guestViewElement.hidden = state.session.authenticated;
  }

  if (accountViewElement) {
    accountViewElement.hidden = !state.session.authenticated;
  }

  if (errorElement) {
    errorElement.hidden = !state.error;
    errorElement.textContent = state.error;
  }

  if (formElement) {
    formElement.classList.toggle("is-loading", state.loginPending);
    const inputs = Array.from(formElement.querySelectorAll("input, button"));
    const shouldDisable = state.loginPending || !state.session.authConfigured;
    inputs.forEach((element) => {
      element.disabled = shouldDisable;
    });
  }

  if (userSummaryElement) {
    userSummaryElement.innerHTML = state.session.authenticated && state.session.user
      ? `
        <p><strong>${escapeHtml(state.session.user.displayName || state.session.user.username || "")}</strong></p>
        <p class="muted">${escapeHtml(state.session.roleLabel || state.session.user.role || "")} access</p>
      `
      : "";
  }

  if (permissionsListElement) {
    permissionsListElement.innerHTML = renderPermissions(state.session.role);
  }

  if (configNoteElement) {
    configNoteElement.hidden = state.session.authConfigured;
    configNoteElement.textContent = state.session.authConfigured
      ? ""
      : "Login is not configured on this server yet. Set the AUTH_* environment variables before signing in.";
  }
}

function scheduleRoleGate(root = document.body) {
  window.requestAnimationFrame(() => {
    applyRoleGate(root);
  });
}

function setHiddenState(element, hidden) {
  if (!element) {
    return;
  }

  element.classList.toggle("auth-role-hidden", hidden);
}

function setLockedState(element, locked, minimumRole) {
  if (!element) {
    return;
  }

  element.classList.toggle("is-role-locked", locked);
  element.setAttribute("data-auth-locked", locked ? "true" : "false");

  if (locked) {
    element.setAttribute("title", getRequiredMessage(minimumRole));
  } else {
    element.removeAttribute("title");
  }
}

function getRoleNodes(root) {
  const nodes = [];

  if (root instanceof Element && root.matches("[data-requires-role]")) {
    nodes.push(root);
  }

  if (root && typeof root.querySelectorAll === "function") {
    nodes.push(...root.querySelectorAll("[data-requires-role]"));
  }

  return nodes;
}

function applyRoleGate(root = document.body) {
  for (const element of getRoleNodes(root)) {
    const minimumRole = element.dataset.requiresRole || "basic";
    const mode = element.dataset.authMode || "lock";
    const allowed = canAccess(minimumRole);

    if (mode === "hide") {
      setHiddenState(element, !allowed);
      continue;
    }

    setLockedState(element, !allowed, minimumRole);
  }
}

function dispatchSessionChange() {
  window.dispatchEvent(
    new CustomEvent("knesset-auth-changed", {
      detail: {
        session: state.session,
      },
    }),
  );
}

function setOverlayOpen(isOpen) {
  if (!overlayElement) {
    return;
  }

  overlayElement.hidden = !isOpen;
  overlayElement.setAttribute("aria-hidden", isOpen ? "false" : "true");
  document.body.classList.toggle("auth-dialog-open", isOpen);
}

async function fetchSession() {
  state.pending = true;

  try {
    const response = await fetch("/api/auth/session", {
      headers: {
        Accept: "application/json",
      },
    });
    const payload = await response.json();
    state.session = payload.session || { ...DEFAULT_SESSION };
  } catch {
    state.session = { ...DEFAULT_SESSION };
  } finally {
    state.pending = false;
    renderLauncher();
    renderDialog();
    applyRoleGate(document.body);
    dispatchSessionChange();
  }
}

function openDialog(minimumRole = null) {
  state.activeRequirement = minimumRole;
  state.error = "";
  setOverlayOpen(true);
  renderDialog();

  if (!state.session.authenticated && usernameInputElement) {
    window.setTimeout(() => {
      usernameInputElement.focus();
    }, 30);
  }
}

function closeDialog() {
  setOverlayOpen(false);
  state.activeRequirement = null;
  state.error = "";
  renderDialog();
}

async function handleLoginSubmit(event) {
  event.preventDefault();

  if (state.loginPending) {
    return;
  }

  if (!state.session.authConfigured) {
    state.error = "Login is not configured on this server yet.";
    renderDialog();
    return;
  }

  state.loginPending = true;
  state.error = "";
  renderDialog();

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: usernameInputElement.value,
        password: passwordInputElement.value,
      }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Login failed.");
    }

    state.session = payload.session || { ...DEFAULT_SESSION };
    usernameInputElement.value = "";
    passwordInputElement.value = "";
    closeDialog();
    renderLauncher();
    renderDialog();
    applyRoleGate(document.body);
    dispatchSessionChange();
  } catch (error) {
    state.error = error.message || String(error);
    renderDialog();
  } finally {
    state.loginPending = false;
    renderDialog();
  }
}

async function handleLogout() {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
  } catch {
    // Ignore logout transport issues and fall back to guest mode locally.
  }

  state.session = { ...DEFAULT_SESSION };
  renderLauncher();
  renderDialog();
  applyRoleGate(document.body);
  dispatchSessionChange();
  closeDialog();
}

function buildWidget() {
  launcherElement = document.createElement("button");
  launcherElement.type = "button";
  launcherElement.className = "auth-launcher";
  launcherElement.addEventListener("click", () => openDialog());
  document.body.appendChild(launcherElement);

  overlayElement = document.createElement("div");
  overlayElement.className = "auth-overlay";
  overlayElement.hidden = true;
  overlayElement.setAttribute("aria-hidden", "true");
  overlayElement.innerHTML = `
    <div class="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title">
      <div class="auth-dialog__header">
        <div>
          <p class="eyebrow">Access Control</p>
          <h2 id="auth-dialog-title">User Login</h2>
        </div>
        <button class="auth-dialog__close" type="button" aria-label="Close login dialog">×</button>
      </div>
      <p class="auth-dialog__status"></p>
      <div class="auth-dialog__body">
        <section class="auth-guest-view">
          <div class="auth-role-grid">
            <article class="auth-role-card">
              <h3>Basic</h3>
              <p>${escapeHtml(ROLE_DESCRIPTIONS.basic)}</p>
            </article>
            <article class="auth-role-card">
              <h3>Advanced</h3>
              <p>${escapeHtml(ROLE_DESCRIPTIONS.advanced)}</p>
            </article>
            <article class="auth-role-card">
              <h3>Admin</h3>
              <p>${escapeHtml(ROLE_DESCRIPTIONS.admin)}</p>
            </article>
          </div>
          <form class="auth-form">
            <p class="muted auth-config-note" hidden></p>
            <label class="auth-field">
              <span>Username</span>
              <input id="auth-username" name="username" type="text" autocomplete="username" required />
            </label>
            <label class="auth-field">
              <span>Password</span>
              <input id="auth-password" name="password" type="password" autocomplete="current-password" required />
            </label>
            <p class="auth-error" hidden></p>
            <button class="primary-button" type="submit">Sign In</button>
          </form>
        </section>

        <section class="auth-account-view" hidden>
          <div class="auth-user-card">
            <div class="auth-user-card__summary"></div>
            <button class="secondary-button compact-button" type="button" data-auth-logout>Log Out</button>
          </div>
          <div>
            <h3 class="auth-panel-title">Current permissions</h3>
            <ul class="auth-permission-list"></ul>
          </div>
        </section>
      </div>
    </div>
  `;
  document.body.appendChild(overlayElement);

  dialogElement = overlayElement.querySelector(".auth-dialog");
  statusElement = overlayElement.querySelector(".auth-dialog__status");
  formElement = overlayElement.querySelector(".auth-form");
  usernameInputElement = overlayElement.querySelector("#auth-username");
  passwordInputElement = overlayElement.querySelector("#auth-password");
  errorElement = overlayElement.querySelector(".auth-error");
  accountViewElement = overlayElement.querySelector(".auth-account-view");
  guestViewElement = overlayElement.querySelector(".auth-guest-view");
  configNoteElement = overlayElement.querySelector(".auth-config-note");
  userSummaryElement = overlayElement.querySelector(".auth-user-card__summary");
  permissionsListElement = overlayElement.querySelector(".auth-permission-list");

  overlayElement.addEventListener("click", (event) => {
    if (event.target === overlayElement) {
      closeDialog();
    }
  });

  overlayElement.querySelector(".auth-dialog__close").addEventListener("click", closeDialog);
  overlayElement.querySelector("[data-auth-logout]").addEventListener("click", () => {
    void handleLogout();
  });
  formElement.addEventListener("submit", (event) => {
    void handleLoginSubmit(event);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !overlayElement.hidden) {
      closeDialog();
    }
  });
}

document.addEventListener(
  "click",
  (event) => {
    const target = event.target.closest("[data-requires-role]");

    if (!target) {
      return;
    }

    const minimumRole = target.dataset.requiresRole || "basic";
    const mode = target.dataset.authMode || "lock";

    if (mode === "hide" || canAccess(minimumRole)) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    openDialog(minimumRole);
  },
  true,
);

const observer = new MutationObserver((mutations) => {
  const roots = new Set();

  for (const mutation of mutations) {
    if (mutation.target instanceof Element) {
      roots.add(mutation.target);
    }

    mutation.addedNodes.forEach((node) => {
      if (node instanceof Element) {
        roots.add(node);
      }
    });
  }

  roots.forEach((root) => scheduleRoleGate(root));
});

buildWidget();
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["hidden", "class"],
});

window.KnessetAuth = {
  canAccess,
  getSession() {
    return state.session;
  },
  openLogin(requiredRole = null) {
    openDialog(requiredRole);
  },
  refreshSession() {
    return fetchSession();
  },
  applyRoleGate(root) {
    applyRoleGate(root || document.body);
  },
};

void fetchSession();
})();
